import XCTest
import ZIPFoundation
import TextTextSyncTestSupport
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultSavedRenameIntegrationTests: XCTestCase {
    private var root: URL!, device: URL!, previousBase: URL?
    private let id = "e1111111-1111-4111-8111-111111111111"
    private let source = "Notes/Note.textpack", destination = "Notes/Moved.textpack"
    private var binding: LocalVaultSyncBinding { get throws { try .init(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace") } }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        device = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        previousBase = LocalVaultDeviceState.exchangeConfiguredBase(device)
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
    }
    override func tearDownWithError() throws {
        _ = LocalVaultDeviceState.exchangeConfiguredBase(previousBase)
        try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: device)
    }
    private func fixture() throws -> LocalVaultDocumentStore.Document {
        let document = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\nOriginal", documentJSON: document.documentJSON, templateJSON: document.templateJSON,
            assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        let url = root.appendingPathComponent(source)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pack, to: url)
        try FileManager.default.removeItem(at: pack)
        return try LocalVaultDocumentStore(root: root).read(path: source)
    }
    private func journal(_ original: LocalVaultDocumentStore.Document, generation: Int = 1) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: ["version": 1, "journalGeneration": generation, "accountId": "account-a", "epoch": 1, "seq": 0, "revision": original.hash, "relativePath": source, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]), as: UTF8.self)
    }
    private func prepared(_ transport: SavedRenameTransport) async throws -> (LocalVaultSync, LocalVaultDocumentStore.Document, String) {
        let original = try fixture()
        let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        _ = try await engine.sync(); _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: id, path: source, expectedHash: original.hash)
        try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination))
        _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: journal(original), pending: true,
            markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
        return (engine, original, session.sessionToken)
    }
    private func state() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json"))) as? [String: Any])
    }
    func testMovedReceiptClearsIntentWithoutChangingProjectionHash() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 1); XCTAssertEqual(requests.first?.source, source); XCTAssertEqual(requests.first?.destination, destination)
        let map = try XCTUnwrap(state()["sharedRenames"] as? [String: Any]); XCTAssertTrue(map.isEmpty)
        let checkpoint = try await engine.readSharedCheckpoint(itemId: id)
        XCTAssertEqual(checkpoint?.projectedHash, original.hash)
        let baselines = try XCTUnwrap(state()["baselines"] as? [String: [String: Any]])
        XCTAssertEqual(baselines[id]?["localHash"] as? String, original.hash)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testLostReplyReplaysExactSavedRequestAfterLaterLocalMove() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("lost-after-commit")
        let failed = try await engine.sync(); XCTAssertFalse(failed.errors.isEmpty)
        let before = try XCTUnwrap((state()["sharedRenames"] as? [String: Any])?[id] as? [String: Any])
        let next = "Notes/Later.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(destination), to: root.appendingPathComponent(next))
        await transport.setMode("moved")
        _ = try await engine.sync()
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 2); XCTAssertEqual(requests[0], requests[1])
        XCTAssertEqual((before["request"] as? [String: Any])?["operationId"] as? String, requests[0].operationId)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(next).path))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testRestartReplayPreservesSeparatelyAcknowledgedRevisionAndHash() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("lost-after-commit"); _ = try await engine.sync()
        let revisionC = String(repeating: "c", count: 64)
        var document = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(original.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(document["content"] as? [String: Any]); content["body"] = "Acknowledged C"; document["content"] = content
        let acknowledgedJournal: [String: Any] = ["version": 1, "journalGeneration": 2, "accountId": "account-a", "epoch": 1, "seq": 1,
            "revision": revisionC, "relativePath": destination, "update": "AQ==", "pending": [], "batch": NSNull()]
        let checkpoint = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 1, acknowledgedRevision: revisionC, journalGeneration: 2,
            journal: String(decoding: JSONSerialization.data(withJSONObject: acknowledgedJournal), as: UTF8.self), pending: false,
            markdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\nAcknowledged C",
            documentJSON: String(decoding: JSONSerialization.data(withJSONObject: document), as: UTF8.self))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        await transport.advanceRevision(String(repeating: "d", count: 64)); await transport.setMode("moved")
        let reopened = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        _ = try await reopened.sync()
        let requests = await transport.requests; XCTAssertEqual(requests.count, 2); XCTAssertEqual(requests[0], requests[1])
        XCTAssertEqual(requests[0].baseRevision, original.hash)
        let baseline = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(baseline["revision"] as? String, revisionC)
        XCTAssertEqual(baseline["localHash"] as? String, checkpoint.document.hash)
        XCTAssertEqual(baseline["path"] as? String, destination)
        XCTAssertTrue(try XCTUnwrap(state()["sharedRenames"] as? [String: Any]).isEmpty)
    }
    func testTypedConflictIsTerminalAndDoesNotBlockTextCheckpoint() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict")
        _ = try await engine.sync(); _ = try await engine.sync()
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        let record = try XCTUnwrap((state()["sharedRenames"] as? [String: Any])?[id] as? [String: Any])
        XCTAssertEqual(record["phase"] as? String, "terminal-rejected")
        let saved = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 2, journal: journal(original, generation: 2), pending: true,
            markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
        XCTAssertEqual(saved.document.path, destination); XCTAssertNil(saved.checkpoint.retiredReason)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testGenericConflictRetainsExactRequestAndAllowsExplicitRetry() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("generic409")
        _ = try await engine.sync()
        let requestsBefore = await transport.requests
        let list = try await engine.savedFileMoveList()
        XCTAssertEqual(list.entries.count, 1); XCTAssertFalse(list.truncated)
        let summary = try XCTUnwrap(list.entries.first)
        let row = try await engine.savedFileMoveRead(id: summary.id)
        XCTAssertEqual(row.state, "pending"); XCTAssertTrue(row.retryAllowed); XCTAssertFalse(row.keepNamesAllowed)
        await transport.setMode("moved")
        try await engine.retrySavedFileMove(id: row.id, requestHash: try XCTUnwrap(row.requestHash), inspection: try XCTUnwrap(row.inspection), consent: true)
        let requestsAfter = await transport.requests
        XCTAssertEqual(requestsAfter.count, 2); XCTAssertEqual(requestsBefore.first, requestsAfter.last)
        let empty = try await engine.savedFileMoveList(); XCTAssertTrue(empty.entries.isEmpty)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testTerminalKeepNamesSuppressesAcrossPeerTextAndRestart() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList(); let summary = try XCTUnwrap(list.entries.first)
        let row = try await engine.savedFileMoveRead(id: summary.id)
        XCTAssertTrue(row.keepNamesAllowed); XCTAssertFalse(row.retryAllowed)
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: try XCTUnwrap(row.requestHash), inspection: try XCTUnwrap(row.inspection), consent: true)
        await transport.advanceRevision(String(repeating: "b", count: 64))
        _ = try await engine.sync()
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        let stopped = try XCTUnwrap((state()["sharedRenames"] as? [String: Any])?[id] as? [String: Any]); XCTAssertEqual(stopped["phase"] as? String, "stopped")
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: destination).hash, original.hash)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        // A new actor reads the persisted stopped choice, rather than deriving
        // a fresh operation from peer text or the old baseline path.
        let reopened = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        _ = try await reopened.sync()
        let after = await transport.requests; XCTAssertEqual(after.count, 1)
    }
    func testStaleInspectionCannotKeepNamesAfterLocalMove() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList()
        let row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        let bytes = try Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json"))
        try FileManager.default.moveItem(at: root.appendingPathComponent(destination), to: root.appendingPathComponent("Notes/Later.textpack"))
        do { try await engine.keepSavedFileMoveNames(id: row.id, requestHash: try XCTUnwrap(row.requestHash), inspection: try XCTUnwrap(row.inspection), consent: true); XCTFail("Stale naming consent accepted") } catch { }
        XCTAssertEqual(try Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")), bytes)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testSummaryListPerformsZeroNetworkRequestsAndNoActionCertification() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("generic409"); _ = try await engine.sync()
        let before = await transport.manifestCalls
        let summary = try await engine.savedFileMoveList()
        let after = await transport.manifestCalls
        XCTAssertEqual(before, after)
        let row = try XCTUnwrap(summary.entries.first)
        XCTAssertNil(row.inspection); XCTAssertFalse(row.retryAllowed); XCTAssertFalse(row.keepNamesAllowed)
        await transport.setOffline(true)
        let offline = try await engine.savedFileMoveRead(id: row.id)
        XCTAssertEqual(offline.blockedReason, "unavailable"); XCTAssertEqual(offline.state, "review")
        XCTAssertNil(offline.inspection); XCTAssertFalse(offline.retryAllowed); XCTAssertFalse(offline.keepNamesAllowed)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testSummaryBoundsAndFilteringBeforeTakingLimit() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("generic409"); _ = try await engine.sync()
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        var saved = try state()
        let prototype = try XCTUnwrap((saved["sharedRenames"] as? [String: [String: Any]])?[id])
        var records: [String: Any] = [:]
        // Codec-valid retained records seed only this bounded-list fixture.
        // Their existence is not a claim that real server requests occurred.
        for index in 0..<101 {
            let item = "list-item-\(index)"
            var record = prototype, request = try XCTUnwrap(prototype["request"] as? [String: Any])
            request["operationId"] = UUID().uuidString.lowercased(); request["itemId"] = item
            request["source"] = "Notes/Source-\(index).textpack"; request["destination"] = "Notes/Destination-\(index).textpack"
            record["request"] = request; records[item] = record
        }
        saved["sharedRenames"] = records
        try JSONSerialization.data(withJSONObject: saved).write(to: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json"))
        let reopened = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        let before = await transport.manifestCalls
        let all = try await reopened.savedFileMoveList(); XCTAssertEqual(all.entries.count, 100); XCTAssertTrue(all.truncated)
        let filtered = try await reopened.savedFileMoveList(path: "Notes/Destination-100.textpack")
        XCTAssertEqual(filtered.entries.count, 1); XCTAssertFalse(filtered.truncated); XCTAssertEqual(filtered.entries.first?.itemId, "list-item-100")
        let after = await transport.manifestCalls; XCTAssertEqual(before, after)
    }
    func testMissingConsentNeverDispatchesSavedRequest() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("generic409"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList()
        let row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        do { try await engine.retrySavedFileMove(id: row.id, requestHash: try XCTUnwrap(row.requestHash), inspection: try XCTUnwrap(row.inspection), consent: false); XCTFail("Missing consent accepted") } catch { }
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testUnknownGenerationNeverExposesRetryOrKeep() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("generic409"); _ = try await engine.sync()
        await transport.changeGeneration(nil)
        let list = try await engine.savedFileMoveList()
        let row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        XCTAssertEqual(row.state, "review"); XCTAssertEqual(row.blockedReason, "lifecycle")
        XCTAssertFalse(row.retryAllowed); XCTAssertFalse(row.keepNamesAllowed)
        _ = try await engine.sync()
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testRebindRefusesPendingMapWithoutCopyOrReset() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await retainedPending(transport)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        let url = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        let before = try Data(contentsOf: url)
        let other = try LocalVaultSyncBinding(origin: URL(string: "https://other.test")!, workspaceId: "workspace")
        XCTAssertThrowsError(try LocalVaultSync.archiveAndRebind(root: root, to: other))
        XCTAssertEqual(try Data(contentsOf: url), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync-archives").path))
    }
    func testDuplicateRawStateIsRefusedBeforeWriting() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("generic409"); _ = try await engine.sync()
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        let url = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        let original = try Data(contentsOf: url)
        let duplicate = Data(original.dropLast()) + Data(",\"sharedRenames\":{}}".utf8)
        try duplicate.write(to: url)
        XCTAssertThrowsError(try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a"))
        XCTAssertEqual(try Data(contentsOf: url), duplicate)
    }
    func testMapAtFloorFourRefusesWithoutAutomaticUpgrade() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        try RetainedReplacementProfile.prepareLocalHandoff(root: root)
        let context = LocalVaultSharedRename.Context(rootHash: TextTextStableDigest.sha256Hex(Data(root.path.utf8)),
            scope: .init(origin: "https://texttext.test", workspaceId: "workspace", accountId: "account-a"))
        let record = LocalVaultSharedRename.Record(rootHash: context.rootHash,
            request: .init(operationId: UUID().uuidString.lowercased(), itemId: id, source: source, destination: destination, baseRevision: original.hash),
            scope: context.scope, baselineHash: original.hash, lifecycle: "owned-generation")
        var saved = try state()
        saved["sharedRenames"] = [id: try JSONSerialization.jsonObject(with: JSONEncoder().encode(record))]
        let url = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        let bytes = try JSONSerialization.data(withJSONObject: saved); try bytes.write(to: url)
        let profile = LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json")
        let before = try Data(contentsOf: profile)
        XCTAssertThrowsError(try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a"))
        XCTAssertEqual(try Data(contentsOf: url), bytes); XCTAssertEqual(try Data(contentsOf: profile), before)
    }
    private func retainedPending(_ transport: SavedRenameTransport) async throws -> (LocalVaultSync, LocalVaultDocumentStore.Document, String) {
        let result = try await prepared(transport)
        await transport.setMode("generic409"); _ = try await result.0.sync()
        await transport.setMode("moved")
        return result
    }
    private func waitForManifest(_ transport: SavedRenameTransport) async throws {
        for _ in 0..<200 {
            if await transport.manifestHeld { return }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Owned transport did not reach held final-manifest boundary")
        throw LocalVaultSyncFailure.changed
    }
    func testDuplicateIdentityDuringFinalManifestRefusesDispatch() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await retainedPending(transport)
        let before = await transport.manifestCalls; await transport.holdManifest(at: before + 2)
        let syncing = Task { try await engine.sync() }
        try await waitForManifest(transport)
        try FileManager.default.copyItem(at: root.appendingPathComponent(destination), to: root.appendingPathComponent("Notes/Duplicate.textpack"))
        await transport.releaseManifest(); let result = try await syncing.value
        XCTAssertFalse(result.errors.isEmpty)
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        XCTAssertNotNil((try state()["sharedRenames"] as? [String: Any])?[id])
        try FileManager.default.removeItem(at: root.appendingPathComponent("Notes/Duplicate.textpack"))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testCheckpointAdvanceDuringFinalManifestRefusesDispatch() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await retainedPending(transport)
        let before = await transport.manifestCalls; await transport.holdManifest(at: before + 2)
        let syncing = Task { try await engine.sync() }; try await waitForManifest(transport)
        _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 2, journal: journal(original, generation: 2), pending: true,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        await transport.releaseManifest(); let result = try await syncing.value
        XCTAssertFalse(result.errors.isEmpty)
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        let checkpoint = try await engine.readSharedCheckpoint(itemId: id); XCTAssertEqual(checkpoint?.journalGeneration, 2)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testPermissionRevokedDuringFinalManifestRefusesDispatch() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await retainedPending(transport)
        let before = await transport.manifestCalls; await transport.holdManifest(at: before + 2)
        let syncing = Task { try await engine.sync() }; try await waitForManifest(transport)
        await transport.setPermission(false); await transport.releaseManifest()
        let result = try await syncing.value; XCTAssertFalse(result.errors.isEmpty)
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    private func stoppedThenMoved(_ transport: SavedRenameTransport) async throws -> (LocalVaultSync, String, String, Data) {
        let (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let summary = try await engine.savedFileMoveList()
        let row = try await engine.savedFileMoveRead(id: XCTUnwrap(summary.entries.first?.id))
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        let record = try XCTUnwrap((state()["sharedRenames"] as? [String: Any])?[id])
        let bytes = try JSONSerialization.data(withJSONObject: record, options: .sortedKeys)
        let later = "Notes/Deliberate later move.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(destination), to: root.appendingPathComponent(later))
        _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 2, journal: journal(original, generation: 2), pending: true,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        await transport.setMode("moved")
        return (engine, token, row.id, bytes)
    }
    func testStoppedReplacementArchivesExactPriorRecordBeforeNewIntent() async throws {
        let transport = SavedRenameTransport(), (engine, token, oldId, oldBytes) = try await stoppedThenMoved(transport)
        _ = try await engine.sync()
        let requests = await transport.requests; XCTAssertEqual(requests.count, 2)
        XCTAssertNotEqual(requests.first?.operationId, requests.last?.operationId)
        XCTAssertEqual(requests.last?.destination, "Notes/Deliberate later move.textpack")
        let archived = try Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/saved-file-moves/\(oldId).json"))
        XCTAssertEqual(archived, oldBytes)
        let decoded = try JSONSerialization.jsonObject(with: archived) as? [String: Any]
        XCTAssertEqual(decoded?["phase"] as? String, "stopped")
        XCTAssertEqual((decoded?["request"] as? [String: Any])?["operationId"] as? String, oldId)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testArchiveCollisionRetainsStoppedRecordAndAllocatesNoDispatchedReplacement() async throws {
        let transport = SavedRenameTransport(), (engine, token, oldId, oldBytes) = try await stoppedThenMoved(transport)
        let folder = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/saved-file-moves")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = folder.appendingPathComponent(oldId + ".json"), foreign = Data("foreign archive".utf8)
        try foreign.write(to: target, options: .withoutOverwriting)
        let result = try await engine.sync(); XCTAssertFalse(result.errors.isEmpty)
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        let retained = try XCTUnwrap((state()["sharedRenames"] as? [String: Any])?[id])
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: retained, options: .sortedKeys), oldBytes)
        XCTAssertEqual(try Data(contentsOf: target), foreign)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }

    private func peerPack(body: String) throws -> Data {
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\n\(body)",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    func testConcurrentSamePathAdoptionDoesNotAcknowledgeUnincorporatedPeerText() async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        let before = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        let projection = try Data(contentsOf: root.appendingPathComponent(destination))
        let peer = try peerPack(body: "Peer text R not yet merged")
        XCTAssertNotEqual(TextTextStableDigest.sha256Hex(peer), before["revision"] as? String)
        await transport.peerPack(path: destination, data: peer)
        let report = try await engine.sync(); XCTAssertEqual(report.uploaded, 0)
        let after = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(after["path"] as? String, destination)
        XCTAssertEqual(after["revision"] as? String, before["revision"] as? String)
        XCTAssertEqual(after["localHash"] as? String, before["localHash"] as? String)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), projection)
        let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
        // A later collaboration checkpoint, not path adoption, owns accepting R.
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    private func addingAsset(_ pack: Data, bytes: Data, entryPath: String = "assets/data.bin") throws -> Data {
        let archive = try Archive(data: pack, accessMode: .update)
        let source = root.appendingPathComponent(".owned-peer-asset")
        try bytes.write(to: source); defer { try? FileManager.default.removeItem(at: source) }
        if let existing = archive[entryPath] { try archive.remove(existing) }
        try archive.addEntry(with: entryPath, fileURL: source, compressionMethod: .deflate)
        return try XCTUnwrap(archive.data)
    }
    func testAssetReceivePreservesTextAcknowledgementWhileMaterializingOnlyAssets() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        let asset = Data([9, 8, 7, 0, 255])
        let peer = try addingAsset(peerPack(body: "Peer text R remains outside this checkpoint"), bytes: asset)
        await transport.peerPack(path: destination, data: peer)
        let uploads = await transport.uploadCalls
        _ = try await engine.sync()
        let baseline = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        let local = try LocalVaultDocumentStore(root: root).read(path: destination)
        XCTAssertEqual(baseline["revision"] as? String, original.hash)
        XCTAssertEqual(baseline["localHash"] as? String, local.hash)
        XCTAssertTrue(local.contents.markdown.contains("Original")); XCTAssertFalse(local.contents.markdown.contains("Peer text R"))
        let checkpoint = try await engine.readSharedCheckpoint(itemId: id)
        XCTAssertEqual(checkpoint?.acknowledgedRevision, original.hash); XCTAssertEqual(checkpoint?.projectedHash, local.hash)
        let archive = try Archive(data: Data(contentsOf: root.appendingPathComponent(destination)), accessMode: .read)
        let matches = archive.filter { $0.path == "assets/data.bin" || $0.path.hasSuffix("/assets/data.bin") }
        XCTAssertEqual(matches.count, 1)
        let entry = try XCTUnwrap(matches.first); var actual = Data(); _ = try archive.extract(entry) { actual.append($0) }
        XCTAssertEqual(actual, asset)
        let afterUploads = await transport.uploadCalls; XCTAssertEqual(afterUploads, uploads)
        let binaryRevisions = try XCTUnwrap(state()["binaryRevisions"] as? [String: String])
        XCTAssertEqual(binaryRevisions[id], TextTextStableDigest.sha256Hex(peer))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testLostReceiptReplayAfterPeerPathMoveKeepsHistoricalPathThenFollowsPeer() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("lost-after-commit"); _ = try await engine.sync()
        let peerPath = "Notes/Peer later name.textpack"
        await transport.peerPath(peerPath); await transport.setMode("moved")
        _ = try await engine.sync()
        let requests = await transport.requests; XCTAssertEqual(requests.count, 2); XCTAssertEqual(requests[0], requests[1])
        let historical = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(historical["path"] as? String, destination)
        XCTAssertEqual(historical["revision"] as? String, original.hash)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(peerPath).path))
        _ = try await engine.sync()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: peerPath).hash, original.hash)
        let after = await transport.requests; XCTAssertEqual(after.count, 2)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testPendingBinaryCASRetriesSameIdentityBeforeAnnouncingRawMove() async throws {
        let transport = SavedRenameTransport(), original = try fixture()
        let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        _ = try await engine.sync(); _ = try await engine.sync()
        let initialUploads = await transport.uploadCalls
        let session = try await engine.beginSharedEditing(itemId: id, path: source, expectedHash: original.hash)
        _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: journal(original), pending: true,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        let asset = Data([0, 1, 2, 255, 17]), raw = try Archive(data: Data(contentsOf: root.appendingPathComponent(source)), accessMode: .update)
        let assetURL = root.appendingPathComponent(".owned-asset-input")
        try asset.write(to: assetURL); defer { try? FileManager.default.removeItem(at: assetURL) }
        try raw.addEntry(with: "assets/data.bin", fileURL: assetURL, compressionMethod: .deflate)
        var assetPack = try XCTUnwrap(raw.data)
        try assetPack.write(to: root.appendingPathComponent(source), options: .atomic)
        let adoptedAsset = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id,
            expectedHash: TextTextStableDigest.sha256Hex(assetPack), epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: journal(original, generation: 2), pending: true,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        assetPack = try Data(contentsOf: root.appendingPathComponent(adoptedAsset.document.path))
        await transport.setBinaryOffline(true); _ = try await engine.sync()
        let staged = try XCTUnwrap((state()["binaryOutbox"] as? [String: Any])?[id] as? [String: Any])
        try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination))
        _ = try await engine.sync()
        let held = await transport.requests; XCTAssertTrue(held.isEmpty)
        XCTAssertEqual((try state()["binaryOutbox"] as? [String: [String: Any]])?[id]?["operationId"] as? String, staged["operationId"] as? String)
        await transport.setBinaryOffline(false)
        _ = try await engine.sync(); _ = try await engine.sync()
        let calls = await transport.binaryCalls
        XCTAssertGreaterThan(calls.count, 1)
        XCTAssertTrue(calls.allSatisfy { $0 == calls.first })
        XCTAssertEqual(calls.first?.operationId, staged["operationId"] as? String)
        let moves = await transport.requests; XCTAssertEqual(moves.count, 1); XCTAssertEqual(moves.first?.destination, destination)
        XCTAssertNil((try state()["binaryOutbox"] as? [String: Any])?[id])
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), assetPack)
        let finalUploads = await transport.uploadCalls; XCTAssertEqual(finalUploads, initialUploads)
        let serverAsset = try await transport.binaryRead(itemId: id, entryPath: "assets/data.bin"); XCTAssertEqual(serverAsset, asset)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: id)
    }
    private func assetSession(_ assets: [String: Data], checkpoint: Bool = true) async throws -> (LocalVaultSync, LocalVaultDocumentStore.Document, String, SavedRenameTransport) {
        _ = try fixture()
        var pack = try Data(contentsOf: root.appendingPathComponent(source))
        for entry in assets.keys.sorted() { pack = try addingAsset(pack, bytes: assets[entry]!, entryPath: entry) }
        try pack.write(to: root.appendingPathComponent(source), options: .atomic)
        let original = try LocalVaultDocumentStore(root: root).read(path: source), transport = SavedRenameTransport()
        let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        _ = try await engine.sync(); _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: id, path: source, expectedHash: original.hash)
        if checkpoint {
            _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id, expectedHash: original.hash,
                epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: journal(original), pending: true,
                markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        }
        return (engine, original, session.sessionToken, transport)
    }
    private func acceptAsset(_ engine: LocalVaultSync, original: LocalVaultDocumentStore.Document, token: String, path: String, entry: String, bytes: Data) async throws {
        let changed = try addingAsset(Data(contentsOf: root.appendingPathComponent(path)), bytes: bytes, entryPath: entry)
        try changed.write(to: root.appendingPathComponent(path), options: .atomic)
        _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: TextTextStableDigest.sha256Hex(changed),
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 2, journal: journal(original, generation: 2), pending: true,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
    }
    private func localAsset(_ path: String, entry: String) throws -> Data {
        let archive = try Archive(data: Data(contentsOf: root.appendingPathComponent(path)), accessMode: .read)
        let matches = archive.filter { $0.path == entry || $0.path.hasSuffix("/" + entry) }
        XCTAssertEqual(matches.count, 1)
        var bytes = Data(); _ = try archive.extract(XCTUnwrap(matches.first)) { bytes.append($0) }; return bytes
    }
    func testOneAssetUploadDoesNotAcknowledgePeerTextOrOtherAssetCursor() async throws {
        let a0 = Data("a0".utf8), a1 = Data("a1".utf8), b0 = Data("b0".utf8), b1 = Data("b1".utf8)
        let (engine, original, token, transport) = try await assetSession(["assets/a.bin": a0, "assets/b.bin": b0])
        try await acceptAsset(engine, original: original, token: token, path: source, entry: "assets/a.bin", bytes: a1)
        let peer = try addingAsset(addingAsset(peerPack(body: "Peer text R"), bytes: a0, entryPath: "assets/a.bin"), bytes: b1, entryPath: "assets/b.bin")
        await transport.peerPack(path: source, data: peer)
        let uploads = await transport.uploadCalls
        _ = try await engine.sync(); _ = try await engine.sync()
        let baseline = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(baseline["revision"] as? String, original.hash)
        XCTAssertEqual(try localAsset(source, entry: "assets/a.bin"), a1)
        XCTAssertEqual(try localAsset(source, entry: "assets/b.bin"), b1)
        let current = try LocalVaultDocumentStore(root: root).read(path: source)
        XCTAssertTrue(current.contents.markdown.contains("Original")); XCTAssertFalse(current.contents.markdown.contains("Peer text R"))
        let cp = try await engine.readSharedCheckpoint(itemId: id); XCTAssertEqual(cp?.acknowledgedRevision, original.hash)
        let after = await transport.uploadCalls; XCTAssertEqual(after, uploads)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testAssetConflictWinnerDoesNotAcknowledgeItsUnincorporatedText() async throws {
        let a0 = Data("a0".utf8), a1 = Data("a1".utf8), a2 = Data("a2".utf8)
        let (engine, original, token, transport) = try await assetSession(["assets/a.bin": a0])
        try await acceptAsset(engine, original: original, token: token, path: source, entry: "assets/a.bin", bytes: a1)
        let before = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        await transport.peerPack(path: source, data: try addingAsset(peerPack(body: "Peer text R"), bytes: a2, entryPath: "assets/a.bin"))
        _ = try await engine.sync()
        let after = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(after["revision"] as? String, before["revision"] as? String)
        XCTAssertEqual(after["localHash"] as? String, before["localHash"] as? String)
        XCTAssertEqual(try localAsset(source, entry: "assets/a.bin"), a2)
        let current = try LocalVaultDocumentStore(root: root).read(path: source)
        XCTAssertTrue(current.contents.markdown.contains("Original")); XCTAssertFalse(current.contents.markdown.contains("Peer text R"))
        let cp = try await engine.readSharedCheckpoint(itemId: id); XCTAssertEqual(cp?.acknowledgedRevision, original.hash)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testStoppedNamesStillAdmitIndependentAssetCASAtServerName() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        let asset = Data([4, 5, 6, 0, 255])
        try await acceptAsset(engine, original: original, token: token, path: destination, entry: "assets/data.bin", bytes: asset)
        let beforeBinary = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        let uploads = await transport.uploadCalls
        await transport.setBinaryOffline(true)
        _ = try await engine.sync()
        let savedCalls = await transport.binaryCalls
        XCTAssertEqual(savedCalls.count, 1)
        await transport.setWritable(false)
        _ = try await engine.sync()
        let blockedCalls = await transport.binaryCalls; XCTAssertEqual(blockedCalls, savedCalls)
        await transport.setWritable(true); await transport.setBinaryOffline(false)
        let replayReport = try await engine.sync(); _ = try await engine.sync()
        XCTAssertTrue(replayReport.errors.isEmpty, "Replay blocked: \(replayReport.errors)")
        let baseline = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(baseline["path"] as? String, destination)
        let completeHash = try LocalVaultDocumentStore(root: root).read(path: destination).hash
        let authoritative = try await transport.manifest()
        if completeHash == authoritative.first?.revision {
            XCTAssertEqual(baseline["revision"] as? String, completeHash)
            XCTAssertEqual(baseline["localHash"] as? String, completeHash)
        } else {
            // ZIP timestamps can differ despite identical logical entries.
            // Only actual complete-byte equality authorizes a full ACK.
            XCTAssertEqual(baseline["revision"] as? String, beforeBinary["revision"] as? String)
            XCTAssertEqual(baseline["localHash"] as? String, beforeBinary["localHash"] as? String)
        }
        let calls = await transport.binaryCalls; XCTAssertEqual(calls.count, 2); XCTAssertEqual(calls.first, calls.last)
        let serverAsset = try? await transport.binaryRead(itemId: id, entryPath: "assets/data.bin"); XCTAssertEqual(serverAsset, asset)
        let remote = try await transport.manifest(); XCTAssertEqual(remote.first?.relativePath, source)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        let moves = await transport.requests; XCTAssertEqual(moves.count, 1)
        let afterUploads = await transport.uploadCalls; XCTAssertEqual(afterUploads, uploads)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    private func stoppedReadResponseMutation(_ mutation: String) async throws {
        let transport = SavedRenameTransport(), (engine, _, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        let before = try Data(contentsOf: root.appendingPathComponent(destination))
        let server = try await transport.download(itemId: id)
        await transport.peerPack(path: source, data: try addingAsset(server.data, bytes: Data("peer asset".utf8)))
        await transport.mutateBinaryResponse(mutation)
        _ = try await engine.sync()
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), before)
        let calls = await transport.binaryCalls; XCTAssertTrue(calls.isEmpty)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testStoppedReadReplyPathChangeRefusesLocalMaterialization() async throws { try await stoppedReadResponseMutation("path") }
    func testStoppedReadReplyPermissionChangeRefusesLocalMaterialization() async throws { try await stoppedReadResponseMutation("permission") }
    func testStoppedAssetConflictWinnerUsesServerPathAndPreservesPeerTextBoundary() async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        try await acceptAsset(engine, original: original, token: token, path: destination, entry: "assets/data.bin", bytes: Data("local asset".utf8))
        let winner = Data("peer winner".utf8)
        await transport.peerPack(path: source, data: try addingAsset(peerPack(body: "Peer text R"), bytes: winner))
        _ = try await engine.sync()
        XCTAssertEqual(try localAsset(destination, entry: "assets/data.bin"), winner)
        let current = try LocalVaultDocumentStore(root: root).read(path: destination)
        XCTAssertTrue(current.contents.markdown.contains("Original")); XCTAssertFalse(current.contents.markdown.contains("Peer text R"))
        let baseline = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(baseline["revision"] as? String, original.hash)
        let remote = try await transport.manifest(); XCTAssertEqual(remote.first?.relativePath, source)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    private func stoppedPatchResponseMutation(_ mutation: String) async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        let asset = Data("accepted local asset".utf8)
        try await acceptAsset(engine, original: original, token: token, path: destination, entry: "assets/data.bin", bytes: asset)
        await transport.mutateBinaryResponse(mutation)
        _ = try await engine.sync()
        let calls = await transport.binaryCalls; XCTAssertEqual(calls.count, 1)
        XCTAssertNotNil((try state()["binaryOutbox"] as? [String: Any])?[id])
        XCTAssertEqual(try localAsset(destination, entry: "assets/data.bin"), asset)
        _ = try await engine.sync()
        let after = await transport.binaryCalls; XCTAssertEqual(after, calls)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testStoppedPatchReplyPathChangeRetainsExactPending() async throws { try await stoppedPatchResponseMutation("path") }
    func testStoppedPatchReplyGenerationChangeRetainsExactPending() async throws { try await stoppedPatchResponseMutation("generation") }
    func testStoppedPatchReplyPermissionChangeRetainsExactPending() async throws { try await stoppedPatchResponseMutation("permission") }
    private func stoppedPendingMutation(_ mutation: String) async throws {
        let transport = SavedRenameTransport(), (engine, original, token) = try await prepared(transport)
        await transport.setMode("conflict"); _ = try await engine.sync()
        let list = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        try await acceptAsset(engine, original: original, token: token, path: destination, entry: "assets/data.bin", bytes: Data("retained asset".utf8))
        await transport.setBinaryOffline(true); _ = try await engine.sync()
        let calls = await transport.binaryCalls; XCTAssertEqual(calls.count, 1)
        let pending = try JSONSerialization.data(withJSONObject: XCTUnwrap(state()["binaryOutbox"]), options: [.sortedKeys])
        if mutation == "path" { await transport.peerPath("Notes/Peer.textpack") }
        else { await transport.changeGeneration("different-generation") }
        await transport.setBinaryOffline(false); _ = try await engine.sync()
        let after = await transport.binaryCalls; XCTAssertEqual(after, calls)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: XCTUnwrap(state()["binaryOutbox"]), options: [.sortedKeys]), pending)
        XCTAssertEqual(try localAsset(destination, entry: "assets/data.bin"), Data("retained asset".utf8))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testStoppedPendingAssetPathChangeRefusesReplay() async throws { try await stoppedPendingMutation("path") }
    func testStoppedPendingAssetGenerationChangeRefusesReplay() async throws { try await stoppedPendingMutation("generation") }
    func testAssetReceiveBeforeFirstCheckpointDoesNotMarkExternalTextClean() async throws {
        let (engine, original, token, transport) = try await assetSession([:], checkpoint: false)
        try peerPack(body: "External local L").write(to: root.appendingPathComponent(source), options: .atomic)
        await transport.peerPack(path: source, data: try addingAsset(peerPack(body: "Peer remote R"), bytes: Data("remote asset".utf8)))
        _ = try await engine.sync()
        let baseline = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(baseline["localHash"] as? String, original.hash)
        XCTAssertEqual(baseline["revision"] as? String, original.hash)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        _ = try await engine.sync()
        let retained = try XCTUnwrap((state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(retained["localHash"] as? String, original.hash)
        XCTAssertEqual(retained["revision"] as? String, original.hash)
        XCTAssertTrue(try LocalVaultDocumentStore(root: root).read(path: source).contents.markdown.contains("External local L"))
    }

    func testWrongTransportOriginNeverDispatches() async throws { try await wrongBinding(.init(origin: "https://other.test", workspaceId: "workspace", accountId: "account-a")) }
    func testWrongTransportWorkspaceNeverDispatches() async throws { try await wrongBinding(.init(origin: "https://texttext.test", workspaceId: "other", accountId: "account-a")) }
    func testWrongTransportPrincipalNeverDispatches() async throws { try await wrongBinding(.init(origin: "https://texttext.test", workspaceId: "workspace", accountId: "other")) }
    private func wrongBinding(_ scope: LocalVaultProtectedRenameScope) async throws {
            let transport = SavedRenameTransport(scope: scope)
            let (engine, _, token) = try await prepared(transport)
            let result = try await engine.sync(); XCTAssertFalse(result.errors.isEmpty)
            let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
            XCTAssertNil(try state()["sharedRenames"])
            try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
}

private actor SavedRenameTransport: LocalVaultSyncTransport {
    nonisolated let protectedRenameBinding: LocalVaultProtectedRenameScope?
    var items: [String: LocalVaultRemoteItem] = [:], bytes: [String: Data] = [:]
    var requests: [LocalVaultProtectedRenameRequest] = []
    var uploadCalls = 0
    struct BinaryCall: Equatable { let operationId: String, entryPath: String, expectedHash: String?, lifecycle: String?, payloadHash: String? }
    var binaryCalls: [BinaryCall] = [], binaryReceipts: [String: String] = [:], binaryOffline = false
    var manifestCalls = 0, offline = false, permitted = true, writable = true
    var binaryMutation: String?
    var holdAt: Int?, manifestHeld = false
    var continuation: CheckedContinuation<Void, Never>?
    var mode = "moved", receipts: [String: LocalVaultProtectedRenameReceipt] = [:]
    init(scope: LocalVaultProtectedRenameScope = .init(origin: "https://texttext.test", workspaceId: "workspace", accountId: "account-a")) { protectedRenameBinding = scope }
    func setMode(_ mode: String) { self.mode = mode }
    func setOffline(_ value: Bool) { offline = value }
    func setBinaryOffline(_ value: Bool) { binaryOffline = value }
    func setPermission(_ value: Bool) { permitted = value }
    func setWritable(_ value: Bool) { writable = value }
    func mutateBinaryResponse(_ value: String) { binaryMutation = value }
    private func finishBinaryResponse() {
        defer { binaryMutation = nil }
        if binaryMutation == "path" { peerPath("Notes/Peer.textpack") }
        if binaryMutation == "generation" { changeGeneration("different-generation") }
        if binaryMutation == "permission" { writable = false }
    }
    func holdManifest(at call: Int) { holdAt = call }
    func releaseManifest() { holdAt = nil; manifestHeld = false; continuation?.resume(); continuation = nil }
    func peerPack(path: String, data: Data) { for (id, item) in items { bytes[id] = data; items[id] = .init(itemId: id, relativePath: path, revision: TextTextStableDigest.sha256Hex(data), lifecycle: item.lifecycle) } }
    func peerPath(_ path: String) { for (id, item) in items { items[id] = .init(itemId: id, relativePath: path, revision: item.revision, lifecycle: item.lifecycle) } }
    func advanceRevision(_ revision: String) { for (id, item) in items { items[id] = .init(itemId: id, relativePath: item.relativePath, revision: revision, lifecycle: item.lifecycle) } }
    func changeGeneration(_ value: String?) { for (id, item) in items { items[id] = .init(itemId: id, relativePath: item.relativePath, revision: item.revision, lifecycle: value) } }
    func manifest() async throws -> [LocalVaultRemoteItem] {
        manifestCalls += 1
        if manifestCalls == holdAt { manifestHeld = true; await withCheckedContinuation { continuation = $0 } }
        if offline { throw LocalVaultSyncFailure.httpStatus(503) }; return Array(items.values)
    }
    func canOrganize() async -> Bool { permitted }
    func canWrite(itemId: String, path: String, existing: Bool) async -> Bool {
        guard existing, let item = items[itemId] else { return true }
        return writable && item.relativePath == path
    }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String {
        uploadCalls += 1
        if let current = items[itemId], current.revision != baseRevision { throw LocalVaultSyncFailure.conflict }
        let revision = TextTextStableDigest.sha256Hex(data); bytes[itemId] = data
        items[itemId] = .init(itemId: itemId, relativePath: path, revision: revision, lifecycle: "owned-generation")
        return revision
    }
    func download(itemId: String) async throws -> LocalVaultRemotePack { .init(data: bytes[itemId]!, relativePath: items[itemId]!.relativePath, revision: items[itemId]!.revision) }
    func binaryManifest(itemId: String) async throws -> LocalVaultBinaryManifest {
        let archive = try Archive(data: bytes[itemId]!, accessMode: .read)
        var entries: [LocalVaultBinaryManifest.Entry] = []
        for entry in archive where entry.path.hasPrefix("assets/") && !entry.path.hasSuffix("/") {
            var data = Data(); _ = try archive.extract(entry) { data.append($0) }
            entries.append(.init(path: entry.path, sha256: TextTextStableDigest.sha256Hex(data), size: data.count))
        }
        return .init(revision: items[itemId]!.revision, entries: entries)
    }
    func binaryRead(itemId: String, entryPath: String) async throws -> Data {
        let archive = try Archive(data: bytes[itemId]!, accessMode: .read)
        guard let entry = archive[entryPath] else { throw LocalVaultSyncFailure.invalidResponse }
        var data = Data(); _ = try archive.extract(entry) { data.append($0) }; finishBinaryResponse(); return data
    }
    func binaryPatch(itemId: String, operationId: String, entryPath: String, expectedHash: String?, expectedLifecycle: String?, bytes payload: Data?) async throws -> String {
        binaryCalls.append(.init(operationId: operationId, entryPath: entryPath, expectedHash: expectedHash, lifecycle: expectedLifecycle, payloadHash: payload.map { TextTextStableDigest.sha256Hex($0) }))
        if binaryOffline { throw LocalVaultSyncFailure.httpStatus(503) }
        if let revision = binaryReceipts[operationId] { return revision }
        guard let item = items[itemId], item.lifecycle == expectedLifecycle else { throw LocalVaultSyncFailure.conflict }
        let archive = try Archive(data: bytes[itemId]!, accessMode: .update)
        var existing: Data?
        if let entry = archive[entryPath] { var data = Data(); _ = try archive.extract(entry) { data.append($0) }; existing = data; try archive.remove(entry) }
        guard existing.map({ TextTextStableDigest.sha256Hex($0) }) == expectedHash else { throw LocalVaultSyncFailure.conflict }
        if let payload {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try payload.write(to: url, options: .withoutOverwriting); defer { try? FileManager.default.removeItem(at: url) }
            try archive.addEntry(with: entryPath, fileURL: url, compressionMethod: .deflate)
        }
        let pack = try XCTUnwrap(archive.data), revision = TextTextStableDigest.sha256Hex(pack)
        bytes[itemId] = pack; items[itemId] = .init(itemId: item.itemId, relativePath: item.relativePath, revision: revision, lifecycle: item.lifecycle)
        binaryReceipts[operationId] = revision; finishBinaryResponse(); return revision
    }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func protectedRename(_ request: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt {
        requests.append(request)
        if let receipt = receipts[request.operationId] { return receipt }
        let item = items[request.itemId]!
        if mode == "generic409" { throw LocalVaultSyncFailure.conflict }
        let receipt = LocalVaultProtectedRenameReceipt(request: request, scope: protectedRenameBinding!, status: mode == "conflict" ? "conflict" : "moved",
            relativePath: mode == "conflict" ? item.relativePath : request.destination, revision: mode == "conflict" ? item.revision : request.baseRevision, deleted: false)
        receipts[request.operationId] = receipt
        if mode != "conflict" { items[request.itemId] = .init(itemId: item.itemId, relativePath: request.destination, revision: item.revision, lifecycle: item.lifecycle) }
        if mode == "lost-after-commit" { throw LocalVaultSyncFailure.httpStatus(503) }
        return receipt
    }
}
