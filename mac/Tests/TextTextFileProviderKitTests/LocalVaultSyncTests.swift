import XCTest
import ZIPFoundation
@testable import TextTextFileProviderKit

final class LocalVaultSyncTests: XCTestCase {
    private var root: URL!
    private let itemId = "e1111111-1111-4111-8111-111111111111"
    private let path = "Notes/Note.textpack"
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testPassiveRestoreRetiresOldDeletionButHonorsNewDeletion() async throws {
        let transport = FakeVaultTransport()
        await transport.set(itemId: itemId, path: path, data: try pack("before"))
        let sync = try engine(transport)
        _ = try await sync.sync()
        let store = LocalVaultDocumentStore(root: root)
        try store.delete(path: path, expectedHash: store.read(path: path).hash)
        await transport.restore(itemId: itemId, path: path, data: try pack("restored"), lifecycle: "restore-one")
        let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        var state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
        let baseline = try XCTUnwrap((state["baselines"] as? [String: [String: Any]])?[itemId])
        state["outbox"] = [itemId: ["itemId": itemId, "path": path, "hash": baseline["localHash"]!, "baseRevision": baseline["revision"]!, "operationId": UUID().uuidString, "action": "delete"]]
        try JSONSerialization.data(withJSONObject: state).write(to: stateURL, options: .atomic)
        let resumed = try engine(transport)
        let restored = try await resumed.sync()
        XCTAssertTrue(restored.errors.isEmpty)
        XCTAssertTrue(try store.read(path: path).contents.markdown.contains("restored"))
        let firstManifest = await transport.manifest()
        XCTAssertFalse(try XCTUnwrap(firstManifest.first).isDeleted)
        try await resumed.reconcileRestored(itemId: itemId, path: path, lifecycle: "restore-one")
        do { try await resumed.reconcileRestored(itemId: itemId, path: path, lifecycle: "wrong"); XCTFail("Wrong restore generation accepted") } catch {}
        try store.delete(path: path, expectedHash: store.read(path: path).hash)
        var migrated = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
        migrated.removeValue(forKey: "lifecycles")
        try JSONSerialization.data(withJSONObject: migrated).write(to: stateURL, options: .atomic)
        _ = try await engine(transport).sync()
        let secondManifest = await transport.manifest()
        XCTAssertTrue(try XCTUnwrap(secondManifest.first).isDeleted)
    }

    func testDownloadRaceBindsInstalledLifecycleAndPreservesNewDelete() async throws {
        let transport = FakeVaultTransport()
        await transport.restore(itemId: itemId, path: path, data: try pack("first"), lifecycle: "first")
        let archive = try Archive(data: pack("second"), accessMode: .update)
        let marker = Data(#"{"version":1,"generation":"second"}"#.utf8)
        try archive.addEntry(with: "texttext-lifecycle.json", type: .file, uncompressedSize: Int64(marker.count)) { position, size in marker.subdata(in: Int(position)..<Int(position) + size) }
        await transport.raceDownload(data: try XCTUnwrap(archive.data), lifecycle: "second")
        let sync = try engine(transport)
        _ = try await sync.sync()
        let store = LocalVaultDocumentStore(root: root)
        XCTAssertTrue(try store.read(path: path).contents.markdown.contains("second"))
        try store.delete(path: path, expectedHash: store.read(path: path).hash)
        _ = try await sync.sync()
        let manifest = await transport.manifest()
        XCTAssertTrue(try XCTUnwrap(manifest.first).isDeleted)
    }

    func testRemoteEmptyFoldersAreAdditiveAndRejectUnsafePaths() async throws {
        let transport = FakeVaultTransport()
        await transport.setFolders(["Feeds", "Research/Empty"])
        let sync = try engine(transport)
        _ = try await sync.sync()
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Research/Empty").path))
        await transport.setFolders([])
        _ = try await sync.sync()
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Feeds").path))
        let store = LocalVaultDocumentStore(root: root)
        for path in ["../escape", ".texttext/cache", "Notes//bad", "Fake.textpack/child"] { XCTAssertThrowsError(try store.ensureFolders([path])) }
        try Data("keep".utf8).write(to: root.appendingPathComponent("Occupied"))
        XCTAssertThrowsError(try store.ensureFolders(["Occupied/child"]))
        await transport.setFolders(["Occupied/child", "Another empty"])
        await transport.set(itemId: itemId, path: path, data: try pack("remote survives folder collision"))
        let collisionReport = try await sync.sync()
        XCTAssertFalse(collisionReport.errors.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Another empty").path))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("Linked"), withDestinationURL: root.appendingPathComponent("Feeds"))
        XCTAssertThrowsError(try store.ensureFolders(["Linked/child"]))
        try Data().write(to: root.appendingPathComponent(".Pending.icloud"))
        XCTAssertThrowsError(try store.ensureFolders(["Pending"]))
    }

    private func pack(_ body: String) throws -> Data {
        let temporary = root.appendingPathComponent(".fixture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: \"Note\"\n---\n\n\(body)",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON,
            assets: [], sourceURL: nil, in: temporary)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: temporary))
    }
    private func putLocal(_ data: Data) throws {
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
    private func engine(_ transport: FakeVaultTransport) throws -> LocalVaultSync {
        try LocalVaultSync(root: root,
            binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace"),
            transport: transport)
    }

    func testRebindArchivesPreviousJournalAndKeepsLocalPack() throws {
        let bytes = try pack("Keep this note")
        try putLocal(bytes)
        _ = try engine(FakeVaultTransport())
        let device = LocalVaultDeviceState.directory(root: root)
        let oldState = try Data(contentsOf: device.appendingPathComponent("sync/state.json"))
        let newBinding = try LocalVaultSyncBinding(
            origin: URL(string: "https://texttext.app")!, workspaceId: "newWorkspace")

        try LocalVaultSync.archiveAndRebind(root: root, to: newBinding)

        XCTAssertEqual(try LocalVaultSync.binding(root: root), newBinding)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), bytes)
        let archives = try FileManager.default.contentsOfDirectory(
            at: device.appendingPathComponent("sync-archives"), includingPropertiesForKeys: nil)
        XCTAssertEqual(archives.count, 1)
        XCTAssertEqual(try Data(contentsOf: archives[0].appendingPathComponent("state.json")), oldState)
    }

    func testUploadThenIdlePassDoesNotUploadOrDownloadAgain() async throws {
        let bytes = try pack("First")
        try putLocal(bytes)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        let first = try await sync.sync()
        XCTAssertEqual(first.uploaded, 1)
        XCTAssertTrue(first.errors.isEmpty)
        let second = try await sync.sync()
        XCTAssertEqual(second.uploaded, 0)
        XCTAssertEqual(second.downloaded, 0)
        let counts = await transport.counts()
        XCTAssertEqual(counts.upload, 1)
        XCTAssertEqual(counts.download, 0)
    }

    func testLostReplyReusesDurableOperationAfterRestart() async throws {
        try putLocal(pack("First"))
        let transport = FakeVaultTransport()
        await transport.loseNextReply()
        let first = try await engine(transport).sync()
        XCTAssertEqual(first.errors.count, 1)
        let second = try await engine(transport).sync()
        XCTAssertTrue(second.errors.isEmpty)
        let operations = await transport.operations()
        XCTAssertEqual(operations.count, 2)
        XCTAssertEqual(operations[0], operations[1])
        let state = try String(contentsOf: root.appendingPathComponent(".texttext/sync/state.json"), encoding: .utf8)
        XCTAssertFalse(state.contains("token"))
        XCTAssertFalse(state.contains("Bearer"))
    }

    func testMissingRemoteWithoutTombstoneRecreatesCurrentLocalPack() async throws {
        let original = try pack("Original")
        try putLocal(original)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        let initial = try await sync.sync()
        XCTAssertEqual(initial.uploaded, 1)
        await transport.forgetWithoutTombstone(itemId: itemId)
        let restored = try await sync.sync()
        XCTAssertTrue(restored.errors.isEmpty)
        XCTAssertEqual(restored.uploaded, 1)
        let remote = try await transport.download(itemId: itemId)
        XCTAssertEqual(remote.data, original)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), original)
    }

    func testNativeEditorRevisionIsAttributedAfterOfflineSaves() async throws {
        let original = try pack("First")
        try putLocal(original)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()

        let journal = LocalVaultEditOriginJournal(root: root)
        _ = try journal.recordingNativeSave {
            try putLocal(pack("Human one"))
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        _ = try journal.recordingNativeSave {
            try putLocal(pack("Human two"))
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        let resumed = try engine(transport)
        let report = try await resumed.sync()
        let origins = await transport.uploadOrigins()
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertEqual(origins, [false, true])
    }

    func testAgentRestoreOfConsumedNativeRevisionIsNotAttributedToHuman() async throws {
        try putLocal(pack("Original"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()

        let journal = LocalVaultEditOriginJournal(root: root)
        let nativeBytes = try pack("Native edit")
        let native = try journal.recordingNativeSave {
            try putLocal(nativeBytes)
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        let uploaded = try await sync.sync()
        XCTAssertEqual(uploaded.uploaded, 1)
        XCTAssertFalse(try journal.isNativeSave(path: path, hash: native.hash))

        await transport.set(itemId: itemId, path: path, data: try pack("Remote change"))
        let downloaded = try await sync.sync()
        XCTAssertEqual(downloaded.downloaded, 1)
        try putLocal(nativeBytes) // An agent restores the old bytes after the baseline advanced.
        let restored = try await sync.sync()
        let origins = await transport.uploadOrigins()
        XCTAssertEqual(restored.uploaded, 1)
        XCTAssertEqual(origins, [false, true, false])
    }

    func testAgentUploadConsumesOlderNativeMarkerBeforeLaterRestore() async throws {
        try putLocal(pack("Original"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()

        let journal = LocalVaultEditOriginJournal(root: root)
        let nativeBytes = try pack("Unsynced native edit")
        let native = try journal.recordingNativeSave {
            try putLocal(nativeBytes)
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        try putLocal(pack("Agent edit"))
        let agentUpload = try await sync.sync()
        XCTAssertEqual(agentUpload.uploaded, 1)
        XCTAssertFalse(try journal.isNativeSave(path: path, hash: native.hash))

        await transport.set(itemId: itemId, path: path, data: try pack("Remote change"))
        let downloaded = try await sync.sync()
        XCTAssertEqual(downloaded.downloaded, 1)
        try putLocal(nativeBytes)
        let restored = try await sync.sync()
        let origins = await transport.uploadOrigins()
        XCTAssertEqual(restored.uploaded, 1)
        XCTAssertEqual(origins, [false, false, false])
    }

    func testAgentRevisionAfterNativeSaveUsesExternalAttribution() async throws {
        let original = try pack("First")
        try putLocal(original)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()

        let journal = LocalVaultEditOriginJournal(root: root)
        _ = try journal.recordingNativeSave {
            try putLocal(pack("Human"))
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        let agent = try pack("Human and agent")
        try putLocal(agent)
        let report = try await sync.sync()
        let origins = await transport.uploadOrigins()
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertEqual(origins, [false, false])
    }

    func testNativeSaveAfterAgentEditUsesNativeAttribution() async throws {
        try putLocal(pack("First"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(pack("Agent"))
        _ = try LocalVaultEditOriginJournal(root: root).recordingNativeSave {
            try putLocal(pack("Agent, then human"))
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        let report = try await sync.sync()
        let origins = await transport.uploadOrigins()
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertEqual(origins, [false, true])
    }

    func testNativeOriginSurvivesLostReplyAndRestart() async throws {
        let journal = LocalVaultEditOriginJournal(root: root)
        let native = try journal.recordingNativeSave {
            try putLocal(pack("Human offline create"))
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        let transport = FakeVaultTransport()
        await transport.loseNextReply()
        let first = try await engine(transport).sync()
        XCTAssertFalse(try journal.isNativeSave(path: path, hash: native.hash))
        let second = try await engine(transport).sync()
        let origins = await transport.uploadOrigins()
        XCTAssertEqual(first.errors.count, 1)
        XCTAssertTrue(second.errors.isEmpty)
        XCTAssertEqual(origins, [true, true])
    }

    func testFailedOutboxStageKeepsNativeOriginMarker() async throws {
        let journal = LocalVaultEditOriginJournal(root: root)
        let native = try journal.recordingNativeSave {
            try putLocal(pack("Human offline create"))
            return try LocalVaultDocumentStore(root: root).read(path: path)
        }
        let sync = try engine(FakeVaultTransport())
        let stateURL = root.appendingPathComponent(".texttext/sync/state.json")
        try FileManager.default.removeItem(at: stateURL)
        try FileManager.default.createDirectory(at: stateURL, withIntermediateDirectories: false)
        do {
            _ = try await sync.sync()
            XCTFail("Staging should fail when its durable state cannot be written")
        } catch {
            XCTAssertTrue(try journal.isNativeSave(path: path, hash: native.hash))
        }
    }

    func testRemoteOnlyChangeDownloadsAndPreservesPriorPack() async throws {
        let first = try pack("Remote first")
        let second = try pack("Remote second")
        let transport = FakeVaultTransport()
        await transport.set(itemId: itemId, path: path, data: first)
        let sync = try engine(transport)
        let initial = try await sync.sync()
        XCTAssertEqual(initial.downloaded, 1)
        await transport.set(itemId: itemId, path: path, data: second)
        let changed = try await sync.sync()
        XCTAssertEqual(changed.downloaded, 1)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), second)
        let history = root.appendingPathComponent(".texttext/history/\(TextTextStableDigest.sha256Hex(first)).textpack")
        XCTAssertEqual(try Data(contentsOf: history), first)
    }

    func testConflictKeepsBothPacksAndDoesNotRepeatUpload() async throws {
        let initial = try pack("Initial")
        let local = try pack("Local branch")
        let remote = try pack("Remote branch")
        try putLocal(initial)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(local)
        await transport.set(itemId: itemId, path: path, data: remote)
        let conflict = try await sync.sync()
        XCTAssertEqual(conflict.conflicts.count, 2)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), local)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(conflict.conflicts[0])), local)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(conflict.conflicts[1])), remote)
        let prior = await transport.counts()
        _ = try await sync.sync()
        let after = await transport.counts()
        XCTAssertEqual(prior.upload, after.upload)
    }

    func testServerMergeReplacesOnlyTheUploadedLocalRevision() async throws {
        try putLocal(pack("Original"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(pack("Local edit"))
        let merged = try pack("Local edit plus web edit")
        await transport.mergeNextUpload(with: merged)
        let report = try await sync.sync()
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertTrue(report.errors.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), merged)
    }

    func testLocalRenameAndDeletionReachServer() async throws {
        try putLocal(pack("Initial"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        let renamed = "Notes/Renamed.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let renameReport = try await sync.sync()
        XCTAssertTrue(renameReport.errors.isEmpty)
        XCTAssertTrue(renameReport.conflicts.isEmpty)
        let moved = try await transport.download(itemId: itemId)
        XCTAssertEqual(moved.relativePath, renamed)
        try FileManager.default.removeItem(at: root.appendingPathComponent(renamed))
        let deleteReport = try await sync.sync()
        XCTAssertTrue(deleteReport.errors.isEmpty)
        let manifest = await transport.manifest()
        XCTAssertTrue(manifest.first?.isDeleted == true)
    }

    func testCloudProviderAbsenceDoesNotDeleteRemoteItem() async throws {
        let originalRoot = root!
        root = originalRoot.appendingPathComponent("CloudStorage/Workspace")
        defer { root = originalRoot }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        XCTAssertTrue(LocalVaultDeviceState.isCloudManaged(root: root))
        try putLocal(pack("Initial"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try FileManager.default.removeItem(at: root.appendingPathComponent(path))
        let absent = try await sync.sync()
        XCTAssertEqual(absent.uploaded, 0)
        XCTAssertTrue(absent.errors.isEmpty)
        let manifest = await transport.manifest()
        XCTAssertEqual(manifest.first?.isDeleted, false)
    }

    func testTextTextTrashStillDeletesFromCloudWorkspace() async throws {
        let originalRoot = root!
        root = originalRoot.appendingPathComponent("CloudStorage/Workspace")
        defer { root = originalRoot }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let bytes = try pack("Initial")
        try putLocal(bytes)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try LocalVaultDocumentStore(root: root).delete(path: path, expectedHash: TextTextStableDigest.sha256Hex(bytes))
        XCTAssertTrue(try LocalVaultDeviceState.hasDeletion(root: root, itemId: itemId,
                                                            path: path, hash: TextTextStableDigest.sha256Hex(bytes)))
        let deleted = try await sync.sync()
        XCTAssertEqual(deleted.uploaded, 1)
        let manifest = await transport.manifest()
        XCTAssertEqual(manifest.first?.isDeleted, true)
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: itemId,
                                                             path: path, hash: TextTextStableDigest.sha256Hex(bytes)))
    }

    func testRestoredCloudFileCancelsDeletionIntent() async throws {
        let originalRoot = root!
        root = originalRoot.appendingPathComponent("CloudStorage/Workspace")
        defer { root = originalRoot }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let bytes = try pack("Initial")
        try putLocal(bytes)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try LocalVaultDocumentStore(root: root).delete(path: path, expectedHash: TextTextStableDigest.sha256Hex(bytes))
        try putLocal(bytes)
        _ = try await sync.sync()
        try FileManager.default.removeItem(at: root.appendingPathComponent(path))
        let absent = try await sync.sync()
        XCTAssertEqual(absent.uploaded, 0)
        let manifest = await transport.manifest()
        XCTAssertEqual(manifest.first?.isDeleted, false)
    }

    func testRemoteRenameAndDeletionPreserveHistory() async throws {
        let bytes = try pack("Initial")
        try putLocal(bytes)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        let renamed = "Moved/Note.textpack"
        let revision = TextTextStableDigest.sha256Hex(bytes)
        _ = try await transport.rename(itemId: itemId, from: path, to: renamed,
            baseRevision: revision, operationId: UUID().uuidString)
        let moved = try await sync.sync()
        XCTAssertTrue(moved.errors.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(renamed)), bytes)
        try await transport.delete(itemId: itemId, path: renamed, baseRevision: revision, operationId: UUID().uuidString)
        _ = try await sync.sync()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(renamed).path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(".texttext/history/" + revision + ".textpack")), bytes)
    }

    func testRemoteDeletionCannotEraseAnOfflineEdit() async throws {
        let original = try pack("Initial")
        let edited = try pack("Offline edit")
        try putLocal(original)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(edited)
        try await transport.delete(itemId: itemId, path: path,
            baseRevision: TextTextStableDigest.sha256Hex(original), operationId: UUID().uuidString)
        let conflict = try await sync.sync()
        XCTAssertTrue(conflict.errors.isEmpty)
        XCTAssertFalse(conflict.conflicts.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), edited)
    }

    func testLocalDeletionCannotEraseConcurrentWebEdit() async throws {
        try putLocal(pack("Initial"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try FileManager.default.removeItem(at: root.appendingPathComponent(path))
        let web = try pack("Web edit")
        await transport.set(itemId: itemId, path: path, data: web)
        let conflict = try await sync.sync()
        XCTAssertTrue(conflict.errors.isEmpty)
        XCTAssertFalse(conflict.conflicts.isEmpty)
        let retained = try await transport.download(itemId: itemId)
        XCTAssertEqual(retained.data, web)
    }

    func testBindingCannotSilentlyChangeWorkspace() async throws {
        _ = try engine(FakeVaultTransport())
        XCTAssertThrowsError(try LocalVaultSync(root: root,
            binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "other"),
            transport: FakeVaultTransport()))
    }
}

private actor FakeVaultTransport: LocalVaultSyncTransport {
    private var racedDownload: (Data, String)?
    func raceDownload(data: Data, lifecycle: String) { racedDownload = (data, lifecycle) }
    private var lifecycles: [String: String] = [:]
    func restore(itemId: String, path: String, data: Data, lifecycle: String) { set(itemId: itemId, path: path, data: data); tombstones.removeValue(forKey: itemId); lifecycles[itemId] = lifecycle }
    private var remoteFolders: [String] = []
    func folders() -> [String] { remoteFolders }
    func setFolders(_ value: [String]) { remoteFolders = value }
    private var items: [String: LocalVaultRemotePack] = [:]
    private var receipts: [String: String] = [:]
    private var tombstones: [String: LocalVaultRemoteItem] = [:]
    private var uploadedOperations: [String] = []
    private var nativeOrigins: [Bool] = []
    private var downloads = 0
    private var loseReply = false
    private var merged: Data?
    func set(itemId: String, path: String, data: Data) {
        items[itemId] = .init(data: data, relativePath: path, revision: TextTextStableDigest.sha256Hex(data))
    }
    func loseNextReply() { loseReply = true }
    func forgetWithoutTombstone(itemId: String) { items.removeValue(forKey: itemId) }
    func mergeNextUpload(with data: Data) { merged = data }
    func operations() -> [String] { uploadedOperations }
    func uploadOrigins() -> [Bool] { nativeOrigins }
    func counts() -> (upload: Int, download: Int) { (uploadedOperations.count, downloads) }
    func manifest() -> [LocalVaultRemoteItem] {
        items.map { .init(itemId: $0.key, relativePath: $0.value.relativePath, revision: $0.value.revision, lifecycle: lifecycles[$0.key]) } + Array(tombstones.values)
    }
    func download(itemId: String) throws -> LocalVaultRemotePack {
        if let raced = racedDownload, let current = items[itemId] { racedDownload = nil; restore(itemId: itemId, path: current.relativePath, data: raced.0, lifecycle: raced.1) }
        downloads += 1
        guard let item = items[itemId] else { throw LocalVaultSyncFailure.invalidResponse }
        return item
    }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) throws -> String {
        uploadedOperations.append(operationId)
        nativeOrigins.append(nativeEditor)
        if let receipt = receipts[operationId] { return receipt }
        if let merged {
            self.merged = nil
            set(itemId: itemId, path: path, data: merged)
        } else {
            guard tombstones[itemId] == nil, items[itemId]?.revision == baseRevision else { throw LocalVaultSyncFailure.conflict }
            set(itemId: itemId, path: path, data: data)
        }
        let revision = items[itemId]!.revision
        receipts[operationId] = revision
        if loseReply { loseReply = false; throw URLError(.networkConnectionLost) }
        return revision
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String {
        uploadedOperations.append(operationId)
        if let receipt = receipts[operationId] { return receipt }
        guard let item = items[itemId], item.revision == baseRevision, item.relativePath == from,
              !items.values.contains(where: { $0.relativePath == to }) else { throw LocalVaultSyncFailure.conflict }
        items[itemId] = .init(data: item.data, relativePath: to, revision: item.revision)
        receipts[operationId] = item.revision
        return item.revision
    }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) throws {
        uploadedOperations.append(operationId)
        if receipts[operationId] != nil { return }
        guard let item = items[itemId], item.revision == baseRevision, item.relativePath == path else { throw LocalVaultSyncFailure.conflict }
        items.removeValue(forKey: itemId)
        tombstones[itemId] = .init(itemId: itemId, relativePath: path, revision: baseRevision, deleted: true)
        receipts[operationId] = baseRevision
    }

}
