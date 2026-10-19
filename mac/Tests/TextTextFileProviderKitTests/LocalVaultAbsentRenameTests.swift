import XCTest
import ZIPFoundation
import TextTextSyncTestSupport
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultAbsentRenameTests: XCTestCase {
    private var root: URL!, device: URL!, previousBase: URL?
    private let id = "a4e5658d-8848-477c-95a2-851922319b32"
    private let source = "Notes/Original.textpack", destination = "Notes/Moved.textpack"
    private var binding: LocalVaultSyncBinding { get throws { try .init(origin: URL(string: "https://absence.test")!, workspaceId: "workspace") } }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("absence-" + UUID().uuidString)
        device = FileManager.default.temporaryDirectory.appendingPathComponent("absence-device-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        previousBase = LocalVaultDeviceState.exchangeConfiguredBase(device)
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
    }
    override func tearDownWithError() throws {
        _ = LocalVaultDeviceState.exchangeConfiguredBase(previousBase)
        try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: device)
    }
    private func prepare(_ transport: AbsentRenameTransport) async throws -> (LocalVaultSync, String, String) {
        let doc = try BuiltinTextPackDocument.create(title: "Original", body: "Fresh generation fixture")
        let markdown = "---\ntextTextId: \"\(id)\"\ntitle: Original\n---\n\nFresh generation fixture"
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: doc.documentJSON,
            templateJSON: doc.templateJSON, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pack, to: root.appendingPathComponent(source)); try FileManager.default.removeItem(at: pack)
        let original = try LocalVaultDocumentStore(root: root).read(path: source)
        let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        _ = try await engine.sync(); _ = try await engine.sync()
        let session = try await engine.beginSharedEditing(itemId: id, path: source, expectedHash: original.hash)
        try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination))
        let journal: [String: Any] = ["version": 1, "journalGeneration": 1, "accountId": "account-a", "epoch": 1, "seq": 0,
            "revision": original.hash, "relativePath": destination, "update": "AQ==", "pending": [], "batch": NSNull()]
        _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1,
            journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: false,
            markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
        return (engine, session.sessionToken, original.hash)
    }
    private func state() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json"))) as? [String: Any])
    }
    private func retainedInventory() throws -> [String: String] {
        var result: [String: String] = [:]
        for (label, base) in [("vault", root!), ("device", device!)] {
            guard let files = FileManager.default.enumerator(at: base, includingPropertiesForKeys: [.isRegularFileKey]) else { continue }
            for case let file as URL in files {
                guard try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { continue }
                let relative = String(file.path.dropFirst(base.path.count + 1))
                // Per-pass cursor/cache may advance; retained authority and content may not.
                if relative.hasSuffix("sync/state.json") { continue }
                result[label + "/" + relative] = TextTextStableDigest.sha256Hex(try Data(contentsOf: file))
            }
        }
        return result
    }
    func testAbsentNamingDoesNotRepairMismatchedCheckpointPath() async throws {
        let transport = AbsentRenameTransport(), (engine, _, _) = try await prepare(transport)
        let url = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)/checkpoint.json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        object["path"] = source
        try JSONSerialization.data(withJSONObject: object, options: .sortedKeys).write(to: url)
        let before = try retainedInventory()
        _ = try? await engine.sync()
        XCTAssertEqual(try retainedInventory(), before)
        let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
    }
    func testAbsentNamingRetainedIntentAndRegistryRemainByteExact() async throws {
        let transport = AbsentRenameTransport(), (engine, _, _) = try await prepare(transport)
        let state = LocalVaultDeviceState.directory(root: root)
        let intent = state.appendingPathComponent("shared-editing/\(id)/intent.json")
        try Data("{\"version\":1,\"unsafe\":true}".utf8).write(to: intent, options: .withoutOverwriting)
        let registry = state.appendingPathComponent("replacement-index")
        try FileManager.default.createDirectory(at: registry, withIntermediateDirectories: true)
        try Data("{\"version\":1,\"unresolved\":true}".utf8).write(to: registry.appendingPathComponent("unknown.json"), options: .withoutOverwriting)
        let before = try retainedInventory()
        let report = try await engine.sync(); XCTAssertFalse(report.errors.isEmpty)
        XCTAssertEqual(try retainedInventory(), before)
        let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
    }
    func testHeldAbsentItemDoesNotDisableUnrelatedPresentRecovery() async throws {
        let transport = AbsentRenameTransport(), (engine, _, _) = try await prepare(transport)
        let checkpoint = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)/checkpoint.json")
        var cp = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpoint)) as? [String: Any])
        cp["itemId"] = "foreign-checkpoint"; try JSONSerialization.data(withJSONObject: cp).write(to: checkpoint)
        let cpBytes = try Data(contentsOf: checkpoint), original = try Data(contentsOf: root.appendingPathComponent(destination))
        let other = "unrelated-known-item", path = "Notes/Other.textpack", target = root.appendingPathComponent(path)
        let store = LocalVaultDocumentStore(root: root)
        let seed = try store.generationMetadata(path: destination)
        let markdown = seed.contents.markdown.replacingOccurrences(of: id, with: other)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown,
            documentJSON: seed.contents.documentJSON, templateJSON: nil, assets: [], sourceURL: nil, in: root)
        let archive = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        let bytes = try Data(contentsOf: archive); try FileManager.default.removeItem(at: archive)
        try bytes.write(to: target, options: .withoutOverwriting)
        let operation = UUID(), hash = TextTextStableDigest.sha256Hex(bytes), registry = ReplacementRecoveryRegistry(root: root)
        enum Interrupted: Error { case swapped }
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash, prepared: bytes, operation: operation) { phase in
            if phase == "prepared" { try registry.register(operation: operation, itemId: other, path: path, expectedHash: hash, preparedHash: hash) }
            if phase == "swapped" { throw Interrupted.swapped }
        })
        await transport.installKnown(itemId: other, path: path, bytes: bytes)
        _ = try await engine.sync()
        XCTAssertEqual(try Data(contentsOf: checkpoint), cpBytes)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), original)
        let entry = try XCTUnwrap(registry.entries(itemId: other).first)
        let retained = try RetainedFileReplacement.recovery(target: target, operation: entry.operation)
        XCTAssertEqual(retained.record.state, .completed)
        let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
    }
    func testAbsentNamingUnknownItemEntryRemainsByteExact() async throws { try await retainedEntryRefusal("future-intent.json") }
    func testAbsentNamingOrphanBinaryStageRemainsByteExact() async throws { try await retainedEntryRefusal("binary-next.textpack") }
    private func retainedEntryRefusal(_ name: String) async throws {
        let transport = AbsentRenameTransport(), (engine, _, _) = try await prepare(transport)
        let url = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)/" + name)
        try Data("retained unknown work".utf8).write(to: url, options: .withoutOverwriting)
        let before = try retainedInventory(), report = try await engine.sync()
        XCTAssertFalse(report.errors.isEmpty); XCTAssertEqual(try retainedInventory(), before)
        let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
    }
    func testAbsentNamingKnownInactiveArchivesRemainAvailable() async throws {
        let transport = AbsentRenameTransport(), (engine, token, _) = try await prepare(transport)
        let item = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)")
        let archive = item.appendingPathComponent("archived-" + UUID().uuidString + ".json")
        let bytes = try Data(contentsOf: item.appendingPathComponent("checkpoint.json"))
        try bytes.write(to: archive, options: .withoutOverwriting)
        let report = try await engine.sync(); XCTAssertTrue(report.errors.isEmpty)
        let requests = await transport.requests; XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(try Data(contentsOf: archive), bytes)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testAbsentNamingIgnoresStaleIdentityCacheForProtection() async throws {
        let transport = AbsentRenameTransport(), (engine, token, _) = try await prepare(transport)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        var saved = try state(), identities = try XCTUnwrap(saved["identities"] as? [String: String])
        identities[destination] = "previous-cached-item"; saved["identities"] = identities
        try JSONSerialization.data(withJSONObject: saved, options: .sortedKeys).write(to: stateURL)
        let retained = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)/future-intent.json")
        try Data("do not repair or ignore".utf8).write(to: retained, options: .withoutOverwriting)
        let before = try retainedInventory()
        let restarted = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        let report = try await restarted.sync(); XCTAssertFalse(report.errors.isEmpty)
        XCTAssertEqual(try retainedInventory(), before)
        let requests = await transport.requests; XCTAssertTrue(requests.isEmpty)
    }
    func testMissingTransportBindingDoesNotPublishOrInventNewAbsenceAuthority() async throws {
        let transport = AbsentRenameTransport(binding: nil), (engine, token, _) = try await prepare(transport)
        let profile = LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json")
        let before = FileManager.default.fileExists(atPath: profile.path) ? try Data(contentsOf: profile) : nil
        let report = try await engine.sync(); XCTAssertTrue(report.errors.isEmpty)
        let requests = await transport.requests, evidence = await transport.evidenceCalls
        XCTAssertTrue(requests.isEmpty); XCTAssertEqual(evidence, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        if let before { XCTAssertEqual(try Data(contentsOf: profile), before) }
        else { XCTAssertFalse(FileManager.default.fileExists(atPath: profile.path)) }
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testMissingTransportBindingKeepsVersionTwoRequestAndBytesWithoutDispatch() async throws {
        let transport = AbsentRenameTransport(); await transport.setMode("lost")
        let (engine, token, _) = try await prepare(transport)
        _ = try await engine.sync()
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
        let before = try retainedInventory(), saved = try state()
        let missing = AbsentRenameTransport(binding: nil)
        let restarted = try makeTestSync(root: root, binding: binding, transport: missing, accountId: "account-a")
        let report = try await restarted.sync(); XCTAssertFalse(report.errors.isEmpty)
        let after = try state()
        for name in ["sharedRenames", "baselines"] {
            XCTAssertEqual(try JSONSerialization.data(withJSONObject: XCTUnwrap(saved[name]), options: .sortedKeys),
                try JSONSerialization.data(withJSONObject: XCTUnwrap(after[name]), options: .sortedKeys))
        }
        XCTAssertEqual(try retainedInventory(), before)
        let requests = await missing.requests, evidence = await missing.evidenceCalls
        XCTAssertTrue(requests.isEmpty); XCTAssertEqual(evidence, 0)
    }
    func testMissingBindingPendingGlobalFolderHistoryRefusesWithoutRepair() async throws {
        let transport = AbsentRenameTransport(); await transport.setMode("lost")
        let (engine, token, _) = try await prepare(transport)
        _ = try await engine.sync(); try await engine.endSharedEditing(sessionToken: token, itemId: id)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("CaseFolder"), withIntermediateDirectories: true)
        enum Interrupted: Error { case prepared }
        var reached = false
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "CaseFolder", destinationPath: "casefolder") { phase in
            if phase == "folderPrepared" { reached = true; throw Interrupted.prepared }
        })
        XCTAssertTrue(reached, "The genuine floor6 folder transaction must be pending, not refused before staging")
        let before = try retainedInventory()
        let missing = AbsentRenameTransport(binding: nil)
        let restarted = try makeTestSync(root: root, binding: binding, transport: missing, accountId: "account-a")
        do { _ = try await restarted.sync(); XCTFail("Pending global topology must refuse") } catch {}
        XCTAssertEqual(try retainedInventory(), before)
        let requests = await missing.requests; XCTAssertTrue(requests.isEmpty)
    }
    func testSamePathIdleDoesNotFetchGenerationEvidenceOrFullPack() async throws {
        let transport = AbsentRenameTransport(), (engine, token, _) = try await prepare(transport)
        _ = try await engine.sync()
        let evidence = await transport.evidenceCalls, downloads = await transport.downloadCalls
        _ = try await engine.sync(); _ = try await engine.sync()
        let finalEvidence = await transport.evidenceCalls, finalDownloads = await transport.downloadCalls
        XCTAssertEqual(finalEvidence, evidence); XCTAssertEqual(finalDownloads, downloads)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testLegacyNilWithoutFreshEvidenceRetainsLocalMove() async throws {
        let transport = AbsentRenameTransport(); await transport.setEvidence(false)
        let (engine, token, _) = try await prepare(transport)
        _ = try await engine.sync()
        let calls = await transport.requests; XCTAssertTrue(calls.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        XCTAssertEqual(((try state())["baselines"] as? [String: [String: Any]])?[id]?["path"] as? String, source)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testFreshAbsenceMovesWithoutInventingLifecycleOrContentAcknowledgement() async throws {
        let transport = AbsentRenameTransport(), (engine, token, revision) = try await prepare(transport)
        let before = try LocalVaultDocumentStore(root: root).read(path: destination)
        let report = try await engine.sync(); XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let calls = await transport.requests; XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.source, source); XCTAssertEqual(calls.first?.destination, destination)
        let saved = try state(), baseline = (saved["baselines"] as? [String: [String: Any]])?[id]
        XCTAssertEqual(baseline?["path"] as? String, destination); XCTAssertEqual(baseline?["revision"] as? String, revision)
        XCTAssertEqual(baseline?["localHash"] as? String, before.hash)
        XCTAssertNil((saved["lifecycles"] as? [String: String])?[id])
        let profile = try JSONSerialization.jsonObject(with: Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json"))) as? [String: Any]
        XCTAssertEqual(profile?["version"] as? Int, 6)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testLostReplyRetainsExactVersionTwoRequest() async throws {
        let transport = AbsentRenameTransport(); await transport.setMode("lost")
        let (engine, token, _) = try await prepare(transport)
        let first = try await engine.sync(); XCTAssertFalse(first.errors.isEmpty)
        let saved = try XCTUnwrap(((try state())["sharedRenames"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(saved["version"] as? Int, 2)
        XCTAssertEqual((saved["generation"] as? [String: String])?["kind"], "observed-absent"); XCTAssertNil(saved["lifecycle"])
        await transport.setMode("moved")
        _ = try await engine.sync()
        let calls = await transport.requests; XCTAssertEqual(calls.count, 2); XCTAssertEqual(calls.first, calls.last)
        XCTAssertTrue(((try state())["sharedRenames"] as? [String: Any])?.isEmpty == true)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testRestoreDuringEvidenceAwaitCannotDispatchAbsenceMove() async throws {
        let transport = AbsentRenameTransport(), (engine, token, _) = try await prepare(transport)
        await transport.restoreDuringEvidence()
        _ = try await engine.sync()
        let calls = await transport.requests; XCTAssertTrue(calls.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testRevokedPermissionDuringAbsenceProofRetainsNamingDebt() async throws { try await absenceRefusal("permission") }
    func testForeignManifestScopeCannotCertifyAbsence() async throws { try await absenceRefusal("scope") }
    func testMismatchedDownloadedFullPackCannotCertifyAbsence() async throws { try await absenceRefusal("pack") }
    func testPeerPathChangeDuringFullPackReadCannotRetargetRename() async throws { try await absenceRefusal("path") }
    func testPendingTextDoesNotAdmitReplayOrRecoveryOfAbsentRename() async throws {
        let transport = AbsentRenameTransport(); await transport.setMode("lost")
        let (engine, token, revision) = try await prepare(transport)
        _ = try await engine.sync()
        let retained = try XCTUnwrap(((try state())["sharedRenames"] as? [String: Any])?[id])
        let current = try LocalVaultDocumentStore(root: root).read(path: destination)
        var document = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(current.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(document["content"] as? [String: Any]); content["body"] = "Pending text blocks rename replay"; document["content"] = content
        let journal: [String: Any] = ["version": 1, "journalGeneration": 2, "accountId": "account-a", "epoch": 1, "seq": 0,
            "revision": revision, "relativePath": destination, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
        _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: current.hash,
            epoch: 1, seq: 0, acknowledgedRevision: revision, journalGeneration: 2,
            journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true,
            markdown: current.contents.markdown.replacingOccurrences(of: "Fresh generation fixture", with: "Pending text blocks rename replay"),
            documentJSON: String(decoding: JSONSerialization.data(withJSONObject: document), as: UTF8.self))
        let checkpoint = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)/checkpoint.json")
        let before = try Data(contentsOf: checkpoint)
        _ = try await engine.sync()
        let calls = await transport.requests; XCTAssertEqual(calls.count, 1)
        let list = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(list.entries.first?.id))
        XCTAssertFalse(row.retryAllowed); XCTAssertFalse(row.keepNamesAllowed)
        XCTAssertEqual(try Data(contentsOf: checkpoint), before)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: XCTUnwrap(((try state())["sharedRenames"] as? [String: Any])?[id]), options: .sortedKeys),
            try JSONSerialization.data(withJSONObject: retained, options: .sortedKeys))
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    private func absenceRefusal(_ scenario: String) async throws {
        let transport = AbsentRenameTransport(), (engine, token, _) = try await prepare(transport)
        let before = try Data(contentsOf: root.appendingPathComponent(destination))
        let baseline = try XCTUnwrap(((try state())["baselines"] as? [String: Any])?[id])
        await transport.setProofScenario(scenario)
        _ = try await engine.sync()
        let moves = await transport.requests; XCTAssertTrue(moves.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), before)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: XCTUnwrap(((try state())["baselines"] as? [String: Any])?[id]), options: .sortedKeys),
            try JSONSerialization.data(withJSONObject: baseline, options: .sortedKeys))
        XCTAssertTrue(((try state())["sharedRenames"] as? [String: Any])?.isEmpty != false)
        try await engine.endSharedEditing(sessionToken: token, itemId: id)
    }
    func testStoppedAbsentNamesPermitIndependentAssetCASWhilePendingTextIsRetained() async throws {
        try await stoppedAssetScenario()
    }
    func testStoppedPendingTextDoesNotPermitAssetCASAfterPermissionRevocation() async throws { try await stoppedAssetScenario(blockedBy: "permission") }
    func testStoppedPendingTextDoesNotPermitAssetCASWithLocalMarker() async throws { try await stoppedAssetScenario(blockedBy: "marker") }
    func testStoppedPendingTextDoesNotStageRenameAfterLocalPathChange() async throws { try await stoppedAssetScenario(blockedBy: "path") }
    func testStoppedPendingTextDoesNotRepairForeignCheckpoint() async throws { try await stoppedAssetScenario(blockedBy: "checkpoint") }
    private func stoppedAssetScenario(blockedBy: String? = nil) async throws {
        let transport = AbsentRenameTransport(); await transport.setMode("conflict")
        let (engine, token, revision) = try await prepare(transport)
        _ = try await engine.sync()
        let rows = try await engine.savedFileMoveList(), row = try await engine.savedFileMoveRead(id: XCTUnwrap(rows.entries.first?.id))
        XCTAssertTrue(row.keepNamesAllowed)
        try await engine.keepSavedFileMoveNames(id: row.id, requestHash: XCTUnwrap(row.requestHash), inspection: XCTUnwrap(row.inspection), consent: true)
        let retained = try XCTUnwrap(((try state())["sharedRenames"] as? [String: [String: Any]])?[id])
        let baseline = try XCTUnwrap(((try state())["baselines"] as? [String: [String: Any]])?[id])
        let before = try LocalVaultDocumentStore(root: root).read(path: destination)
        var document = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(before.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(document["content"] as? [String: Any]); content["body"] = "Pending local text C retained"; document["content"] = content
        let asset = Data([3, 0, 255, 7, 11]), assetPath = "assets/pending.bin"
        let archive = try Archive(data: Data(contentsOf: root.appendingPathComponent(destination)), accessMode: .update)
        let assetFile = root.appendingPathComponent("owned-asset-fixture.bin"); try asset.write(to: assetFile)
        defer { try? FileManager.default.removeItem(at: assetFile) }
        try archive.addEntry(with: assetPath, fileURL: assetFile, compressionMethod: .deflate)
        if blockedBy == "marker" {
            let marker = root.appendingPathComponent("owned-marker-fixture.json")
            try Data("{\"version\":1,\"generation\":\"foreign-local-generation\"}".utf8).write(to: marker)
            defer { try? FileManager.default.removeItem(at: marker) }
            try archive.addEntry(with: "texttext-lifecycle.json", fileURL: marker, compressionMethod: .deflate)
        }
        let changed = try XCTUnwrap(archive.data); try changed.write(to: root.appendingPathComponent(destination), options: .atomic)
        let journal: [String: Any] = ["version": 1, "journalGeneration": 2, "accountId": "account-a", "epoch": 1, "seq": 0,
            "revision": revision, "relativePath": destination, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
        _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: TextTextStableDigest.sha256Hex(changed),
            epoch: 1, seq: 0, acknowledgedRevision: revision, journalGeneration: 2,
            journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true,
            markdown: before.contents.markdown.replacingOccurrences(of: "Fresh generation fixture", with: "Pending local text C retained"),
            documentJSON: String(decoding: JSONSerialization.data(withJSONObject: document), as: UTF8.self))
        var currentPath = destination
        if blockedBy == "path" {
            currentPath = "Notes/Deliberate later name.textpack"
            try FileManager.default.moveItem(at: root.appendingPathComponent(destination), to: root.appendingPathComponent(currentPath))
            let current = try LocalVaultDocumentStore(root: root).read(path: currentPath)
            var movedJournal = journal; movedJournal["relativePath"] = currentPath; movedJournal["journalGeneration"] = 3
            _ = try await engine.materializeSharedEditing(sessionToken: token, itemId: id, expectedHash: current.hash,
                epoch: 1, seq: 0, acknowledgedRevision: revision, journalGeneration: 3,
                journal: String(decoding: JSONSerialization.data(withJSONObject: movedJournal), as: UTF8.self), pending: true,
                markdown: current.contents.markdown, documentJSON: XCTUnwrap(current.contents.documentJSON))
        }
        let priorCheckpoint = try await engine.readSharedCheckpoint(itemId: id)
        let pending = try XCTUnwrap(priorCheckpoint), uploads = await transport.uploadCalls
        let pendingReview = try await engine.savedFileMoveRead(id: row.id)
        XCTAssertFalse(pendingReview.retryAllowed); XCTAssertFalse(pendingReview.keepNamesAllowed)
        if blockedBy == "permission" { await transport.setPermission(false) }
        let checkpointURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/\(id)/checkpoint.json")
        if blockedBy == "checkpoint" {
            var foreign = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: checkpointURL)) as? [String: Any])
            foreign["itemId"] = "foreign-fixture-item"
            try JSONSerialization.data(withJSONObject: foreign).write(to: checkpointURL, options: .atomic)
        }
        let checkpointBytes = try Data(contentsOf: checkpointURL)
        do {
            let report = try await engine.sync()
            if blockedBy == nil { XCTAssertTrue(report.errors.isEmpty, "\(report.errors)") }
        } catch { if blockedBy == nil { throw error } }
        let binaryCalls = await transport.binaryCalls; XCTAssertEqual(binaryCalls, blockedBy == nil ? 1 : 0)
        let serverAsset = try? await transport.binaryRead(itemId: id, entryPath: assetPath); XCTAssertEqual(serverAsset, blockedBy == nil ? asset : nil)
        let local = try LocalVaultDocumentStore(root: root).read(path: currentPath); XCTAssertTrue(local.contents.markdown.contains("Pending local text C retained"))
        XCTAssertEqual(try Data(contentsOf: checkpointURL), checkpointBytes)
        if blockedBy != "checkpoint" {
            let finalCheckpoint = try await engine.readSharedCheckpoint(itemId: id)
            let after = try XCTUnwrap(finalCheckpoint)
            XCTAssertTrue(after.pending); XCTAssertEqual(after.journal, pending.journal); XCTAssertEqual(after.acknowledgedRevision, revision)
        }
        let final = try state()
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: XCTUnwrap((final["sharedRenames"] as? [String: Any])?[id]), options: .sortedKeys),
            try JSONSerialization.data(withJSONObject: retained, options: .sortedKeys))
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: XCTUnwrap((final["baselines"] as? [String: Any])?[id]), options: .sortedKeys),
            try JSONSerialization.data(withJSONObject: baseline, options: .sortedKeys))
        let finalUploads = await transport.uploadCalls; XCTAssertEqual(finalUploads, uploads)
        let moves = await transport.requests; XCTAssertEqual(moves.count, 1)
        if blockedBy != "checkpoint" { try await engine.endSharedEditing(sessionToken: token, itemId: id) }
    }
}

private actor AbsentRenameTransport: LocalVaultSyncTransport {
    nonisolated let protectedRenameBinding: LocalVaultProtectedRenameScope?
    init(binding: LocalVaultProtectedRenameScope? = .init(origin: "https://absence.test", workspaceId: "workspace", accountId: "account-a")) { protectedRenameBinding = binding }
    var items: [String: LocalVaultRemoteItem] = [:], packs: [String: Data] = [:]
    var requests: [LocalVaultProtectedRenameRequest] = [], receipts: [String: LocalVaultProtectedRenameReceipt] = [:]
    var evidence = true, restoreNextEvidence = false, mode = "moved", permitted = true
    var uploadCalls = 0, binaryCalls = 0, downloadCalls = 0
    var proofScenario: String?, evidenceCalls = 0
    func installKnown(itemId: String, path: String, bytes: Data) {
        packs[itemId] = bytes
        items[itemId] = .init(itemId: itemId, relativePath: path, revision: TextTextStableDigest.sha256Hex(bytes), canEditContent: true, lifecycle: "known-other", restoreFromRevision: TextTextStableDigest.sha256Hex(bytes))
    }
    func setEvidence(_ value: Bool) { evidence = value }
    func setPermission(_ value: Bool) { permitted = value }
    func setProofScenario(_ value: String) { proofScenario = value; evidenceCalls = 0 }
    func setMode(_ value: String) { mode = value }
    func restoreDuringEvidence() { restoreNextEvidence = true }
    func manifest() async throws -> [LocalVaultRemoteItem] { Array(items.values) }
    func canOrganize() async -> Bool { permitted }
    func canWrite(itemId: String, path: String, existing: Bool) async -> Bool { permitted && (!existing || items[itemId]?.relativePath == path) }
    func generationEvidence(itemId: String) async throws -> LocalVaultManifestGenerationEvidence? {
        evidenceCalls += 1
        if proofScenario == "permission" && evidenceCalls == 2 { permitted = false }
        guard evidence, permitted, let item = items[itemId] else { return nil }
        if restoreNextEvidence {
            restoreNextEvidence = false
            items[itemId] = .init(itemId: item.itemId, relativePath: item.relativePath, revision: item.revision, canEditContent: true,
                lifecycle: "later-restored-generation", restoreFromRevision: item.revision)
        }
        let observed = items[itemId]!
        let scope = proofScenario == "scope" ? LocalVaultProtectedRenameScope(origin: "https://absence.test", workspaceId: "workspace", accountId: "foreign-owner") : protectedRenameBinding!
        return .init(scope: scope, item: observed, manifestHash: String(repeating: "a", count: 64),
            generation: observed.lifecycle.map(LocalVaultGeneration.present) ?? .observedAbsent)
    }
    func download(itemId: String) async throws -> LocalVaultRemotePack {
        downloadCalls += 1
        var item = items[itemId]!
        if proofScenario == "path" {
            item = .init(itemId: item.itemId, relativePath: "Notes/Peer.textpack", revision: item.revision, canEditContent: true)
            items[itemId] = item
        }
        var bytes = packs[itemId]!
        if proofScenario == "pack" { bytes.append(0) }
        return .init(data: bytes, relativePath: item.relativePath, revision: item.revision)
    }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String {
        uploadCalls += 1
        if let item = items[itemId], item.revision != baseRevision { throw LocalVaultSyncFailure.conflict }
        let revision = TextTextStableDigest.sha256Hex(data); packs[itemId] = data
        items[itemId] = .init(itemId: itemId, relativePath: path, revision: revision, canEditContent: true); return revision
    }
    func protectedRename(_ request: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt {
        requests.append(request)
        if let receipt = receipts[request.operationId] { return receipt }
        guard let item = items[request.itemId], item.relativePath == request.source, item.revision == request.baseRevision else { throw LocalVaultSyncFailure.conflict }
        if mode == "conflict" {
            let receipt = LocalVaultProtectedRenameReceipt(request: request, scope: protectedRenameBinding!, status: "conflict", relativePath: item.relativePath, revision: item.revision, deleted: false)
            receipts[request.operationId] = receipt; return receipt
        }
        let receipt = LocalVaultProtectedRenameReceipt(request: request, scope: protectedRenameBinding!, status: "moved", relativePath: request.destination, revision: request.baseRevision, deleted: false)
        items[request.itemId] = .init(itemId: item.itemId, relativePath: request.destination, revision: item.revision, canEditContent: true)
        receipts[request.operationId] = receipt
        if mode == "lost" { throw LocalVaultSyncFailure.httpStatus(503) }
        return receipt
    }
    func binaryManifest(itemId: String) async throws -> LocalVaultBinaryManifest {
        let archive = try Archive(data: packs[itemId]!, accessMode: .read)
        var entries: [LocalVaultBinaryManifest.Entry] = []
        for entry in archive where entry.path.hasPrefix("assets/") && !entry.path.hasSuffix("/") {
            var bytes = Data(); _ = try archive.extract(entry) { bytes.append($0) }
            entries.append(.init(path: entry.path, sha256: TextTextStableDigest.sha256Hex(bytes), size: bytes.count))
        }
        return .init(revision: items[itemId]!.revision, entries: entries)
    }
    func binaryRead(itemId: String, entryPath: String) async throws -> Data {
        let archive = try Archive(data: packs[itemId]!, accessMode: .read)
        guard let entry = archive[entryPath] else { throw LocalVaultSyncFailure.invalidResponse }
        var bytes = Data(); _ = try archive.extract(entry) { bytes.append($0) }; return bytes
    }
    func binaryPatch(itemId: String, operationId: String, entryPath: String, expectedHash: String?, expectedLifecycle: String?, bytes: Data?) async throws -> String {
        binaryCalls += 1
        guard let item = items[itemId], item.lifecycle == expectedLifecycle, permitted else { throw LocalVaultSyncFailure.conflict }
        let archive = try Archive(data: packs[itemId]!, accessMode: .update)
        var old: Data?
        if let entry = archive[entryPath] { var data = Data(); _ = try archive.extract(entry) { data.append($0) }; old = data; try archive.remove(entry) }
        guard old.map(TextTextStableDigest.sha256Hex) == expectedHash else { throw LocalVaultSyncFailure.conflict }
        if let bytes {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try bytes.write(to: file, options: .withoutOverwriting); defer { try? FileManager.default.removeItem(at: file) }
            try archive.addEntry(with: entryPath, fileURL: file, compressionMethod: .deflate)
        }
        let data = try XCTUnwrap(archive.data), revision = TextTextStableDigest.sha256Hex(data)
        packs[itemId] = data; items[itemId] = .init(itemId: itemId, relativePath: item.relativePath, revision: revision, canEditContent: true)
        return revision
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
