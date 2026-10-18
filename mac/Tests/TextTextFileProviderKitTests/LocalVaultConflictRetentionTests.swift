import Foundation
import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultConflictRetentionTests: XCTestCase {
    private let id = "cf111111-1111-4111-8111-111111111111"
    private func pack(_ body: String, root: URL) throws -> Data {
        let scratch = root.appendingPathComponent(".fixture-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\(body)",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    func testMissingOrCorruptStagedPackCannotBecomeRemoteOnlyRecovery() async throws {
        for action in ["upload", "rename"] {
            for tombstone in [false, true] {
                for damage in ["missing", "corrupt", "recovery", "journal"] {
                    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                    defer { try? FileManager.default.removeItem(at: root) }
                    let original = try pack("original", root: root), local = try pack("original pending edit", root: root), remote = try pack("competing remote", root: root)
                    let transport = ConflictRetentionTransport(root: root, itemId: id, data: original, damage: damage, tombstone: tombstone)
                    let binding = try LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace")
                    let initial = try makeTestSync(root: root, binding: binding, transport: transport)
                    _ = try await initial.sync()
                    let target = root.appendingPathComponent(action == "rename" ? "Moved.textpack" : "Note.textpack")
                    if action == "rename" { try FileManager.default.moveItem(at: root.appendingPathComponent("Note.textpack"), to: target) }
                    try local.write(to: target, options: .atomic)
                    await transport.compete(with: remote)
                    var report = LocalVaultSyncReport()
                    var journalFailure: Error?
                    do { report = try await initial.sync() }
                    catch { if damage == "journal" { journalFailure = error } else { throw error } }
                    let operations = await transport.operations
                    let operation = try XCTUnwrap(operations.first)
                    let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
                    if damage == "journal" {
                        if FileManager.default.fileExists(atPath: stateURL.path) { try FileManager.default.removeItem(at: stateURL) }
                        try FileManager.default.moveItem(at: stateURL.appendingPathExtension("fixture-retained"), to: stateURL)
                    }
                    let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
                    let pending = try XCTUnwrap((state["outbox"] as? [String: [String: Any]])?[id], "Original operation must survive \(action)/\(damage)/tombstone=\(tombstone)")
                    XCTAssertEqual(pending["operationId"] as? String, operation)
                    XCTAssertTrue(!report.errors.isEmpty || journalFailure != nil)
                    if damage != "journal" { XCTAssertTrue(report.conflicts.isEmpty, "Missing original bytes cannot be reported as completed recovery") }
                    XCTAssertEqual(try Data(contentsOf: target), local)
                    let staged = stateURL.deletingLastPathComponent().appendingPathComponent("outbox/" + operation + ".textpack")
                    try local.write(to: staged, options: .atomic)
                    if damage == "recovery" {
                        let damaged = root.appendingPathComponent(".texttext/conflicts/" + operation + "/local-Note.textpack")
                        XCTAssertEqual(try Data(contentsOf: damaged), Data("corrupt recovery".utf8), "Corrupt existing copy must not be overwritten")
                        try FileManager.default.moveItem(at: damaged, to: damaged.appendingPathExtension("fixture-quarantine"))
                    }
                    await transport.repair()
                    let resumed = try damage == "journal" ? initial : makeTestSync(root: root, binding: binding, transport: transport)
                    let recovered = try await resumed.sync()
                    XCTAssertTrue(recovered.errors.isEmpty)
                    let retried = await transport.operations
                    XCTAssertEqual(retried, [operation, operation])
                    let after = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
                    XCTAssertNil((after["outbox"] as? [String: Any])?[id])
                    let paths = Array(Set(recovered.conflicts))
                    XCTAssertEqual(paths.count, tombstone ? 1 : 2)
                    XCTAssertTrue(try paths.contains { try Data(contentsOf: root.appendingPathComponent($0)) == local })
                    if !tombstone { XCTAssertTrue(try paths.contains { try Data(contentsOf: root.appendingPathComponent($0)) == remote }) }
                    else {
                        let marker = root.appendingPathComponent(".texttext/conflicts/" + operation + "/remote-deletion.json")
                        let deleted = try JSONDecoder().decode(LocalVaultRemoteItem.self, from: Data(contentsOf: marker))
                        XCTAssertEqual(deleted.itemId, id)
                        XCTAssertEqual(deleted.revision, TextTextStableDigest.sha256Hex(remote))
                        XCTAssertTrue(deleted.isDeleted)
                    }
                }
            }
        }
    }
}

private actor ConflictRetentionTransport: LocalVaultSyncTransport {
    let root: URL, itemId: String, damage: String, tombstone: Bool
    var data: Data
    var competing = false, hasConflicted = false, damageEnabled = true
    var operations: [String] = []
    init(root: URL, itemId: String, data: Data, damage: String, tombstone: Bool) {
        self.root = root; self.itemId = itemId; self.data = data; self.damage = damage; self.tombstone = tombstone
    }
    func compete(with data: Data) { self.data = data; competing = true }
    func repair() { damageEnabled = false }
    func manifest() -> [LocalVaultRemoteItem] {
        [.init(itemId: itemId, relativePath: "Note.textpack", revision: TextTextStableDigest.sha256Hex(data), deleted: tombstone && hasConflicted)]
    }
    func download(itemId: String) -> LocalVaultRemotePack { .init(data: data, relativePath: "Note.textpack", revision: TextTextStableDigest.sha256Hex(data)) }
    func conflict(_ operationId: String) throws -> Never {
        operations.append(operationId)
        if damageEnabled {
            let file = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/outbox/" + operationId + ".textpack")
            if damage == "missing" { try FileManager.default.removeItem(at: file) }
            else if damage == "corrupt" { try Data("corrupted staged payload".utf8).write(to: file) }
            else if damage == "journal" {
                let state = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
                try FileManager.default.moveItem(at: state, to: state.appendingPathExtension("fixture-retained"))
                try FileManager.default.createDirectory(at: state, withIntermediateDirectories: false)
            } else {
                let bad = root.appendingPathComponent(".texttext/conflicts/" + operationId + "/local-Note.textpack")
                try FileManager.default.createDirectory(at: bad.deletingLastPathComponent(), withIntermediateDirectories: true)
                try Data("corrupt recovery".utf8).write(to: bad)
            }
        }
        hasConflicted = true
        throw LocalVaultSyncFailure.conflict
    }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) throws -> String {
        try conflict(operationId)
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String { try conflict(operationId) }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) throws { try conflict(operationId) }
}
