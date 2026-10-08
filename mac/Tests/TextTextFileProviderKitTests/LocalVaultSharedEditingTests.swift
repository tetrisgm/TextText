import XCTest
import ZIPFoundation
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultSharedEditingTests: XCTestCase {
    private var root: URL!
    private let itemId = "e1111111-1111-4111-8111-111111111111"
    private let path = "Notes/Note.textpack"
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func fixture() throws -> LocalVaultDocumentStore.Document {
        let document = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: Note\n---\n\nOriginal", documentJSON: document.documentJSON,
            templateJSON: document.templateJSON, assets: [.init(filename: "picture.bin", data: Data([1, 2, 255]), remoteURL: "assets/picture.bin")], sourceURL: nil, in: root)
        try Data("opaque markdown asset".utf8).write(to: package.url.appendingPathComponent("assets/text.md"))
        try Data("opaque original".utf8).write(to: package.url.appendingPathComponent("extra.dat"))
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pack, to: url)
        try FileManager.default.removeItem(at: pack)
        return try LocalVaultDocumentStore(root: root).read(path: path)
    }
    private func changes(_ original: LocalVaultDocumentStore.Document, body: String) throws -> (String, String) {
        var json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(original.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(json["content"] as? [String: Any]); content["body"] = body; json["content"] = content
        let markdown = "---\ntextTextId: \"\(itemId)\"\ntitle: Note\n---\n\n\(body)"
        return (markdown, String(decoding: try JSONSerialization.data(withJSONObject: json), as: UTF8.self))
    }
    private func checkpoint(_ original: LocalVaultDocumentStore.Document, pending: Bool = true, generation: UInt64 = 1) throws -> LocalVaultSharedCheckpoint {
        let journal: [String: Any] = ["version": 1, "journalGeneration": generation, "epoch": 1, "seq": 0, "revision": original.hash, "relativePath": path,
            "update": "AQ==", "pending": pending ? ["AQ=="] : [], "batch": NSNull()]
        return LocalVaultSharedCheckpoint(itemId: itemId, path: path, projectedHash: original.hash, acknowledgedRevision: original.hash,
            epoch: 1, seq: 0, journalGeneration: generation, journal: String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: pending, retiredReason: nil)
    }
    func testRemoteTemplateMetadataSurvivesInterruptedCheckpointAndReopen() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        var target = try checkpoint(original)
        var definition = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(original.contents.templateJSON).utf8)) as? [String: Any])
        definition["id"] = "custom.remote"
        let template = String(decoding: try JSONSerialization.data(withJSONObject: definition), as: UTF8.self)
        var snapshot = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(original.contents.documentJSON).utf8)) as? [String: Any])
        var presentation = try XCTUnwrap(snapshot["presentation"] as? [String: Any])
        presentation["template"] = ["id": "custom.remote", "version": 1]; snapshot["presentation"] = presentation
        let document = String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self)
        var journal = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["presentation"] = ["templateJSON": template, "templateAuthoringSourceJSON": NSNull()]
        target.journal = String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self)
        XCTAssertThrowsError(try store.materialize(checkpoint: target, expectedHash: original.hash, markdown: original.contents.markdown, documentJSON: document, interruptAfterWrite: true))
        let recovered = try XCTUnwrap(store.checkpoint(itemId: itemId))
        XCTAssertNil(recovered.retiredReason)
        let reopened = try LocalVaultDocumentStore(root: root).read(path: path)
        XCTAssertEqual(reopened.contents.templateJSON, template)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(reopened.contents.documentJSON).utf8)) as? NSDictionary, snapshot as NSDictionary)
        XCTAssertEqual(reopened.contents.assets.first?.data, Data([1, 2, 255]))
    }
    func testOfflineProjectionPreservesCompleteArchiveAndReplayAfterEitherCrashWindow() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        let proposed = try changes(original, body: "Offline shared writing")
        let target = try checkpoint(original)
        XCTAssertThrowsError(try store.materialize(checkpoint: target, expectedHash: original.hash, markdown: proposed.0, documentJSON: proposed.1, interruptAfterIntent: true))
        let recovered = try XCTUnwrap(store.checkpoint(itemId: itemId))
        let file = try LocalVaultDocumentStore(root: root).read(path: path)
        XCTAssertEqual(file.contents.markdown, proposed.0)
        XCTAssertEqual(recovered.projectedHash, file.hash)
        XCTAssertTrue(recovered.pending)
        XCTAssertEqual(file.contents.assets.first?.data, Data([1, 2, 255]))
        let archive = try Archive(url: root.appendingPathComponent(path), accessMode: .read)
        let opaque = try XCTUnwrap(archive.first { $0.path.hasSuffix("extra.dat") }); var data = Data()
        _ = try archive.extract(opaque) { data.append($0) }; XCTAssertEqual(data, Data("opaque original".utf8))
        let second = try changes(file, body: "Newer offline writing")
        var secondCheckpoint = recovered; secondCheckpoint.journalGeneration = 2
        var nextJournal = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(secondCheckpoint.journal.utf8)) as? [String: Any]); nextJournal["journalGeneration"] = 2
        secondCheckpoint.journal = String(decoding: try JSONSerialization.data(withJSONObject: nextJournal), as: UTF8.self)
        XCTAssertThrowsError(try store.materialize(checkpoint: secondCheckpoint, expectedHash: file.hash, markdown: second.0, documentJSON: second.1, interruptAfterWrite: true))
        let secondRecovered = try XCTUnwrap(store.checkpoint(itemId: itemId))
        XCTAssertEqual(secondRecovered.projectedHash, try LocalVaultDocumentStore(root: root).read(path: path).hash)
        XCTAssertNil(secondRecovered.retiredReason)
        let replayedArchive = try Archive(url: root.appendingPathComponent(path), accessMode: .read)
        let markdownAsset = try XCTUnwrap(replayedArchive.first { $0.path.hasSuffix("assets/text.md") }); var assetBytes = Data()
        _ = try replayedArchive.extract(markdownAsset) { assetBytes.append($0) }
        XCTAssertEqual(assetBytes, Data("opaque markdown asset".utf8))
    }
    func testExternalChangeDuringInterruptedIntentRetiresWithoutOverwriting() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        let proposed = try changes(original, body: "Shared pending")
        XCTAssertThrowsError(try store.materialize(checkpoint: checkpoint(original), expectedHash: original.hash, markdown: proposed.0, documentJSON: proposed.1, interruptAfterIntent: true))
        let external = try changes(original, body: "Agent changed the file")
        let written = try LocalVaultDocumentStore(root: root).write(path: path, expectedHash: original.hash, markdown: external.0, documentJSON: external.1,
            templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        XCTAssertThrowsError(try store.checkpoint(itemId: itemId))
        let retained = try XCTUnwrap(store.checkpoint(itemId: itemId))
        XCTAssertNotNil(retained.retiredReason); XCTAssertTrue(retained.pending)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, written.hash)
    }
    func testActorSuppressesSnapshotUploadAndDownloadForPendingAcrossRestart() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "Offline projection"), target = try checkpoint(original)
        let result = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        _ = try await engine.sync()
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await restarted.sync()
        let counts = await transport.counts()
        XCTAssertEqual(counts.0, 1); XCTAssertEqual(counts.1, 0)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, result.document.hash)
        let resumed = try await restarted.beginSharedEditing(itemId: itemId, path: path, expectedHash: result.document.hash)
        XCTAssertEqual(resumed.checkpoint?.journal, target.journal)
        do {
            _ = try await restarted.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: result.document.hash,
                epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 2, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
            XCTFail("A stale session token must fail")
        } catch LocalVaultSharedFailure.staleSession { }
    }
    func testOnlyPersistedActiveSharedBatchCanClaimNativeEditorOrigin() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "Human shared edit")
        var target = try checkpoint(original)
        var journal = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["pending"] = []
        journal["batch"] = ["operationId": "human-push", "updates": ["AQ=="]]
        target.journal = String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self)
        let materialized = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        let matched = try await engine.isNativeSharedPush(itemId: itemId, operationId: "human-push", epoch: 1, updates: ["AQ=="])
        let wrongOperation = try await engine.isNativeSharedPush(itemId: itemId, operationId: "different", epoch: 1, updates: ["AQ=="])
        let wrongUpdates = try await engine.isNativeSharedPush(itemId: itemId, operationId: "human-push", epoch: 1, updates: ["Ag=="])
        let wrongEpoch = try await engine.isNativeSharedPush(itemId: itemId, operationId: "human-push", epoch: 2, updates: ["AQ=="])
        XCTAssertTrue(matched)
        XCTAssertFalse(wrongOperation); XCTAssertFalse(wrongUpdates); XCTAssertFalse(wrongEpoch)

        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let closed = try await engine.isNativeSharedPush(itemId: itemId, operationId: "human-push", epoch: 1, updates: ["AQ=="])
        XCTAssertFalse(closed)
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await restarted.beginSharedEditing(itemId: itemId, path: path, expectedHash: materialized.document.hash)
        let resumed = try await restarted.isNativeSharedPush(itemId: itemId, operationId: "human-push", epoch: 1, updates: ["AQ=="])
        XCTAssertTrue(resumed)

        let agent = try changes(materialized.document, body: "Agent direct file edit")
        _ = try LocalVaultDocumentStore(root: root).write(path: path, expectedHash: materialized.document.hash,
            markdown: agent.0, documentJSON: agent.1, templateJSON: original.contents.templateJSON,
            templateAuthoringSourceJSON: original.contents.templateAuthoringSourceJSON)
        let changedOutside = try await restarted.isNativeSharedPush(itemId: itemId, operationId: "human-push", epoch: 1, updates: ["AQ=="])
        XCTAssertFalse(changedOutside)
    }
    func testRecoveredPendingPrimaryIsNeverUploadedWhenRemoteRevisionIsUnchanged() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "Abandoned pending shared text"), target = try checkpoint(original)
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        let recovered = try LocalVaultDocumentStore(root: root).clone(path: path, newPath: "Notes/Recovered.textpack")
        try await engine.finishSharedRecovery(sessionToken: session.sessionToken, itemId: itemId, recoveryPath: recovered.path, recoveryHash: recovered.hash)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, original.hash)
        XCTAssertNotEqual(written.document.hash, original.hash)
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await restarted.sync()
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, original.hash)
        let uploaded = await transport.uploadedBodies()
        XCTAssertFalse(uploaded.filter { $0.0 == itemId }.contains { $0.1 == written.document.hash })
        XCTAssertTrue(try LocalVaultDocumentStore(root: root).read(path: recovered.path).contents.markdown.contains("Abandoned pending shared text"))
        let names = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(".texttext/shared-editing/" + itemId).path)
        XCTAssertTrue(names.contains { $0.hasPrefix("archived-") && $0.hasSuffix("-projection.textpack") })
    }

    func testCleanCheckpointRetainedUntilRemoteFileChanges() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let target = try checkpoint(original, pending: false)
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: target.journal, pending: false,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let reopened = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: written.document.hash)
        XCTAssertEqual(reopened.checkpoint?.journal, target.journal)
        XCTAssertEqual(reopened.acknowledgedRevision, original.hash)
        try await engine.endSharedEditing(sessionToken: reopened.sessionToken, itemId: itemId)
        let change = try changes(written.document, body: "Remote advanced")
        let remote = try LocalVaultDocumentStore(root: root).write(path: path, expectedHash: written.document.hash, markdown: change.0,
            documentJSON: change.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let remoteData = try Data(contentsOf: root.appendingPathComponent(path))
        // Restore the exact local projection; the next change comes through the sync transport.
        let projection = root.appendingPathComponent(".texttext/shared-editing/" + itemId + "/projection.textpack")
        try Data(contentsOf: projection).write(to: root.appendingPathComponent(path))
        await transport.set(itemId: itemId, path: path, data: remoteData)
        _ = try await engine.sync()
        let newer = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: remote.hash)
        XCTAssertNil(newer.checkpoint)
        XCTAssertEqual(newer.acknowledgedRevision, remote.hash)
    }
    func testCleanSharedCheckpointBecomesBaselineForAgentEditWhileSessionIsOpen() async throws {
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)

        let originalBytes = try Data(contentsOf: root.appendingPathComponent(path))
        let first = try changes(original, body: "First shared marker")
        let remote = try store.write(path: path, expectedHash: original.hash, markdown: first.0, documentJSON: first.1,
            templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let remoteBytes = try Data(contentsOf: root.appendingPathComponent(path))
        try originalBytes.write(to: root.appendingPathComponent(path), options: .atomic)
        await transport.set(itemId: itemId, path: path, data: remoteBytes)

        var target = try checkpoint(original, pending: false)
        var journal = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["revision"] = remote.hash; journal["seq"] = 1
        target.journal = String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self)
        let projected = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 1, acknowledgedRevision: remote.hash,
            journalGeneration: 1, journal: target.journal, pending: false, markdown: first.0, documentJSON: first.1)
        let agent = try changes(projected.document, body: "First shared marker\nAgent external marker")
        let edited = try store.write(path: path, expectedHash: projected.document.hash, markdown: agent.0, documentJSON: agent.1,
            templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)

        let report = try await engine.sync()
        XCTAssertTrue(report.conflicts.isEmpty)
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertEqual(try store.read(path: path).hash, edited.hash)
        let uploaded = await transport.uploadedBodies()
        XCTAssertTrue(uploaded.contains { $0.0 == itemId && $0.1 == edited.hash })
        let idle = try await engine.sync()
        XCTAssertEqual(idle.uploaded, 0)
        XCTAssertTrue(idle.conflicts.isEmpty)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let reopened = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: edited.hash)
        XCTAssertNil(reopened.checkpoint)
    }
    func testExternalChangeKeepsRecoveryTokenBeforeFirstCheckpoint() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "External agent edit")
        let external = try LocalVaultDocumentStore(root: root).write(path: path, expectedHash: original.hash, markdown: change.0,
            documentJSON: change.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        _ = try await engine.sync()
        let recovery = try LocalVaultDocumentStore(root: root).clone(path: path, newPath: "Notes/Recovered.textpack")
        try await engine.finishSharedRecovery(sessionToken: session.sessionToken, itemId: itemId, recoveryPath: recovery.path, recoveryHash: recovery.hash)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, external.hash)
    }

    func testRecoveryDownloadsNewRemoteEpochWithoutUploadingAbandonedPrimary() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "Abandoned pending text"), target = try checkpoint(original)
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: target.journal, pending: true,
            markdown: change.0, documentJSON: change.1)
        let store = LocalVaultDocumentStore(root: root)
        let recovered = try store.clone(path: path, newPath: "Notes/Recovered.textpack")
        let pendingBytes = try Data(contentsOf: root.appendingPathComponent(path))
        let remoteChange = try changes(written.document, body: "New remote epoch")
        let remote = try store.write(path: path, expectedHash: written.document.hash, markdown: remoteChange.0,
            documentJSON: remoteChange.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        await transport.set(itemId: itemId, path: path, data: try Data(contentsOf: root.appendingPathComponent(path)))
        try pendingBytes.write(to: root.appendingPathComponent(path))
        try await engine.finishSharedRecovery(sessionToken: session.sessionToken, itemId: itemId, recoveryPath: recovered.path, recoveryHash: recovered.hash)
        _ = try await engine.sync()
        XCTAssertEqual(try store.read(path: path).hash, remote.hash)
        let uploads = await transport.uploadedBodies()
        XCTAssertFalse(uploads.contains { $0.0 == itemId && $0.1 == written.document.hash })
    }

    func testRetiredPendingProjectionRemainsProtectedUntilRecovered() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        var target = try checkpoint(original)
        var journal = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["retired"] = "Remote epoch changed"
        target.journal = String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self)
        let change = try changes(original, body: "Pending recovery text")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: target.journal, pending: true,
            markdown: change.0, documentJSON: change.1)
        XCTAssertEqual(written.checkpoint.retiredReason, "Remote epoch changed")
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        _ = try await engine.sync()
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, written.document.hash)
        let counts = await transport.counts(); XCTAssertEqual(counts.0, 1); XCTAssertEqual(counts.1, 0)
        let recoverySession = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: written.document.hash)
        XCTAssertNotNil(recoverySession.checkpoint?.retiredReason)
    }
    func testCleanRetirementArchivesAndRefreshesEvenUnchangedRemoteRevision() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        var target = try checkpoint(original, pending: false)
        var journal = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["retired"] = "Permission changed"
        target.journal = String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self)
        _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: target.journal, pending: false,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        _ = try await engine.sync()
        let reopened = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        XCTAssertNil(reopened.checkpoint)
        let counts = await transport.counts(); XCTAssertEqual(counts.0, 1); XCTAssertEqual(counts.1, 1)
    }

    func testGenerationRegressionAndSameGenerationChangedJournalFail() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        let change = try changes(original, body: "Shared")
        let target = try checkpoint(original, generation: 3)
        let materialized = try store.materialize(checkpoint: target, expectedHash: original.hash, markdown: change.0, documentJSON: change.1)
        var stale = target; stale.journalGeneration = 2
        XCTAssertThrowsError(try store.materialize(checkpoint: stale, expectedHash: materialized.document.hash, markdown: change.0, documentJSON: change.1))
        stale.journalGeneration = 3; stale.journal = stale.journal.replacingOccurrences(of: "AQ==", with: "Ag==")
        XCTAssertThrowsError(try store.materialize(checkpoint: stale, expectedHash: materialized.document.hash, markdown: change.0, documentJSON: change.1))
    }
}
private actor SharedTransport: LocalVaultSyncTransport {
    var items: [String: LocalVaultRemoteItem] = [:], bytes: [String: Data] = [:], uploads = 0, downloads = 0
    var bodies: [(String, String)] = []
    func uploadedBodies() -> [(String, String)] { bodies }
    func set(itemId: String, path: String, data: Data) { bytes[itemId] = data; items[itemId] = LocalVaultRemoteItem(itemId: itemId, relativePath: path, revision: TextTextStableDigest.sha256Hex(data)) }
    func counts() -> (Int, Int) { (uploads, downloads) }
    func manifest() async throws -> [LocalVaultRemoteItem] { Array(items.values) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { downloads += 1; return LocalVaultRemotePack(data: bytes[itemId]!, relativePath: items[itemId]!.relativePath, revision: items[itemId]!.revision) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String {
        uploads += 1; let revision = TextTextStableDigest.sha256Hex(data); bodies.append((itemId, revision))
        set(itemId: itemId, path: path, data: data); return revision
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { items.removeValue(forKey: itemId); bytes.removeValue(forKey: itemId) }
}
