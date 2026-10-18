import XCTest
import Darwin
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultFolderCaseSyncTests: XCTestCase {
    private struct Fixture { let root: URL; let binding: LocalVaultSyncBinding; let remote: FolderCaseTransport; let bytes: Data? }
    private func fixture(empty: Bool = false) async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folder-case-sync-" + UUID().uuidString).standardizedFileURL.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://folder-case.test")!, workspaceId: "fixture")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let remote = FolderCaseTransport()
        var bytes: Data?
        if !empty {
            let scratch = root.appendingPathComponent(".pack"); try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
            let document = try BuiltinTextPackDocument.create(title: "Case fixture", body: "Original body")
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: case-item\n---\nOriginal body", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
            bytes = try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch)); try FileManager.default.removeItem(at: scratch)
            await remote.seed(bytes!)
        }
        return .init(root: root, binding: binding, remote: remote, bytes: bytes)
    }
    private func engine(_ f: Fixture) throws -> LocalVaultSync { try makeTestSync(root: f.root, binding: f.binding, transport: f.remote, accountId: "account-a") }
    private func externalMove(_ root: URL) throws { guard rename(root.appendingPathComponent("Case").path, root.appendingPathComponent("CASE").path) == 0 else { throw POSIXError(.init(rawValue: errno)!) } }
    func testWholeFolderEmptyDescendantAndLostReplyReplayAcrossRestart() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await engine(f).sync(); try externalMove(f.root); await f.remote.loseNextReply()
        do { _ = try await engine(f).sync(); XCTFail("Expected lost reply") } catch FolderCaseTransport.Failure.lostReply { }
        let statePath = LocalVaultDeviceState.directory(root: f.root).appendingPathComponent("sync/state.json")
        let before = try Data(contentsOf: statePath); let state = try XCTUnwrap(JSONSerialization.jsonObject(with: before) as? [String: Any]); XCTAssertNotNil(state["folderCaseCommand"])
        _ = try await engine(f).sync(); let calls = await f.remote.commands(); XCTAssertEqual(calls.count, 2); XCTAssertEqual(calls[0], calls[1]); XCTAssertEqual(calls[0].folders, ["Case", "Case/Empty"])
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: f.root, path: "Case")); XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: f.root, path: "CASE/Empty"))
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("CASE/one.textpack")), f.bytes)
        let writes = await f.remote.fileWrites(); XCTAssertEqual(writes, 0)
    }
    func testAdvertisedUnbaselinedRetainedOriginalRefusesInsteadOfRecreatingFolder() async throws {
        let f = try await fixture(empty: true); defer { try? FileManager.default.removeItem(at: f.root) }
        await f.remote.support(false); _ = try await engine(f).sync(); try externalMove(f.root); await f.remote.support(true)
        do { _ = try await engine(f).sync(); XCTFail("A retained original spelling without its inode baseline needs review") } catch LocalVaultSyncFailure.changed { }
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: f.root, path: "Case")); XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: f.root, path: "CASE/Empty")); let calls = await f.remote.commands(); XCTAssertTrue(calls.isEmpty)
    }
    func testAdvertisedIncomingCaseMoveDoesNotMistakeNewCatalogSpellingForOutgoingChange() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        await f.remote.support(false); _ = try await engine(f).sync(); await f.remote.incomingCaseMove(); await f.remote.support(true)
        let report = try await engine(f).sync(); XCTAssertTrue(report.errors.isEmpty)
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: f.root, path: "CASE/Empty")); XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: f.root, path: "Case"))
        let calls = await f.remote.commands(); XCTAssertTrue(calls.isEmpty); XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("CASE/one.textpack")), f.bytes)
    }
    func testEmptyOnlyFolderMoveIsNotSkipped() async throws {
        let f = try await fixture(empty: true); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await engine(f).sync(); try externalMove(f.root); _ = try await engine(f).sync()
        let calls = await f.remote.commands(); XCTAssertEqual(calls.count, 1); XCTAssertTrue(calls[0].items.isEmpty)
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: f.root, path: "CASE/Empty")); XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: f.root, path: "Case"))
    }
    func testConflictReplyStillAllowsExactReceiptRetry() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await engine(f).sync(); try externalMove(f.root); await f.remote.conflictAfterCommit()
        do { _ = try await engine(f).sync(); XCTFail("Expected conflict") } catch LocalVaultSyncFailure.conflict { }
        _ = try await engine(f).sync(); let calls = await f.remote.commands(); XCTAssertEqual(calls.count, 2); XCTAssertEqual(calls[0], calls[1])
    }
    func testPendingSharedJournalSurvivesMoveAndCheckpointAcknowledgementFencesDuringRPC() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let sync = try engine(f); _ = try await sync.sync()
        let original = try LocalVaultDocumentStore(root: f.root).read(path: "Case/one.textpack")
        let session = try await sync.beginSharedEditing(itemId: "case-item", path: original.path, expectedHash: original.hash)
        let document = try BuiltinTextPackDocument.create(title: "Pending fixture", body: "Retained pending body")
        let journal = "{\"version\":1,\"accountId\":\"account-a\",\"epoch\":2,\"seq\":3,\"journalGeneration\":7,\"revision\":\"" + original.hash + "\",\"relativePath\":\"Case/one.textpack\",\"update\":\"AAA=\",\"pending\":[\"AAA=\"],\"batch\":{\"operationId\":\"retained-batch\",\"updates\":[\"AAA=\"]}}"
        let saved = try await sync.materializeSharedEditing(sessionToken: session.sessionToken, itemId: "case-item", expectedHash: original.hash, epoch: 2, seq: 3, acknowledgedRevision: original.hash, journalGeneration: 7, journal: journal, pending: true,
            markdown: "---\ntextTextId: case-item\n---\nRetained pending body", documentJSON: document.documentJSON)
        let beforeValue = try await sync.readSharedCheckpoint(itemId: "case-item"); let before = try XCTUnwrap(beforeValue)
        try externalMove(f.root); await f.remote.holdNext(); let task = Task { try await sync.sync() }; await f.remote.waitUntilHeld()
        do {
            _ = try await sync.materializeSharedEditing(sessionToken: session.sessionToken, itemId: "case-item", expectedHash: saved.document.hash, epoch: 2, seq: 3, acknowledgedRevision: original.hash, journalGeneration: 8, journal: journal, pending: false,
                markdown: "---\ntextTextId: case-item\n---\nRetained pending body", documentJSON: document.documentJSON)
            XCTFail("No clean checkpoint ACK may escape while folder receipt is pending")
        } catch LocalVaultSyncFailure.busy { }
        let heldValue = try await sync.readSharedCheckpoint(itemId: "case-item"); let held = try XCTUnwrap(heldValue); XCTAssertEqual(held.journal, before.journal); XCTAssertEqual(held.journalGeneration, 7)
        await f.remote.release(); _ = try await task.value
        let afterValue = try await sync.readSharedCheckpoint(itemId: "case-item"); let after = try XCTUnwrap(afterValue); XCTAssertEqual(after.path, "CASE/one.textpack"); XCTAssertEqual(after.epoch, 2); XCTAssertEqual(after.seq, 3); XCTAssertEqual(after.journalGeneration, 7); XCTAssertTrue(after.pending)
        let oldJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(before.journal.utf8)) as? [String: Any]); let newJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(after.journal.utf8)) as? [String: Any]);
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: oldJSON["batch"]!, options: .sortedKeys), try JSONSerialization.data(withJSONObject: newJSON["batch"]!, options: .sortedKeys))
        try await sync.endSharedEditing(sessionToken: session.sessionToken, itemId: "case-item")
    }
    func testChangedTreeDuringAwaitRetainsCommandAndDoesNotRecreateOldPath() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await engine(f).sync(); try externalMove(f.root); await f.remote.holdNext()
        let sync = try engine(f); let task = Task { try await sync.sync() }; await f.remote.waitUntilHeld()
        do { _ = try await sync.beginSharedEditing(itemId: "other", path: "CASE/one.textpack", expectedHash: String(repeating: "a", count: 64)); XCTFail("New joins must fence") } catch LocalVaultSyncFailure.busy { }
        try Data("retain foreign file".utf8).write(to: f.root.appendingPathComponent("CASE/extra.txt")); await f.remote.release()
        do { _ = try await task.value; XCTFail("Changed whole tree must refuse receipt adoption") } catch LocalVaultSyncFailure.changed { }
        let path = LocalVaultDeviceState.directory(root: f.root).appendingPathComponent("sync/state.json"); let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any]); XCTAssertNotNil(state["folderCaseCommand"])
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: f.root, path: "Case")); XCTAssertEqual(try String(contentsOf: f.root.appendingPathComponent("CASE/extra.txt"), encoding: .utf8), "retain foreign file")
    }
}

private actor FolderCaseTransport: LocalVaultSyncTransport {
    enum Failure: Error { case lostReply }
    private var records: [LocalVaultRemoteItem] = [], bytes: Data?, catalog = ["Case", "Case/Empty"], revision = String(repeating: "a", count: 64)
    private var supported = true
    private var sent: [LocalVaultFolderCaseRequest] = [], receipt: LocalVaultFolderCaseReceipt?, writes = 0, lose = false, conflict = false, hold = false
    private var held: CheckedContinuation<Void, Never>?, waiter: CheckedContinuation<Void, Never>?
    func seed(_ data: Data) { bytes = data; records = [.init(itemId: "case-item", relativePath: "Case/one.textpack", revision: TextTextStableDigest.sha256Hex(data))] }
    func manifest() async throws -> [LocalVaultRemoteItem] { records }
    func folders() async -> [String] { catalog }
    func authoritativeFolders() async -> [String]? { catalog }
    func folderCaseContext() async -> LocalVaultFolderCaseContext? { supported ? .init(manifestRevision: revision, folders: catalog) : nil }
    func support(_ value: Bool) { supported = value }
    func incomingCaseMove() { catalog = ["CASE", "CASE/Empty"]; revision = String(repeating: "c", count: 64); records = records.map { .init(itemId: $0.itemId, relativePath: $0.relativePath.replacingOccurrences(of: "Case/", with: "CASE/"), revision: $0.revision) } }
    func binaryManifest(itemId: String) async throws -> LocalVaultBinaryManifest { .init(revision: records[0].revision, entries: []) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { .init(data: bytes!, relativePath: records[0].relativePath, revision: records[0].revision) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { writes += 1; throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { writes += 1; throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { writes += 1; throw LocalVaultSyncFailure.invalidResponse }
    func moveFolderCase(_ request: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseReceipt {
        sent.append(request)
        if hold { hold = false; await withCheckedContinuation { held = $0; waiter?.resume(); waiter = nil } }
        if receipt == nil {
            catalog = request.folders.map { LocalVaultFolderCaseSync.rebase($0, request.source, request.destination) }; revision = String(repeating: "b", count: 64)
            records = records.map { .init(itemId: $0.itemId, relativePath: LocalVaultFolderCaseSync.rebase($0.relativePath, request.source, request.destination), revision: $0.revision) }
            receipt = .init(operationId: request.operationId, status: "moved", source: request.source, destination: request.destination, manifestRevision: revision, folders: catalog, items: records.map { .init(itemId: $0.itemId, relativePath: $0.relativePath, revision: $0.revision) })
        }
        if lose { lose = false; throw Failure.lostReply }; if conflict { conflict = false; throw LocalVaultSyncFailure.conflict }; return receipt!
    }
    func loseNextReply() { lose = true }; func conflictAfterCommit() { conflict = true }; func holdNext() { hold = true }
    func waitUntilHeld() async { if held != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { held?.resume(); held = nil }
    func commands() -> [LocalVaultFolderCaseRequest] { sent }; func fileWrites() -> Int { writes }
}
