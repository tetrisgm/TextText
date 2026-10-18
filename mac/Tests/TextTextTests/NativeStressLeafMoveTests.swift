#if TEXTTEXT_STRESS_ACTOR
import AppKit
import CryptoKit
import XCTest
import TextTextSyncTestSupport
import TextTextFileProviderKit
@testable import TextTextApp

final class NativeStressLeafMoveTests: XCTestCase {
    private func scenario(_ source: String, _ destination: String) throws -> NativeStressLeafMove.Scenario {
        try JSONDecoder().decode(NativeStressLeafMove.Scenario.self, from: JSONSerialization.data(withJSONObject: ["role": "mac-cli", "round": 1, "source": source, "destination": destination]))
    }
    private func fixture() throws -> (URL, String, String, String, String) {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent("actor-leaf-" + UUID().uuidString).resolvingSymlinksInPath()
        let parent = "Six-client acceptance folder " + UUID().uuidString.lowercased(), title = "Six-client acceptance original", item = UUID().uuidString.lowercased()
        try fm.createDirectory(at: root.appendingPathComponent(parent), withIntermediateDirectories: true)
        let staging = fm.temporaryDirectory.appendingPathComponent("actor-leaf-pack-" + UUID().uuidString)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: staging) }
        let document = try BuiltinTextPackDocument.create(title: title, body: "Original / 漢字")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(item)\"\ntitle: \"\(title)\"\n---\n\nOriginal / 漢字", documentJSON: document.documentJSON,
            templateJSON: document.templateJSON, assets: [.init(filename: "picture.bin", data: Data([0, 255, 31, 128]), remoteURL: "assets/picture.bin")], sourceURL: nil, in: staging)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: staging)
        let source = parent + "/" + title + ".textpack", destination = parent + "/Six-client acceptance moved.textpack"
        try fm.copyItem(at: pack, to: root.appendingPathComponent(source))
        return (root, source, destination, title, item)
    }
    func testReadonlyLeafProofRetainsOriginalTitleArchiveAssetsAndRealPendingPath() throws {
        let (root, source, destination, title, item) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let config = try scenario(source, destination), raw = try JSONSerialization.jsonObject(with: JSONEncoderForScenario(config))
        func inspect(_ phase: String, _ selected: String) throws -> (proof: [String: Any], pending: Bool) {
            try NativeStressLeafMove.observe(root: root, workspaceId: "workspace", itemId: item, title: title, relativePath: source, configured: config,
                selectedItemId: item, selectedPath: selected, request: ["version": 1, "operationId": "lm-" + String(repeating: "a", count: 32), "phase": phase, "scenario": raw])
        }
        let before = try inspect("before", source)
        XCTAssertFalse(before.pending); XCTAssertTrue(try inspect("after", source).pending)
        try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination))
        let catchingUp = try inspect("after", source)
        XCTAssertTrue(catchingUp.pending); XCTAssertEqual(catchingUp.proof["relativePath"] as? String, destination)
        XCTAssertEqual(catchingUp.proof["selectedPath"] as? String, source, "Actual stale session path must not be replaced by the disk path")
        let after = try inspect("after", destination)
        XCTAssertFalse(after.pending)
        for key in ["archiveSha256", "documentSha256", "fileIdentity"] { XCTAssertEqual(before.proof[key] as? String, after.proof[key] as? String) }
        XCTAssertEqual(before.proof["assetHashes"] as? [String: String], after.proof["assetHashes"] as? [String: String])
        XCTAssertEqual((after.proof["assetHashes"] as? [String: String])?.keys.sorted(), ["assets/picture.bin"])
        XCTAssertTrue(config.qualifies(title: title, relativePath: destination), "Independent reopen binds unchanged original title to only its declared destination")
        XCTAssertFalse(config.qualifies(title: "Six-client acceptance moved", relativePath: destination))
        XCTAssertFalse(config.qualifies(title: title, relativePath: "Elsewhere/" + title + ".textpack"))
        let duplicate = root.appendingPathComponent("Other.textpack")
        try FileManager.default.copyItem(at: root.appendingPathComponent(destination), to: duplicate)
        XCTAssertThrowsError(try inspect("after", destination), "A duplicate outside the dedicated parent must refuse the proof")
        try FileManager.default.removeItem(at: duplicate)
        try Data("foreign bytes preserved".utf8).write(to: root.appendingPathComponent(source))
        XCTAssertThrowsError(try inspect("after", destination))
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent(source), encoding: .utf8), "foreign bytes preserved")
    }
    private func JSONEncoderForScenario(_ s: NativeStressLeafMove.Scenario) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["role": s.role, "round": s.round, "source": s.source, "destination": s.destination])
    }
    func testUnknownFutureAliasForeignAndUnqualifiedObservationsRefuse() throws {
        let (root, source, destination, title, item) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let config = try scenario(source, destination), raw = try JSONSerialization.jsonObject(with: JSONEncoderForScenario(config))
        let request: [String: Any] = ["version": 1, "operationId": "lm-" + String(repeating: "b", count: 32), "phase": "before", "scenario": raw]
        func inspect(_ r: [String: Any], _ configured: NativeStressLeafMove.Scenario? = nil, _ selectedItem: String? = nil, _ selectedPath: String? = nil) throws {
            _ = try NativeStressLeafMove.observe(root: root, workspaceId: "workspace", itemId: item, title: title, relativePath: source, configured: configured,
                selectedItemId: selectedItem ?? item, selectedPath: selectedPath ?? source, request: r)
        }
        XCTAssertThrowsError(try inspect(request))
        XCTAssertThrowsError(try inspect(request, config, "foreign-item"))
        XCTAssertThrowsError(try inspect(request, config, nil, "foreign/path.textpack"))
        var unknown = request; unknown["future"] = true; XCTAssertThrowsError(try inspect(unknown, config))
        var future = request; future["version"] = 2; XCTAssertThrowsError(try inspect(future, config))
        var boolean = request; boolean["version"] = true; XCTAssertThrowsError(try inspect(boolean, config))
        XCTAssertThrowsError(try scenario(source, source.lowercased()))
        var rawUnknown = raw as! [String: Any]; rawUnknown["future"] = true
        XCTAssertThrowsError(try JSONDecoder().decode(NativeStressLeafMove.Scenario.self, from: JSONSerialization.data(withJSONObject: rawUnknown)))
        let alias = root.appendingPathComponent(destination)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: root.appendingPathComponent(source))
        XCTAssertThrowsError(try inspect(request, config))
    }
    func testCanonicalDocumentMatchesCoordinatorECMAScriptSerialization() throws {
        let raw = Data(#"{"z":0.0000001,"content":{"title":"Original / 漢字","10":10,"2":2,"a10":true,"a2":null},"schemaVersion":1}"#.utf8)
        let expected = #"{"content":{"2":2,"10":10,"a10":true,"a2":null,"title":"Original / 漢字"},"schemaVersion":1,"z":1e-7}"#
        XCTAssertEqual(String(decoding: try NativeStressLeafMove.canonicalDocument(raw), as: UTF8.self), expected)
    }
    func testSnapshotSchemaMustBeNumericOne() throws {
        func snapshot(_ version: Any) throws -> Data { try JSONSerialization.data(withJSONObject: ["schemaVersion": version, "content": ["title": "Original", "body": "Body"]]) }
        XCTAssertNoThrow(try NativeStressLeafMove.validateSnapshot(snapshot(1), title: "Original"))
        let invalidValues: [Any] = [true, false, 0, 2, 1.5, "1", NSNull()]
        for invalid in invalidValues {
            XCTAssertThrowsError(try NativeStressLeafMove.validateSnapshot(snapshot(invalid), title: "Original"))
        }
        XCTAssertThrowsError(try NativeStressLeafMove.validateSnapshot(snapshot(1), title: "Foreign"))
    }
    @MainActor
    func testActualSharedSessionPathRejectsMissingChangedAndRetiredOwner() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("leaf-session-" + UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace"), item = UUID().uuidString.lowercased(), path = "Original.textpack"
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let document = try BuiltinTextPackDocument.create(title: "Original", body: "Original")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(item)\"\ntitle: Original\n---\n\nOriginal", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
        let engine = try makeTestSync(root: root, binding: binding, transport: LeafTransport(), accountId: "account-a")
        _ = try await engine.sync()
        let original = try LocalVaultDocumentStore(root: root).read(path: path)
        var credential = LocalVaultAccountCredential(origin: binding.origin, token: "fixture-a", accountId: "account-a")
        let relay = LocalVaultCollaboration(verifiedCredentials: { credential }, expectedLifetime: .captured(credential), engine: { engine })
        do { _ = try await relay.stressSharedSessionPath(itemId: item); XCTFail("A disk file alone cannot prove an active editor") } catch { }
        let opened: [String: Any] = try await withCheckedThrowingContinuation { continuation in
            relay.start(id: "open", method: "collaborationOpen", params: ["itemId": item, "path": path, "hash": original.hash], root: root) { continuation.resume(with: $0.map { $0 ?? [:] }) }
        }
        XCTAssertNotNil(opened["sessionToken"])
        let selected = try await relay.stressSharedSessionPath(itemId: item); XCTAssertEqual(selected, path)
        credential = LocalVaultAccountCredential(origin: binding.origin, token: "refreshed-token", accountId: "account-a")
        let refreshed = try await relay.stressSharedSessionPath(itemId: item); XCTAssertEqual(refreshed, path)
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent("Moved.textpack"))
        let notInferred = try await relay.stressSharedSessionPath(itemId: item)
        XCTAssertEqual(notInferred, path, "Read-only inspection must report actual routing, not infer the new disk path")
        credential = LocalVaultAccountCredential(origin: binding.origin, token: "foreign-token", accountId: "account-b")
        do { _ = try await relay.stressSharedSessionPath(itemId: item); XCTFail("Foreign account inspected a retained live path") } catch { }
        credential = LocalVaultAccountCredential(origin: binding.origin, token: "refreshed-token", accountId: "account-a")
        await relay.retireAndWait()
        do { _ = try await relay.stressSharedSessionPath(itemId: item); XCTFail("Retired session exposed a stale path") } catch { }
    }
}
private actor LeafTransport: LocalVaultSyncTransport {
    func manifest() async throws -> [LocalVaultRemoteItem] { [] }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { TextTextStableDigest.sha256Hex(data) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
#endif
