import Foundation
import XCTest
import TextTextSyncTestSupport
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

/// This exact test-only file is also compiled against pinned product 4f. It uses
/// no current v2 APIs. It never runs against a configured user workspace.
final class OldMacRenameProcessFixture: XCTestCase {
    func testExplicitOldProcess() async throws {
        guard let path = ProcessInfo.processInfo.environment["OLD_MAC_CONTROL"], let mode = ProcessInfo.processInfo.environment["OLD_MAC_MODE"] else { throw XCTSkip("Explicit frozen-old-process helper, not compatibility acceptance") }
        let control = URL(fileURLWithPath: path), root = control.appendingPathComponent("vault"), device = control.appendingPathComponent("device")
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(device)
        defer { _ = LocalVaultDeviceState.exchangeConfiguredBase(previous) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        if mode != "restart" { try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a") }
        let transport = OldMacFixtureTransport(control: control)
        func signal(_ name: String, _ value: [String: Any]) throws { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: control.appendingPathComponent(name), options: .withoutOverwriting) }
        let id = "e1111111-1111-4111-8111-111111111111", source = "Notes/Note.textpack", destination = "Notes/Moved.textpack"
        if mode == "held" {
            let doc = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\nOriginal", documentJSON: doc.documentJSON, templateJSON: doc.templateJSON, assets: [], sourceURL: nil, in: root)
            let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: pack, to: root.appendingPathComponent(source)); try FileManager.default.removeItem(at: pack)
            let original = try LocalVaultDocumentStore(root: root).read(path: source)
            let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
            _ = try await engine.sync(); _ = try await engine.sync()
            let session = try await engine.beginSharedEditing(itemId: id, path: source, expectedHash: original.hash)
            try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination))
            let journal: [String: Any] = ["version": 1, "journalGeneration": 1, "accountId": "account-a", "epoch": 1, "seq": 0, "revision": original.hash, "relativePath": source, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
            _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id, expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true, markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
            let report = try await engine.sync(); XCTAssertFalse(report.errors.isEmpty)
            try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: id)
            try signal("held-exited.json", ["requests": await transport.renameCalls()])
        } else if mode == "idle" {
            let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
            let store = LocalVaultDocumentStore(root: root), preloaded = try LocalVaultDocumentStore(root: root).read(path: destination)
            try signal("idle-ready.json", ["ready": true, "preloadedHash": preloaded.hash])
            try await oldMacWait(control.appendingPathComponent("idle-go"))
            let changed = try BuiltinTextPackDocument.create(title: "Note", body: "Old write must refuse")
            var writeRefused = false
            do { _ = try store.write(path: destination, expectedHash: preloaded.hash, markdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\nOld write must refuse", documentJSON: changed.documentJSON, templateJSON: nil, templateAuthoringSourceJSON: nil) }
            catch RetainedReplacementProfile.Failure.invalidProfile { writeRefused = true }
            catch { XCTFail("Unexpected old write refusal type: \(type(of: error))") }
            XCTAssertTrue(writeRefused)
            try signal("write-result.json", ["refused": writeRefused, "reason": "invalid-profile"])
            try await oldMacWait(control.appendingPathComponent("idle-sync-go"))
            var refused = false, reason = "none"
            do { _ = try await engine.sync() }
            catch LocalVaultSharedRename.Failure.invalid { refused = true; reason = "invalid-saved-record" }
            catch RetainedReplacementProfile.Failure.invalidProfile { refused = true; reason = "invalid-profile" }
            catch { XCTFail("Unexpected old refusal type: \(type(of: error))"); reason = "unexpected" }
            let calls = await transport.manifestCalls(); XCTAssertTrue(refused); XCTAssertEqual(calls, 0)
            try signal("idle-result.json", ["refused": refused, "reason": reason, "manifestCalls": calls, "renameCalls": await transport.renameCalls()])
        } else if mode == "restart" {
            var refused = false, reason = "none"
            do { try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"); _ = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a") }
            catch RetainedReplacementProfile.Failure.invalidProfile { refused = true; reason = "invalid-profile" }
            catch LocalVaultSharedRename.Failure.invalid { refused = true; reason = "invalid-saved-record" }
            catch { XCTFail("Unexpected old restart refusal type: \(type(of: error))"); reason = "unexpected" }
            let calls = await transport.manifestCalls(); XCTAssertTrue(refused); XCTAssertEqual(calls, 0)
            try signal("restart-result.json", ["refused": refused, "reason": reason, "manifestCalls": calls, "renameCalls": await transport.renameCalls()])
        } else { XCTFail("Unknown old process mode") }
    }
}
private func oldMacWait(_ path: URL) async throws {
    let deadline = Date().addingTimeInterval(120)
    while !FileManager.default.fileExists(atPath: path.path) { guard Date() < deadline else { throw LocalVaultSyncFailure.changed }; try await Task.sleep(nanoseconds: 20_000_000) }
}
private actor OldMacFixtureTransport: LocalVaultSyncTransport {
    nonisolated let protectedRenameBinding: LocalVaultProtectedRenameScope? = .init(origin: "https://texttext.test", workspaceId: "workspace", accountId: "account-a")
    let control: URL
    var items: [String: LocalVaultRemoteItem] = [:], packs: [String: Data] = [:]
    var manifests = 0, renames = 0
    init(control: URL) { self.control = control }
    func manifestCalls() -> Int { manifests }
    func renameCalls() -> Int { renames }
    func manifest() async throws -> [LocalVaultRemoteItem] { manifests += 1; return Array(items.values) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { let item = items[itemId]!; return .init(data: packs[itemId]!, relativePath: item.relativePath, revision: item.revision) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String {
        let hash = TextTextStableDigest.sha256Hex(data); packs[itemId] = data; items[itemId] = .init(itemId: itemId, relativePath: path, revision: hash, lifecycle: "owned-generation"); return hash
    }
    func protectedRename(_ request: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt {
        renames += 1
        try JSONEncoder().encode(request).write(to: control.appendingPathComponent("held-request.json"), options: .withoutOverwriting)
        try await oldMacWait(control.appendingPathComponent("held-release"))
        throw LocalVaultSyncFailure.httpStatus(503)
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
