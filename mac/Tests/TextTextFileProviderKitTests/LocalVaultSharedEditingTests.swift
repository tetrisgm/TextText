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
    func testPendingJournalAndExternalFileRemainReopenableAfterRestart() async throws {
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let text = try changes(saved.document, body: "Pending human\nCLI while closed")
        let external = try store.write(path: path, expectedHash: saved.document.hash, markdown: text.0,
            documentJSON: text.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        let result = try await restarted.sync()
        XCTAssertEqual(result.uploaded, 0)
        XCTAssertTrue(try LocalVaultSync.collaborationReady(root: root, path: path, itemId: itemId, localHash: external.hash))
        let reopened = try await restarted.beginSharedEditing(itemId: itemId, path: path, expectedHash: external.hash)
        XCTAssertNil(reopened.checkpoint?.retiredReason)
        XCTAssertEqual(reopened.checkpoint?.projectedHash, saved.document.hash)
        XCTAssertEqual(reopened.document.hash, external.hash)
    }
    func testExternalWriteCollisionKeepsActiveLeaseForMergedCheckpoint() async throws {
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let externalText = try changes(saved.document, body: "Pending human\nExternal CLI")
        let external = try store.write(path: path, expectedHash: saved.document.hash, markdown: externalText.0,
            documentJSON: externalText.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let merged = try changes(external, body: "Pending human\nExternal CLI\nMore typing"), next = try checkpoint(original, generation: 2)
        do {
            _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
                expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
                journalGeneration: 2, journal: next.journal, pending: true, markdown: merged.0, documentJSON: merged.1)
            XCTFail("Stale file revision was accepted")
        } catch LocalVaultSyncFailure.changed { }
        let protected = try await engine.sync()
        XCTAssertEqual(protected.uploaded, 0)
        let retained = try await engine.readSharedCheckpoint(itemId: itemId)
        XCTAssertNil(retained?.retiredReason)
        let result = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: external.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: next.journal, pending: true, markdown: merged.0, documentJSON: merged.1)
        XCTAssertTrue(result.document.contents.markdown.contains("External CLI\nMore typing"))
        XCTAssertNil(result.checkpoint.retiredReason)
        XCTAssertEqual(result.checkpoint.journalGeneration, 2)
    }
    func testPathRebaseRecoversBothCrashWindowsWithoutLosingPendingJournal() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        let target = try checkpoint(original)
        _ = try store.materialize(checkpoint: target, expectedHash: original.hash,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        let first = "Archive/Note.textpack", second = "Archive/Again/Note.textpack"
        XCTAssertThrowsError(try store.rebase(itemId: itemId, newPath: first, interruptAfterIntent: true))
        let recovered = try XCTUnwrap(store.checkpoint(itemId: itemId))
        XCTAssertEqual(recovered.path, first)
        XCTAssertEqual(recovered.projectedHash, original.hash)
        XCTAssertTrue(recovered.pending)
        XCTAssertEqual(recovered.journalGeneration, target.journalGeneration)
        var expected = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        expected["relativePath"] = first
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(recovered.journal.utf8)) as? NSDictionary, expected as NSDictionary)
        XCTAssertThrowsError(try store.rebase(itemId: itemId, newPath: second, interruptAfterMove: true))
        let twice = try XCTUnwrap(store.checkpoint(itemId: itemId))
        XCTAssertEqual(twice.path, second)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: second).hash, original.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(first).path))
    }
    func testPathRebaseRejectsOccupiedDestinationAndPreservesBothFiles() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        _ = try store.materialize(checkpoint: checkpoint(original), expectedHash: original.hash,
            markdown: original.contents.markdown, documentJSON: XCTUnwrap(original.contents.documentJSON))
        let destination = "Notes/Occupied.textpack"
        let bytes = Data("unrelated existing file".utf8)
        try bytes.write(to: root.appendingPathComponent(destination))
        XCTAssertThrowsError(try store.rebase(itemId: itemId, newPath: destination))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), bytes)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, original.hash)
        XCTAssertEqual(try store.checkpoint(itemId: itemId)?.path, path)
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
    func testMoveBeforeFirstCheckpointDefersThenReconcilesWithoutRetiringSession() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let moved = "Archive/Early/Note.textpack"
        await transport.set(itemId: itemId, path: moved, data: try Data(contentsOf: root.appendingPathComponent(path)))
        let deferred = try await engine.sync()
        XCTAssertTrue(deferred.errors.isEmpty)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, original.hash)
        let target = try checkpoint(original), change = try changes(original, body: "First pending edit")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        let reconciled = try await engine.sync()
        XCTAssertTrue(reconciled.errors.isEmpty)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: moved).hash, written.document.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        let retained = try await engine.readSharedCheckpoint(itemId: itemId)
        XCTAssertEqual(retained?.path, moved)
        XCTAssertTrue(retained?.pending == true)
        XCTAssertNil(retained?.retiredReason)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testLocalFileRenameWhileEditingFollowsPathAndKeepsCheckpointing() async throws {
        // Finder, CLI or iCloud renames the open TextPack. The live session must
        // follow the file, keep checkpointing, and upload the rename.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let renamed = "Notes/Six-client acceptance.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        // Checkpoint before any sync cycle notices the rename.
        let target = try checkpoint(original), change = try changes(original, body: "Edit after the rename")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        XCTAssertEqual(written.document.path, renamed)
        XCTAssertEqual(try store.read(path: renamed).hash, written.document.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertEqual(retained.path, renamed); XCTAssertNil(retained.retiredReason)
        XCTAssertEqual(try XCTUnwrap(JSONSerialization.jsonObject(with: Data(retained.journal.utf8)) as? [String: Any])["relativePath"] as? String, renamed)
        // The sync cycle keeps the session and sends the rename to the server.
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let renames = await transport.renames()
        XCTAssertEqual(renames, [(path, renamed)].map { "\($0.0)->\($0.1)" })
        let remotePath = await transport.remotePath(itemId)
        XCTAssertEqual(remotePath, renamed)
        var journal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["journalGeneration"] = 2
        let next = try changes(written.document, body: "Still editing after the rename")
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: written.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self),
            pending: true, markdown: next.0, documentJSON: next.1)
        XCTAssertEqual(saved.document.path, renamed)
        XCTAssertNil(saved.checkpoint.retiredReason)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testLocalFileRenameNoticedBySyncBeforeFirstCheckpointKeepsSession() async throws {
        // Same rename, but a sync cycle runs before the editor's first checkpoint.
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let renamed = "Notes/Renamed while open.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let remotePath = await transport.remotePath(itemId)
        XCTAssertEqual(remotePath, renamed)
        let target = try checkpoint(original), change = try changes(original, body: "First edit after sync saw the rename")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        XCTAssertEqual(written.document.path, renamed)
        XCTAssertNil(written.checkpoint.retiredReason)
        let afterCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        XCTAssertNil(afterCheckpoint?.retiredReason)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testLocalRenameWithExternalEditReconcilesInPlaceWithPendingHumanEdit() async throws {
        // The open file is renamed and then edited by a CLI while a human edit is
        // pending. The session follows the file, refuses the stale checkpoint as
        // changed (never file-not-found, never retired), and the merged checkpoint
        // lands at the new path, after which the rename is uploaded.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let renamed = "Notes/Renamed and edited.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let externalText = try changes(saved.document, body: "Pending human\nExternal CLI")
        let external = try store.write(path: renamed, expectedHash: saved.document.hash, markdown: externalText.0,
            documentJSON: externalText.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let stale = try changes(external, body: "Pending human\nMore typing"), next = try checkpoint(original, generation: 2)
        do {
            _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
                expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
                journalGeneration: 2, journal: next.journal, pending: true, markdown: stale.0, documentJSON: stale.1)
            XCTFail("Stale file revision was accepted")
        } catch LocalVaultSyncFailure.changed { }
        let followed = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertEqual(followed, renamed)
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNil(retained.retiredReason); XCTAssertEqual(retained.path, renamed)
        XCTAssertEqual(retained.projectedHash, saved.document.hash)
        XCTAssertEqual(try store.read(path: renamed).hash, external.hash, "External bytes must stay untouched until merged")
        let protected = try await engine.sync()
        XCTAssertTrue(protected.errors.isEmpty, "\(protected.errors)")
        XCTAssertEqual(protected.uploaded, 0)
        let awaited1 = await transport.renames()
        XCTAssertEqual(awaited1, [], "A rename is announced only once the editor holds the external edit")
        // The editor merged the external text into Yjs and checkpoints the result.
        let merged = try changes(external, body: "Pending human\nExternal CLI\nMore typing")
        let result = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: external.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: next.journal, pending: true, markdown: merged.0, documentJSON: merged.1)
        XCTAssertEqual(result.document.path, renamed)
        XCTAssertNil(result.checkpoint.retiredReason)
        XCTAssertTrue(result.document.contents.markdown.contains("External CLI\nMore typing"))
        XCTAssertEqual(try XCTUnwrap(JSONSerialization.jsonObject(with: Data(result.checkpoint.journal.utf8)) as? [String: Any])["relativePath"] as? String, renamed)
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let awaited2 = await transport.renames()
        XCTAssertEqual(awaited2, ["\(path)->\(renamed)"])
        let awaited3 = await transport.remotePath(itemId)
        XCTAssertEqual(awaited3, renamed)
        XCTAssertEqual(try store.read(path: renamed).hash, result.document.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testLocalRenameWithExternalEditNoticedBySyncFirstKeepsSessionForMerge() async throws {
        // Same rename plus CLI edit, but a sync cycle runs before the editor's next
        // checkpoint. Protection must follow the file instead of retiring it.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let renamed = "Archive/Edited elsewhere.textpack"
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Archive"), withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let externalText = try changes(saved.document, body: "Pending human\nAgent edit")
        let external = try store.write(path: renamed, expectedHash: saved.document.hash, markdown: externalText.0,
            documentJSON: externalText.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        XCTAssertEqual(report.uploaded, 0)
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNil(retained.retiredReason); XCTAssertEqual(retained.path, renamed)
        let awaited4 = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertEqual(awaited4, renamed)
        XCTAssertEqual(try store.read(path: renamed).hash, external.hash)
        let merged = try changes(external, body: "Pending human\nAgent edit\nTyped after"), next = try checkpoint(original, generation: 2)
        let result = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: external.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: next.journal, pending: true, markdown: merged.0, documentJSON: merged.1)
        XCTAssertEqual(result.document.path, renamed)
        XCTAssertNil(result.checkpoint.retiredReason)
        let announced = try await engine.sync()
        XCTAssertTrue(announced.errors.isEmpty, "\(announced.errors)")
        let awaited5 = await transport.remotePath(itemId)
        XCTAssertEqual(awaited5, renamed)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testLocalRenameWithDuplicateIdentityRetiresWithoutGuessing() async throws {
        // Two files now carry the identity. The session must not adopt either;
        // the pending journal stays retained for recovery and both files survive.
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let one = "Notes/Copy one.textpack", two = "Notes/Copy two.textpack"
        try FileManager.default.copyItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(one))
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(two))
        _ = try await engine.sync()
        let awaited6 = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertNil(awaited6)
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNotNil(retained.retiredReason)
        XCTAssertEqual(retained.path, path)
        XCTAssertTrue(retained.pending)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(one).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(two).path))
        let awaited7 = await transport.renames()
        XCTAssertEqual(awaited7, [])
    }
    /// A second TextPack with its own identity, indexed by the first sync cycle.
    private func otherFixture(itemId otherId: String, path otherPath: String) throws -> LocalVaultDocumentStore.Document {
        let document = try BuiltinTextPackDocument.create(title: "Other", body: "Other body")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(otherId)\"\ntitle: Other\n---\n\nOther body",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        let url = root.appendingPathComponent(otherPath)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pack, to: url)
        try FileManager.default.removeItem(at: pack)
        return try LocalVaultDocumentStore(root: root).read(path: otherPath)
    }
    func testLocalRenameWithCopyOverIndexedFileRetiresWithoutGuessing() async throws {
        // The open file is copied over an already indexed TextPack (item Y) and
        // the original is then moved. The index still says Y at that path, but
        // the bytes carry X: two same-identity files. A checkpoint before any
        // rescan must not adopt either; the journal stays retained and no
        // rename is announced.
        let original = try fixture(), transport = SharedTransport()
        let otherId = "e2222222-2222-4222-8222-222222222222", other = "Notes/Other.textpack"
        _ = try otherFixture(itemId: otherId, path: other)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let indexedOther = await transport.remotePath(otherId)
        XCTAssertEqual(indexedOther, other)
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let moved = "Notes/Moved.textpack"
        try FileManager.default.removeItem(at: root.appendingPathComponent(other))
        try FileManager.default.copyItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(other))
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(moved))
        // Checkpoint before any sync cycle rescans the index.
        var journal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(cp.journal.utf8)) as? [String: Any])
        journal["journalGeneration"] = 2
        let next = try changes(saved.document, body: "Pending human\nAfter the copy")
        do {
            _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
                expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
                journalGeneration: 2, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self),
                pending: true, markdown: next.0, documentJSON: next.1)
            XCTFail("Checkpoint adopted one of two same-identity files")
        } catch { } // Refused: the session still points at the missing original.
        let followed = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertNotEqual(followed, moved); XCTAssertNotEqual(followed, other)
        let untouchedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let untouched = try XCTUnwrap(untouchedCheckpoint)
        XCTAssertEqual(untouched.path, path); XCTAssertTrue(untouched.pending)
        XCTAssertEqual(untouched.projectedHash, saved.document.hash)
        _ = try await engine.sync()
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNotNil(retained.retiredReason); XCTAssertEqual(retained.path, path); XCTAssertTrue(retained.pending)
        XCTAssertEqual(retained.projectedHash, saved.document.hash)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: other).hash, saved.document.hash)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: moved).hash, saved.document.hash)
        // Nothing announced a path: the retired pending journal protects the
        // item in the retiring cycle too, so the ordinary path never guesses
        // from the one copy the stale index can see. Later cycles rescan the
        // overwritten path and still send nothing.
        let renamesAfterRetire = await transport.renames()
        XCTAssertEqual(renamesAfterRetire, [])
        let countsAfterRetire = await transport.counts()
        for _ in 0..<2 {
            let later = try await engine.sync()
            XCTAssertEqual(later.uploaded, 0)
        }
        let countsAfterRescan = await transport.counts()
        XCTAssertEqual(countsAfterRescan.0, countsAfterRetire.0)
        let remoteOther = await transport.remotePath(otherId)
        XCTAssertEqual(remoteOther, other)
        let afterRescanCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let afterRescan = try XCTUnwrap(afterRescanCheckpoint)
        XCTAssertNotNil(afterRescan.retiredReason); XCTAssertTrue(afterRescan.pending)
        XCTAssertEqual(afterRescan.projectedHash, saved.document.hash)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: other).hash, saved.document.hash)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: moved).hash, saved.document.hash)
        let renames = await transport.renames()
        XCTAssertEqual(renames, [])
    }
    func testLocalMoveOverIndexedFileFollowsUniqueCurrentIdentity() async throws {
        // The open file is moved over an already indexed TextPack (item Y).
        // Only one file now carries X, at a path the index still attributes to
        // Y. The session follows the on-disk identity, not the stale index.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let otherId = "e2222222-2222-4222-8222-222222222222", other = "Notes/Other.textpack"
        _ = try otherFixture(itemId: otherId, path: other)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        try FileManager.default.removeItem(at: root.appendingPathComponent(other))
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(other))
        var journal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(cp.journal.utf8)) as? [String: Any])
        journal["journalGeneration"] = 2
        let next = try changes(saved.document, body: "Pending human\nAfter the move")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self),
            pending: true, markdown: next.0, documentJSON: next.1)
        XCTAssertEqual(written.document.path, other)
        XCTAssertNil(written.checkpoint.retiredReason)
        XCTAssertEqual(try store.read(path: other).hash, written.document.hash)
        let followed = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertEqual(followed, other)
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertEqual(retained.path, other); XCTAssertNil(retained.retiredReason); XCTAssertTrue(retained.pending)
        // The stale index entry for Y is corrected by rescans; the rename is
        // announced once the index agrees with the bytes on disk.
        for _ in 0..<3 where await transport.remotePath(itemId) != other { _ = try await engine.sync() }
        let remotePath = await transport.remotePath(itemId)
        XCTAssertEqual(remotePath, other)
        let renames = await transport.renames()
        XCTAssertEqual(renames, ["\(path)->\(other)"])
        let stillFollowed = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertEqual(stillFollowed, other)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testConcurrentLocalAndRemoteRenameFollowsServerPath() async throws {
        // Local Finder rename and a remote rename race. The server path wins
        // for the open session; content, journal and session are untouched.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let local = "Notes/Local name.textpack", remote = "Notes/Remote name.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(local))
        await transport.set(itemId: itemId, path: remote, data: try Data(contentsOf: root.appendingPathComponent(local)))
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let awaited8 = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertEqual(awaited8, remote)
        XCTAssertEqual(try store.read(path: remote).hash, saved.document.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(local).path))
        let awaited9 = await transport.renames()
        XCTAssertEqual(awaited9, [])
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNil(retained.retiredReason); XCTAssertEqual(retained.path, remote)
        let next = try changes(saved.document, body: "Pending human\nAfter both renames"), target = try checkpoint(original, generation: 2)
        let result = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: target.journal, pending: true, markdown: next.0, documentJSON: next.1)
        XCTAssertEqual(result.document.path, remote)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testConcurrentLocalAndRemoteRenameToSamePathConvergesWithoutUpload() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        let same = "Notes/Same name.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(same))
        await transport.set(itemId: itemId, path: same, data: try Data(contentsOf: root.appendingPathComponent(same)))
        for _ in 0..<2 {
            let report = try await engine.sync()
            XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        }
        let awaited10 = await transport.renames()
        XCTAssertEqual(awaited10, [])
        let awaited11 = await engine.sharedSessionPath(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertEqual(awaited11, same)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: same).hash, saved.document.hash)
        let retainedCheckpoint = try await engine.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNil(retained.retiredReason); XCTAssertEqual(retained.path, same)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        XCTAssertTrue(try LocalVaultSync.collaborationReady(root: root, path: same, itemId: itemId, localHash: saved.document.hash))
    }
    func testRenameAnnouncementWaitingForOrganizeAccessNeverBlocksCheckpoints() async throws {
        // Offline or without organize access the rename cannot reach the server
        // yet. The live session must keep checkpointing (never `busy`) and the
        // announcement happens once access returns.
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let renamed = "Notes/Renamed offline.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        await transport.setOrganize(false)
        let blocked = try await engine.sync()
        XCTAssertTrue(blocked.errors.isEmpty, "\(blocked.errors)")
        let noRename = await transport.renames()
        XCTAssertEqual(noRename, [])
        let target = try checkpoint(original), change = try changes(original, body: "Typed while the rename waits")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        XCTAssertEqual(written.document.path, renamed)
        XCTAssertNil(written.checkpoint.retiredReason)
        await transport.setOrganize(true)
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let announced = await transport.remotePath(itemId)
        XCTAssertEqual(announced, renamed)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let reopened = try await engine.beginSharedEditing(itemId: itemId, path: renamed, expectedHash: written.document.hash)
        XCTAssertNil(reopened.checkpoint?.retiredReason)
    }
    func testRenameAnnouncementConflictRetriesWithoutConflictCopyOrBlockingEditor() async throws {
        // A collaborator's commit advanced the server revision between manifest
        // and rename. The rename retries next cycle; the live projection is never
        // written as a conflict copy and checkpoints keep succeeding.
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let target = try checkpoint(original), change = try changes(original, body: "Pending human")
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        let renamed = "Notes/Renamed under contention.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        await transport.failNextRename(LocalVaultSyncFailure.conflict)
        let contended = try await engine.sync()
        XCTAssertTrue(contended.errors.isEmpty, "\(contended.errors)")
        XCTAssertTrue(contended.conflicts.isEmpty, "\(contended.conflicts)")
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext/conflicts").path))
        let stillLocal = await transport.remotePath(itemId)
        XCTAssertEqual(stillLocal, path)
        var journal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["journalGeneration"] = 2
        let next = try changes(saved.document, body: "Pending human\nStill typing")
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self),
            pending: true, markdown: next.0, documentJSON: next.1)
        XCTAssertEqual(written.document.path, renamed)
        XCTAssertNil(written.checkpoint.retiredReason)
        let retried = try await engine.sync()
        XCTAssertTrue(retried.errors.isEmpty, "\(retried.errors)")
        let announced = await transport.renames()
        XCTAssertEqual(announced, ["\(path)->\(renamed)"])
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
    }
    func testRenameWhileClosedReopensRetainedJournalAtNewPath() async throws {
        // The app was closed with a pending journal; Finder renamed the file
        // meanwhile. Reopening at the new path adopts it for the retained
        // checkpoint and journal, the next cycle announces the rename, and
        // checkpoints continue at the new path. No recovery is needed.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let renamed = "Notes/Renamed while closed.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        XCTAssertTrue(try LocalVaultSync.collaborationReady(root: root, path: renamed, itemId: itemId, localHash: saved.document.hash))
        // Reopen before any sync cycle has noticed the rename.
        let reopened = try await restarted.beginSharedEditing(itemId: itemId, path: renamed, expectedHash: saved.document.hash)
        let retained = try XCTUnwrap(reopened.checkpoint)
        XCTAssertNil(retained.retiredReason); XCTAssertTrue(retained.pending)
        XCTAssertEqual(retained.path, renamed); XCTAssertEqual(retained.projectedHash, saved.document.hash)
        XCTAssertEqual(retained.journalGeneration, 1)
        XCTAssertEqual(try XCTUnwrap(JSONSerialization.jsonObject(with: Data(retained.journal.utf8)) as? [String: Any])["relativePath"] as? String, renamed)
        XCTAssertEqual(reopened.document.hash, saved.document.hash)
        let report = try await restarted.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let renames = await transport.renames()
        XCTAssertEqual(renames, ["\(path)->\(renamed)"])
        let remotePath = await transport.remotePath(itemId)
        XCTAssertEqual(remotePath, renamed)
        let afterAnnounce = try await restarted.readSharedCheckpoint(itemId: itemId)
        XCTAssertTrue(try XCTUnwrap(afterAnnounce).pending)
        let next = try changes(saved.document, body: "Pending human\nTyping after reopen"), cp2 = try checkpoint(original, generation: 2)
        let written = try await restarted.materializeSharedEditing(sessionToken: reopened.sessionToken, itemId: itemId,
            expectedHash: saved.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: cp2.journal, pending: true, markdown: next.0, documentJSON: next.1)
        XCTAssertEqual(written.document.path, renamed)
        XCTAssertNil(written.checkpoint.retiredReason)
        XCTAssertEqual(try store.read(path: renamed).hash, written.document.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        try await restarted.endSharedEditing(sessionToken: reopened.sessionToken, itemId: itemId)
    }
    func testRenameAndExternalEditWhileClosedReopensForMergeWithoutRecovery() async throws {
        // Closed with a pending journal, then renamed and edited by a CLI. The
        // first sync cycle after launch follows the file without retiring or
        // uploading; reopening hands the external text to the editor against the
        // retained projection; the merged checkpoint lands at the new path and
        // the rename is announced only then.
        let original = try fixture(), transport = SharedTransport(), store = LocalVaultDocumentStore(root: root)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let renamed = "Notes/Renamed and edited while closed.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let externalText = try changes(saved.document, body: "Pending human\nExternal CLI")
        let external = try store.write(path: renamed, expectedHash: saved.document.hash, markdown: externalText.0,
            documentJSON: externalText.1, templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        let protected = try await restarted.sync()
        XCTAssertTrue(protected.errors.isEmpty, "\(protected.errors)")
        XCTAssertEqual(protected.uploaded, 0)
        let early = await transport.renames()
        XCTAssertEqual(early, [], "A rename is announced only once the editor holds the external edit")
        let followedCheckpoint = try await restarted.readSharedCheckpoint(itemId: itemId)
        let followed = try XCTUnwrap(followedCheckpoint)
        XCTAssertNil(followed.retiredReason); XCTAssertTrue(followed.pending)
        XCTAssertEqual(followed.path, renamed); XCTAssertEqual(followed.projectedHash, saved.document.hash)
        XCTAssertEqual(try store.read(path: renamed).hash, external.hash, "External bytes stay untouched until merged")
        XCTAssertTrue(try LocalVaultSync.collaborationReady(root: root, path: renamed, itemId: itemId, localHash: external.hash))
        let reopened = try await restarted.beginSharedEditing(itemId: itemId, path: renamed, expectedHash: external.hash)
        XCTAssertNil(reopened.checkpoint?.retiredReason)
        XCTAssertEqual(reopened.checkpoint?.projectedHash, saved.document.hash)
        XCTAssertEqual(reopened.document.hash, external.hash)
        let merged = try changes(external, body: "Pending human\nExternal CLI\nMore typing"), cp2 = try checkpoint(original, generation: 2)
        let result = try await restarted.materializeSharedEditing(sessionToken: reopened.sessionToken, itemId: itemId,
            expectedHash: external.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: cp2.journal, pending: true, markdown: merged.0, documentJSON: merged.1)
        XCTAssertEqual(result.document.path, renamed)
        XCTAssertNil(result.checkpoint.retiredReason)
        XCTAssertTrue(result.document.contents.markdown.contains("External CLI\nMore typing"))
        let report = try await restarted.sync()
        XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let renames = await transport.renames()
        XCTAssertEqual(renames, ["\(path)->\(renamed)"])
        let remotePath = await transport.remotePath(itemId)
        XCTAssertEqual(remotePath, renamed)
        XCTAssertEqual(try store.read(path: renamed).hash, result.document.hash)
        try await restarted.endSharedEditing(sessionToken: reopened.sessionToken, itemId: itemId)
    }
    func testRenameWhileClosedWithDuplicateIdentityStaysProtected() async throws {
        // Two same-identity files appear while the app is closed. Neither the
        // reopen nor the sync cycle may guess; the journal is retained for recovery.
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let first = try changes(original, body: "Pending human"), cp = try checkpoint(original)
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: cp.journal, pending: true, markdown: first.0, documentJSON: first.1)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let one = "Notes/Copy one.textpack", two = "Notes/Copy two.textpack"
        try FileManager.default.copyItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(one))
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(two))
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        do {
            _ = try await restarted.beginSharedEditing(itemId: itemId, path: two, expectedHash: saved.document.hash)
            XCTFail("Reopen adopted one of two same-identity files")
        } catch LocalVaultSyncFailure.changed { }
        let untouchedCheckpoint = try await restarted.readSharedCheckpoint(itemId: itemId)
        let untouched = try XCTUnwrap(untouchedCheckpoint)
        XCTAssertEqual(untouched.path, path); XCTAssertNil(untouched.retiredReason); XCTAssertTrue(untouched.pending)
        _ = try await restarted.sync()
        let retainedCheckpoint = try await restarted.readSharedCheckpoint(itemId: itemId)
        let retained = try XCTUnwrap(retainedCheckpoint)
        XCTAssertNotNil(retained.retiredReason); XCTAssertEqual(retained.path, path); XCTAssertTrue(retained.pending)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(one).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(two).path))
        let renames = await transport.renames()
        XCTAssertEqual(renames, [])
    }
    func testRemoteFolderMovePreservesActiveSessionAndPendingEdits() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "Shared edit during folder move"), target = try checkpoint(original)
        let written = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: target.journal, pending: true, markdown: change.0, documentJSON: change.1)
        let moved = "Archive/Shared/Note.textpack"
        await transport.set(itemId: itemId, path: moved, data: try Data(contentsOf: root.appendingPathComponent(path)))
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: moved).hash, written.document.hash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        var journal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any])
        journal["journalGeneration"] = 2
        let next = try changes(written.document, body: "Still editing after the move")
        let saved = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId,
            expectedHash: written.document.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 2, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self),
            pending: true, markdown: next.0, documentJSON: next.1)
        XCTAssertEqual(saved.document.path, moved)
        XCTAssertTrue(saved.checkpoint.pending)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        let reopened = try await restarted.beginSharedEditing(itemId: itemId, path: moved, expectedHash: saved.document.hash)
        XCTAssertEqual(reopened.checkpoint?.journalGeneration, 2)
        XCTAssertTrue(reopened.checkpoint?.pending == true)
        XCTAssertEqual(reopened.document.contents.markdown, next.0)
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

        let protected = try await engine.sync()
        XCTAssertEqual(protected.uploaded, 0)
        XCTAssertTrue(protected.conflicts.isEmpty)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId)
        let report = try await engine.sync()
        XCTAssertTrue(report.conflicts.isEmpty)
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertEqual(try store.read(path: path).hash, edited.hash)
        let uploaded = await transport.uploadedBodies()
        XCTAssertTrue(uploaded.contains { $0.0 == itemId && $0.1 == edited.hash })
        let idle = try await engine.sync()
        XCTAssertEqual(idle.uploaded, 0)
        XCTAssertTrue(idle.conflicts.isEmpty)
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
        var reordered = materialized.checkpoint
        let journalObject = try JSONSerialization.jsonObject(with: Data(reordered.journal.utf8))
        reordered.journal = String(decoding: try JSONSerialization.data(withJSONObject: journalObject, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)
        let replayed = try store.materialize(checkpoint: reordered, expectedHash: materialized.document.hash, markdown: change.0, documentJSON: change.1)
        XCTAssertEqual(replayed.document.hash, materialized.document.hash)
        XCTAssertEqual(replayed.checkpoint.journalGeneration, materialized.checkpoint.journalGeneration)
        XCTAssertEqual(replayed.checkpoint.journal, materialized.checkpoint.journal)
        var stale = target; stale.journalGeneration = 2
        XCTAssertThrowsError(try store.materialize(checkpoint: stale, expectedHash: materialized.document.hash, markdown: change.0, documentJSON: change.1))
        stale.journalGeneration = 3; stale.journal = stale.journal.replacingOccurrences(of: "AQ==", with: "Ag==")
        XCTAssertThrowsError(try store.materialize(checkpoint: stale, expectedHash: materialized.document.hash, markdown: change.0, documentJSON: change.1))
    }
    // MARK: Authorized epoch adoption
    private let operationId = "op-1111-2222"
    private func epochCheckpoint(_ projectedHash: String, revision: String, epoch: Int, generation: UInt64, pending: Bool = true,
                                 recovery: [String: Any]? = nil) throws -> LocalVaultSharedCheckpoint {
        var journal: [String: Any] = ["version": 1, "journalGeneration": generation, "epoch": epoch, "seq": 0, "revision": revision, "relativePath": path,
            "update": "AQ==", "pending": pending ? ["AQ=="] : [], "batch": NSNull()]
        if let recovery { journal["recovery"] = recovery }
        return LocalVaultSharedCheckpoint(itemId: itemId, path: path, projectedHash: projectedHash, acknowledgedRevision: revision,
            epoch: epoch, seq: 0, journalGeneration: generation, journal: String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: pending, retiredReason: nil)
    }
    private func intent(_ overrides: [String: Any] = [:], adopted: Bool? = nil) -> [String: Any] {
        var value: [String: Any] = ["operationId": operationId, "epoch": 1, "update": "AQID"]
        if let adopted { value["adopted"] = adopted }
        for (key, replacement) in overrides { value[key] = replacement }
        return value
    }
    private func sharedDirectory() -> URL {
        LocalVaultDeviceState.directory(root: root.standardizedFileURL.resolvingSymlinksInPath()).appendingPathComponent("shared-editing/\(itemId)")
    }
    private func retainedCheckpoint() throws -> LocalVaultSharedCheckpoint {
        try JSONDecoder().decode(LocalVaultSharedCheckpoint.self, from: Data(contentsOf: sharedDirectory().appendingPathComponent("checkpoint.json")))
    }
    func testPendingJournalAdoptsNewerEpochOnlyWithCheckpointedMatchingIntent() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        let change = try changes(original, body: "Pending")
        let first = try store.materialize(checkpoint: try epochCheckpoint(original.hash, revision: original.hash, epoch: 1, generation: 1),
            expectedHash: original.hash, markdown: change.0, documentJSON: change.1)
        let projected = first.document.hash
        // A later epoch with adoption flags but no checkpointed intent is a server acknowledgement alone.
        XCTAssertThrowsError(try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 2, generation: 2, recovery: intent(adopted: true)),
            expectedHash: projected, markdown: change.0, documentJSON: change.1)) { XCTAssertTrue($0 is LocalVaultSharedFailure, "\($0)") }
        // The intent is checkpointed before the first send; the epoch is still the old one.
        let durable = try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 1, generation: 2, recovery: intent()),
            expectedHash: projected, markdown: change.0, documentJSON: change.1)
        XCTAssertEqual(durable.document.hash, projected)
        let retainedJournal = try retainedCheckpoint().journal
        let rejected: [(String, [String: Any])] = [
            ("different operation", intent(["operationId": "op-other"], adopted: true)),
            ("different recovery epoch", intent(["epoch": 2], adopted: true)),
            ("different recovery bytes", intent(["update": "BAUG"], adopted: true)),
            ("missing adopted flag", intent()),
            ("adopted flag false", intent(adopted: false))]
        for (label, recovery) in rejected {
            XCTAssertThrowsError(try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 2, generation: 3, recovery: recovery),
                expectedHash: projected, markdown: change.0, documentJSON: change.1), label) { error in
                guard case LocalVaultSharedFailure.staleSession = error else { return XCTFail("\(label): \(error)") }
            }
            XCTAssertEqual(try retainedCheckpoint().journal, retainedJournal, label)
            XCTAssertEqual(try retainedCheckpoint().epoch, 1, label)
        }
        // A later epoch without any intent still fails closed, and a regressing epoch never adopts.
        XCTAssertThrowsError(try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 2, generation: 3),
            expectedHash: projected, markdown: change.0, documentJSON: change.1))
        XCTAssertFalse(FileManager.default.fileExists(atPath: sharedDirectory().appendingPathComponent("recovery-\(operationId).json").path))
        // The exact persisted intent, marked adopted, moves the journal to the newer epoch.
        let late = try changes(first.document, body: "Pending\nTyped during recovery")
        let adopted = try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 2, generation: 3, recovery: intent(adopted: true)),
            expectedHash: projected, markdown: late.0, documentJSON: late.1)
        XCTAssertEqual(adopted.checkpoint.epoch, 2)
        XCTAssertTrue(adopted.document.contents.markdown.contains("Typed during recovery"))
        let archive = try JSONDecoder().decode(LocalVaultSharedCheckpoint.self, from: Data(contentsOf: sharedDirectory().appendingPathComponent("recovery-\(operationId).json")))
        XCTAssertEqual(archive.journal, retainedJournal)
        XCTAssertEqual(archive.epoch, 1)
        XCTAssertEqual(archive.projectedHash, projected)
        // Late updates continue in the new epoch; the cleared intent and the adopted
        // journal survive a native encode/decode cycle and a restart unchanged.
        let next = try store.materialize(checkpoint: try epochCheckpoint(adopted.document.hash, revision: original.hash, epoch: 2, generation: 4),
            expectedHash: adopted.document.hash, markdown: late.0, documentJSON: late.1)
        XCTAssertEqual(next.checkpoint.epoch, 2)
        let restarted = try XCTUnwrap(try LocalVaultSharedEditingStore(root: root).checkpoint(itemId: itemId))
        XCTAssertEqual(restarted.journal, next.checkpoint.journal)
        XCTAssertEqual(restarted.epoch, 2)
        XCTAssertNil(restarted.retiredReason)
        XCTAssertThrowsError(try store.materialize(checkpoint: try epochCheckpoint(next.document.hash, revision: original.hash, epoch: 1, generation: 5),
            expectedHash: next.document.hash, markdown: late.0, documentJSON: late.1))
    }
    func testEpochAdoptionJournalSchemaIsValidatedAndOldJournalsRemainValid() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root)
        let change = try changes(original, body: "Pending")
        let legacy = try checkpoint(original)
        XCTAssertFalse(legacy.journal.contains("recovery"))
        let saved = try store.materialize(checkpoint: legacy, expectedHash: original.hash, markdown: change.0, documentJSON: change.1)
        let projected = saved.document.hash
        for (label, recovery) in [("unknown field", intent(["extra": 1])), ("bad operation id", intent(["operationId": "../x"])),
                                  ("boolean epoch", intent(["epoch": true])), ("future epoch", intent(["epoch": 2])),
                                  ("empty update", intent(["update": ""])), ("non base64 update", intent(["update": "***"])),
                                  ("string adopted", intent(["adopted": "yes"]))] as [(String, [String: Any])] {
            XCTAssertThrowsError(try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 1, generation: 2, recovery: recovery),
                expectedHash: projected, markdown: change.0, documentJSON: change.1), label) { error in
                guard case LocalVaultSharedFailure.invalid = error else { return XCTFail("\(label): \(error)") }
            }
            XCTAssertEqual(try retainedCheckpoint().journal, legacy.journal, label)
        }
        let durable = try store.materialize(checkpoint: try epochCheckpoint(projected, revision: original.hash, epoch: 1, generation: 2, recovery: intent()),
            expectedHash: projected, markdown: change.0, documentJSON: change.1)
        let reread = try XCTUnwrap(try LocalVaultSharedEditingStore(root: root).checkpoint(itemId: itemId))
        XCTAssertEqual(reread.journal, durable.checkpoint.journal)
        let intentObject = try XCTUnwrap((try JSONSerialization.jsonObject(with: Data(reread.journal.utf8)) as? [String: Any])?["recovery"] as? [String: Any])
        XCTAssertEqual(intentObject["operationId"] as? String, operationId)
        XCTAssertEqual(intentObject["update"] as? String, "AQID")
    }
    func testEpochAdoptionCrashAfterArchiveReplaysAndFailedCheckpointKeepsPriorIntact() throws {
        let original = try fixture(), store = LocalVaultSharedEditingStore(root: root), files = LocalVaultDocumentStore(root: root)
        let change = try changes(original, body: "Pending")
        let first = try store.materialize(checkpoint: try epochCheckpoint(original.hash, revision: original.hash, epoch: 1, generation: 1, recovery: intent()),
            expectedHash: original.hash, markdown: change.0, documentJSON: change.1)
        let projected = first.document.hash, retainedJournal = try retainedCheckpoint().journal
        let adoption = try epochCheckpoint(projected, revision: original.hash, epoch: 2, generation: 2, recovery: intent(adopted: true))
        // A stale file revision fails the CAS before the archive or any intent is written.
        XCTAssertThrowsError(try store.materialize(checkpoint: adoption, expectedHash: original.hash, markdown: change.0, documentJSON: change.1))
        XCTAssertFalse(FileManager.default.fileExists(atPath: sharedDirectory().appendingPathComponent("recovery-\(operationId).json").path))
        XCTAssertEqual(try retainedCheckpoint().journal, retainedJournal)
        // An external edit after the intent means the current file is no longer the projection: no adoption, prior intact.
        let external = try changes(first.document, body: "Pending\nExternal")
        let changed = try files.write(path: path, expectedHash: projected, markdown: external.0, documentJSON: external.1,
            templateJSON: original.contents.templateJSON, templateAuthoringSourceJSON: nil)
        XCTAssertThrowsError(try store.materialize(checkpoint: adoption, expectedHash: changed.hash, markdown: external.0, documentJSON: external.1)) { error in
            guard case LocalVaultSharedFailure.staleSession = error else { return XCTFail("\(error)") }
        }
        XCTAssertEqual(try retainedCheckpoint().journal, retainedJournal)
        XCTAssertFalse(FileManager.default.fileExists(atPath: sharedDirectory().appendingPathComponent("recovery-\(operationId).json").path))
        // Reconcile the external edit in the old epoch first, then adopt with a crash after the durable intent.
        let reconciled = try store.materialize(checkpoint: try epochCheckpoint(changed.hash, revision: original.hash, epoch: 1, generation: 2, recovery: intent()),
            expectedHash: changed.hash, markdown: external.0, documentJSON: external.1)
        let before = try retainedCheckpoint().journal
        let crashing = try epochCheckpoint(reconciled.document.hash, revision: original.hash, epoch: 2, generation: 3, recovery: intent(adopted: true))
        XCTAssertThrowsError(try store.materialize(checkpoint: crashing, expectedHash: reconciled.document.hash, markdown: external.0, documentJSON: external.1, interruptAfterIntent: true))
        let archive = try JSONDecoder().decode(LocalVaultSharedCheckpoint.self, from: Data(contentsOf: sharedDirectory().appendingPathComponent("recovery-\(operationId).json")))
        XCTAssertEqual(archive.journal, before)
        XCTAssertEqual(try retainedCheckpoint().epoch, 1, "The prior checkpoint stays until the intent finishes")
        let replayed = try XCTUnwrap(try LocalVaultSharedEditingStore(root: root).checkpoint(itemId: itemId))
        XCTAssertEqual(replayed.epoch, 2)
        XCTAssertEqual(replayed.journal, crashing.journal)
        XCTAssertNil(replayed.retiredReason)
        XCTAssertTrue(FileManager.default.fileExists(atPath: sharedDirectory().appendingPathComponent("recovery-\(operationId).json").path))
    }
    func testEpochAdoptionRequiresLiveSessionUnretiredJournalAndPresentFile() async throws {
        let original = try fixture(), transport = SharedTransport()
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        let change = try changes(original, body: "Pending")
        let durable = try epochCheckpoint(original.hash, revision: original.hash, epoch: 1, generation: 1, recovery: intent())
        let first = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: itemId, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: durable.journal, pending: true, markdown: change.0, documentJSON: change.1)
        let projected = first.document.hash
        let adoption = try epochCheckpoint(projected, revision: original.hash, epoch: 2, generation: 2, recovery: intent(adopted: true))
        func adopt(_ engine: LocalVaultSync, token: String, expectedHash: String = projected) async throws {
            _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: itemId, expectedHash: expectedHash,
                epoch: 2, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 2, journal: adoption.journal, pending: true, markdown: change.0, documentJSON: change.1)
        }
        do { try await adopt(engine, token: "revoked"); XCTFail("A revoked session adopted an epoch") } catch LocalVaultSharedFailure.staleSession { }
        XCTAssertEqual(try retainedCheckpoint().epoch, 1)
        // A session that lost its lease after a restart cannot adopt either.
        let restarted = try LocalVaultSync(root: root, binding: binding, transport: transport)
        do { try await adopt(restarted, token: session.sessionToken); XCTFail("A stale token adopted after restart") } catch LocalVaultSharedFailure.staleSession { }
        // A retired journal keeps its old epoch even for a matching intent.
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: itemId, retiredReason: "Editing access was removed.")
        let reopened = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: projected)
        XCTAssertNotNil(reopened.checkpoint?.retiredReason)
        do { try await adopt(engine, token: reopened.sessionToken); XCTFail("A retired journal adopted an epoch") } catch LocalVaultSharedFailure.staleSession { }
        XCTAssertEqual(try retainedCheckpoint().epoch, 1)
        XCTAssertEqual(try retainedCheckpoint().journal, durable.journal)
        // A deleted file cannot adopt; the retained journal is untouched.
        try FileManager.default.removeItem(at: root.appendingPathComponent(path))
        do { try await adopt(engine, token: reopened.sessionToken); XCTFail("A deleted file adopted an epoch") } catch { }
        XCTAssertEqual(try retainedCheckpoint().journal, durable.journal)
        XCTAssertFalse(FileManager.default.fileExists(atPath: sharedDirectory().appendingPathComponent("recovery-\(operationId).json").path))
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
    var renamed: [(String, String)] = [], organize = true, renameFailures: [Error] = []
    func remotePath(_ itemId: String) -> String? { items[itemId]?.relativePath }
    func renames() -> [String] { renamed.map { "\($0.0)->\($0.1)" } }
    func setOrganize(_ value: Bool) { organize = value }
    func failNextRename(_ error: Error) { renameFailures.append(error) }
    func canOrganize() async -> Bool { organize }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String {
        if !renameFailures.isEmpty { throw renameFailures.removeFirst() }
        guard let item = items[itemId], item.relativePath == from, item.revision == baseRevision else { throw LocalVaultSyncFailure.invalidResponse }
        renamed.append((from, to))
        items[itemId] = LocalVaultRemoteItem(itemId: itemId, relativePath: to, revision: item.revision)
        return item.revision
    }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { items.removeValue(forKey: itemId); bytes.removeValue(forKey: itemId) }
}
