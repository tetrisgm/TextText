import Foundation
import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultReplacementSyncTests: XCTestCase {
    func testReplacementConflictDuringUploadCannotBecomeAcknowledgedBaseline() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let original = try replacementSyncPack("original", root: root)
        let pending = try replacementSyncPack("pending", root: root)
        let candidate = try replacementSyncPack("candidate", root: root)
        let external = try replacementSyncPack("external", root: root)
        let transport = ReplacementSyncTransport(root: root, original: original, candidate: candidate, external: external)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace")
        let engine = try makeTestSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        try pending.write(to: root.appendingPathComponent("Note.textpack"), options: .atomic)
        let report = try await engine.sync()
        XCTAssertFalse(report.errors.isEmpty)
        let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
        let outbox = try XCTUnwrap((state["outbox"] as? [String: [String: Any]])?["replacement-sync-item"])
        let baseline = try XCTUnwrap((state["baselines"] as? [String: [String: Any]])?["replacement-sync-item"])
        XCTAssertEqual(baseline["revision"] as? String, TextTextStableDigest.sha256Hex(original))
        let sent = await transport.operations
        XCTAssertEqual(sent, [try XCTUnwrap(outbox["operationId"] as? String)])
        let staged = stateURL.deletingLastPathComponent().appendingPathComponent("outbox/" + sent[0] + ".textpack")
        XCTAssertEqual(try Data(contentsOf: staged), pending)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Note.textpack")), candidate)
        let resumed = try makeTestSync(root: root, binding: binding, transport: transport)
        _ = try await resumed.sync()
        let afterRestart = await transport.operations
        XCTAssertEqual(afterRestart, sent, "An unresolved replacement cannot replay or ACK the pending upload")
        let store = LocalVaultDocumentStore(root: root)
        let entry = try XCTUnwrap(store.replacementRecoveryList().first)
        try store.resolveReplacement(id: entry.id, path: entry.path, itemId: entry.itemId, currentHash: entry.currentHash,
                                     preparedHash: entry.preparedHash, displacedHash: entry.displacedHash)
        _ = try await resumed.sync()
        let retried = await transport.operations
        XCTAssertEqual(Array(retried.prefix(2)), [sent[0], sent[0]], "Explicit recovery resumes the original operation identity")
    }
}

private func replacementSyncPack(_ body: String, root: URL) throws -> Data {
    let scratch = root.appendingPathComponent(".fixture-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: scratch) }
    let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
    let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"replacement-sync-item\"\ntitle: Note\n---\n" + body,
        documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
    return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
}

private actor ReplacementSyncTransport: LocalVaultSyncTransport {
    let root: URL, candidate: Data, external: Data
    var data: Data
    var injected = false
    var operations: [String] = []
    init(root: URL, original: Data, candidate: Data, external: Data) {
        self.root = root; data = original; self.candidate = candidate; self.external = external
    }
    func manifest() -> [LocalVaultRemoteItem] {
        [.init(itemId: "replacement-sync-item", relativePath: "Note.textpack", revision: TextTextStableDigest.sha256Hex(data))]
    }
    func download(itemId: String) -> LocalVaultRemotePack { .init(data: data, relativePath: "Note.textpack", revision: TextTextStableDigest.sha256Hex(data)) }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) throws { throw LocalVaultSyncFailure.invalidResponse }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) throws -> String {
        operations.append(operationId); self.data = data
        if !injected {
            injected = true
            let operation = UUID(), target = root.appendingPathComponent(path)
            do {
                _ = try RetainedFileReplacement.replace(target, expectedHash: TextTextStableDigest.sha256Hex(data), prepared: candidate, operation: operation) { stage in
                    if stage == "prepared" {
                        try ReplacementRecoveryRegistry(root: self.root).register(operation: operation, itemId: itemId, path: path,
                            expectedHash: TextTextStableDigest.sha256Hex(data), preparedHash: TextTextStableDigest.sha256Hex(self.candidate))
                    }
                    if stage == "beforeSwap" { try self.external.write(to: target, options: .atomic) }
                }
            } catch RetainedFileReplacement.Failure.unresolved { }
        }
        return TextTextStableDigest.sha256Hex(data)
    }
}
