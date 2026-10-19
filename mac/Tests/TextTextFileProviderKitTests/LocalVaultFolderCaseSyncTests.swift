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
    func testFolderPolicyAwaitRetainsChangedDurableStateWithoutDispatch() async throws {
        let f = try await fixture(empty: true); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await engine(f).sync(); try externalMove(f.root)
        let mutation = FolderPolicyStateMutation(root: f.root)
        let sync = try LocalVaultSync(root: f.root, binding: f.binding, transport: f.remote, accountId: "account-a",
            mirrorPolicy: makeTestMirrorPolicy(workspaceId: f.binding.workspaceId, accountId: "account-a", beforeRequest: { try await mutation.apply($0) }))
        do { _ = try await sync.sync(); XCTFail("Changed durable state must refuse") } catch LocalVaultSyncFailure.changed { }
        let captured = await mutation.bytes()
        let changed = try XCTUnwrap(captured)
        let url = LocalVaultDeviceState.directory(root: f.root).appendingPathComponent("sync/state.json")
        XCTAssertEqual(try Data(contentsOf: url), changed)
        let commands = await f.remote.commands(); XCTAssertTrue(commands.isEmpty)
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: f.root, path: "CASE/Empty"))
    }
    func testRecoveryOfflineThenExplicitCancellationRetainsFilesAndReceipt() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let sync = try engine(f); _ = try await sync.sync(); try externalMove(f.root)
        await f.remote.rejectBeforeCommit()
        do { _ = try await sync.sync(); XCTFail("Expected rejection") } catch LocalVaultSyncFailure.conflict { }
        let commands = await f.remote.commands(); let command = try XCTUnwrap(commands.last)
        await f.remote.recoveryOffline(true)
        let offline = try await sync.folderSyncMoveRead(id: command.operationId)
        XCTAssertEqual(offline.state, "unavailable"); XCTAssertNil(offline.requestHash); XCTAssertNotNil(offline.resolutionBlocked)
        await f.remote.recoveryOffline(false)
        let row = try await sync.folderSyncMoveRead(id: command.operationId)
        XCTAssertEqual(row.state, "review"); XCTAssertNil(row.resolutionBlocked)
        do { try await sync.resolveFolderSyncMove(id: row.id, inspection: row.inspection, localInspection: String(repeating: "0", count: 64), requestHash: row.requestHash!); XCTFail("Stale local consent must refuse") } catch LocalVaultSyncFailure.changed { }
        let zeroCancels = await f.remote.cancellations(); XCTAssertEqual(zeroCancels, 0)
        try await sync.resolveFolderSyncMove(id: row.id, inspection: row.inspection, localInspection: row.localInspection, requestHash: row.requestHash!)
        let rows = try await sync.folderSyncMoveList(); XCTAssertTrue(rows.isEmpty)
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("CASE/one.textpack")), f.bytes)
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: f.root, path: "Case"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: LocalVaultDeviceState.directory(root: f.root).appendingPathComponent("sync/folder-case-cancellations/" + row.id + ".json").path))
        let oneCancel = await f.remote.cancellations(); XCTAssertEqual(oneCancel, 1)
    }
    func testCancelledServerReceiptSurvivesRevokedAcknowledgementAndRestart() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let sync = try engine(f); _ = try await sync.sync(); try externalMove(f.root); await f.remote.rejectBeforeCommit()
        do { _ = try await sync.sync(); XCTFail("Expected rejection") } catch LocalVaultSyncFailure.conflict { }
        let commands = await f.remote.commands(), command = try XCTUnwrap(commands.last)
        let row = try await sync.folderSyncMoveRead(id: command.operationId), guardState = RecoveryCallbackCounter()
        do {
            try await sync.resolveFolderSyncMove(id: row.id, inspection: row.inspection, localInspection: row.localInspection, requestHash: row.requestHash!, beforeAcknowledge: { try await guardState.check() })
            XCTFail("Revoked post-network scope must retain pending command")
        } catch is CancellationError { }
        let resumed = try engine(f), tombstone = try await resumed.folderSyncMoveRead(id: command.operationId)
        XCTAssertEqual(tombstone.state, "cancelled")
        try await resumed.resolveFolderSyncMove(id: tombstone.id, inspection: tombstone.inspection, localInspection: tombstone.localInspection, requestHash: tombstone.requestHash!)
        let cancellations = await f.remote.cancellations(); XCTAssertEqual(cancellations, 1)
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("CASE/one.textpack")), f.bytes)
    }
    func testCompletedRecoveryUsesReceiptWithoutCancelling() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let sync = try engine(f); _ = try await sync.sync(); try externalMove(f.root); await f.remote.loseNextReply()
        do { _ = try await sync.sync(); XCTFail("Expected lost reply") } catch FolderCaseTransport.Failure.lostReply { }
        let commands = await f.remote.commands(); let command = try XCTUnwrap(commands.last), row = try await sync.folderSyncMoveRead(id: command.operationId)
        XCTAssertEqual(row.state, "completed"); XCTAssertNil(row.inspection); XCTAssertNil(row.folders); XCTAssertNil(row.manifestRevision)
        try await sync.resolveFolderSyncMove(id: row.id, inspection: nil, localInspection: row.localInspection, requestHash: row.requestHash!)
        let zeroCancels = await f.remote.cancellations(); XCTAssertEqual(zeroCancels, 0)
        let rows = try await sync.folderSyncMoveList(); XCTAssertTrue(rows.isEmpty)
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("CASE/one.textpack")), f.bytes)
    }
    func testRecoveryRejectsWrongCommandAndWrongCompletedReceipt() async throws {
        let f = try await fixture(empty: true); defer { try? FileManager.default.removeItem(at: f.root) }
        let command = LocalVaultFolderCaseRequest(operationId: UUID().uuidString, source: "Case", destination: "CASE", baseManifestRevision: String(repeating: "a", count: 64), folders: ["Case", "Case/Empty"], items: [])
        let wrong = LocalVaultFolderCaseServerRecovery(state: "cancelled", requestHash: String(repeating: "d", count: 64), operationId: UUID().uuidString, source: command.source, destination: command.destination, inspection: String(repeating: "e", count: 64), manifestRevision: String(repeating: "a", count: 64), folders: nil, items: nil, result: nil)
        XCTAssertThrowsError(try LocalVaultFolderCaseSync.validateRecovery(wrong, command: command, root: f.root))
        let receipt = LocalVaultFolderCaseReceipt(operationId: command.operationId, status: "moved", source: command.source, destination: command.destination, manifestRevision: String(repeating: "b", count: 64), folders: ["CASE"], items: [])
        let completed = LocalVaultFolderCaseServerRecovery(state: "completed", requestHash: String(repeating: "d", count: 64), operationId: nil, source: nil, destination: nil, inspection: nil, manifestRevision: nil, folders: nil, items: nil, result: receipt)
        XCTAssertThrowsError(try LocalVaultFolderCaseSync.validateRecovery(completed, command: command, root: f.root))
    }
    func testAutomaticCommandWireBoundsBeforeQueue() throws {
        func request(_ path: String, _ items: Int = 0) -> LocalVaultFolderCaseRequest {
            .init(operationId: UUID().uuidString, source: path, destination: path.uppercased(), baseManifestRevision: String(repeating: "a", count: 64), folders: [path], items: (0..<items).map { .init(itemId: "item-\($0)", relativePath: path + "/one.textpack", revision: String(repeating: "b", count: 64)) })
        }
        XCTAssertNoThrow(try LocalVaultFolderCaseSync.validateWire(request("Case")))
        XCTAssertThrowsError(try LocalVaultFolderCaseSync.validateWire(request(String(repeating: "a", count: 257))))
        XCTAssertThrowsError(try LocalVaultFolderCaseSync.validateWire(request("Case", 20_001)))
        let oversized = LocalVaultFolderCaseRequest(operationId: UUID().uuidString, source: "Case", destination: "CASE", baseManifestRevision: String(repeating: "a", count: 64), folders: ["Case"], items: (0..<20_000).map { .init(itemId: String(repeating: "i", count: 128) + String($0), relativePath: "Case/" + String(repeating: "p", count: 128) + String($0) + ".textpack", revision: String(repeating: "b", count: 64)) })
        XCTAssertThrowsError(try LocalVaultFolderCaseSync.validateWire(oversized))
    }
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
        let recoveryWhileHeld = try await sync.folderSyncMoveList()
        XCTAssertEqual(recoveryWhileHeld.count, 1); XCTAssertEqual(recoveryWhileHeld.first?.state, "review")
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
    private var reject = false, offline = false, cancelled = false, cancelCount = 0
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
        if reject { reject = false; throw LocalVaultSyncFailure.conflict }
        if hold { hold = false; await withCheckedContinuation { held = $0; waiter?.resume(); waiter = nil } }
        if receipt == nil {
            catalog = request.folders.map { LocalVaultFolderCaseSync.rebase($0, request.source, request.destination) }; revision = String(repeating: "b", count: 64)
            records = records.map { .init(itemId: $0.itemId, relativePath: LocalVaultFolderCaseSync.rebase($0.relativePath, request.source, request.destination), revision: $0.revision) }
            receipt = .init(operationId: request.operationId, status: "moved", source: request.source, destination: request.destination, manifestRevision: revision, folders: catalog, items: records.map { .init(itemId: $0.itemId, relativePath: $0.relativePath, revision: $0.revision) })
        }
        if lose { lose = false; throw Failure.lostReply }; if conflict { conflict = false; throw LocalVaultSyncFailure.conflict }; return receipt!
    }
    func rejectBeforeCommit() { reject = true }
    func recoveryOffline(_ value: Bool) { offline = value }
    func cancellations() -> Int { cancelCount }
    func inspectFolderCase(_ command: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseServerRecovery {
        if offline { throw URLError(.notConnectedToInternet) }
        if let receipt { return .init(state: "completed", requestHash: String(repeating: "d", count: 64), operationId: nil, source: nil, destination: nil, inspection: nil, manifestRevision: nil, folders: nil, items: nil, result: receipt) }
        return .init(state: cancelled ? "cancelled" : "review", requestHash: String(repeating: "d", count: 64), operationId: command.operationId, source: command.source, destination: command.destination, inspection: String(repeating: "e", count: 64), manifestRevision: revision, folders: cancelled ? nil : catalog, items: cancelled ? nil : records.map { .init(itemId: $0.itemId, relativePath: $0.relativePath, revision: $0.revision) }, result: nil)
    }
    func cancelFolderCase(_ command: LocalVaultFolderCaseRequest, inspection: String) async throws -> LocalVaultFolderCaseServerRecovery {
        cancelCount += 1; cancelled = true; return try await inspectFolderCase(command)
    }
    func loseNextReply() { lose = true }; func conflictAfterCommit() { conflict = true }; func holdNext() { hold = true }
    func waitUntilHeld() async { if held != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { held?.resume(); held = nil }
    func commands() -> [LocalVaultFolderCaseRequest] { sent }; func fileWrites() -> Int { writes }
}

private actor RecoveryCallbackCounter {
    private var calls = 0
    func check() throws { calls += 1; if calls == 3 { throw CancellationError() } }
}

private actor FolderPolicyStateMutation {
    let root: URL
    private var changed: Data?
    init(root: URL) { self.root = root }
    func bytes() -> Data? { changed }
    func apply(_ script: String) throws {
        guard changed == nil, script.contains(".folder(") else { return }
        let url = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        // An actual concurrent valid state change, not an expected editor snapshot.
        object["cursor"] = 17
        let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try bytes.write(to: url, options: [.atomic]); changed = bytes
    }
}
