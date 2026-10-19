import Foundation
import XCTest
import TextTextSyncTestSupport
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class OldMacRenameCompatibilityTests: XCTestCase {
    func testHeldWriterAndIdleReloadRefuseWithoutMutating() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_OLD_MAC_COMPAT"] == "1" else { throw XCTSkip("Separate explicit frozen-old-executable compatibility gate required") }
        let env = ProcessInfo.processInfo.environment
        let bundle = URL(fileURLWithPath: try XCTUnwrap(env["TEXTTEXT_OLD_MAC_BUNDLE"]))
        let binary = bundle.appendingPathComponent("Contents/MacOS/TextTextFileProviderKitTests")
        let expectedOldHash = try XCTUnwrap(env["TEXTTEXT_OLD_MAC_BINARY_SHA256"])
        guard expectedOldHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              TextTextStableDigest.sha256Hex(try Data(contentsOf: binary)) == expectedOldHash else { throw LocalVaultSyncFailure.changed }
        let control = env["TEXTTEXT_OLD_MAC_EVIDENCE"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("old-mac-compat-" + UUID().uuidString)
        let temp = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().path + "/"
        guard control.path.hasPrefix(temp) || control.path.hasPrefix("/private/tmp/texttext-old-mac-") else { throw LocalVaultSyncFailure.invalidResponse }
        guard control.standardizedFileURL.resolvingSymlinksInPath().path == control.path,
              !FileManager.default.fileExists(atPath: control.path) else { throw LocalVaultSyncFailure.changed }
        try FileManager.default.createDirectory(at: control, withIntermediateDirectories: true)
        let root = control.appendingPathComponent("vault"), device = control.appendingPathComponent("device")
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(device)
        defer { _ = LocalVaultDeviceState.exchangeConfiguredBase(previous) }
        var processes: [Process] = []
        func signal(_ name: String) throws { let url = control.appendingPathComponent(name); if !FileManager.default.fileExists(atPath: url.path) { try Data().write(to: url, options: .withoutOverwriting) } }
        defer { try? signal("held-release"); try? signal("idle-go"); try? signal("idle-sync-go") }
        func launch(_ mode: String) throws -> Process {
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
            p.arguments = ["xctest", "-XCTest", "TextTextFileProviderKitTests.OldMacRenameProcessFixture/testExplicitOldProcess", bundle.path]
            // Do not forward credentials, current-framework overrides or test
            // configuration to the independently pinned old process.
            p.environment = Dictionary(uniqueKeysWithValues: ["PATH", "HOME", "TMPDIR", "LANG", "DEVELOPER_DIR"].compactMap { k in env[k].map { (k, $0) } })
            p.environment?["OLD_MAC_CONTROL"] = control.path; p.environment?["OLD_MAC_MODE"] = mode; p.environment?["TEXTTEXT_STORE"] = "1"
            let log = control.appendingPathComponent(mode + ".log"); FileManager.default.createFile(atPath: log.path, contents: Data())
            let handle = try FileHandle(forWritingTo: log); p.standardOutput = handle; p.standardError = handle
            try p.run(); processes.append(p); return p
        }
        func wait(_ name: String, process: Process) async throws {
            let end = Date().addingTimeInterval(90)
            while !FileManager.default.fileExists(atPath: control.appendingPathComponent(name).path) {
                guard process.isRunning, Date() < end else { XCTFail("Old process did not reach \(name); retained \(control.path)"); throw LocalVaultSyncFailure.changed }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
        }
        func exit(_ p: Process) async throws {
            let end = Date().addingTimeInterval(20)
            while p.isRunning { guard Date() < end else { throw LocalVaultSyncFailure.busy }; try await Task.sleep(nanoseconds: 20_000_000) }
            XCTAssertEqual(p.terminationReason, .exit); XCTAssertEqual(p.terminationStatus, 0)
        }
        func inventory(_ label: String) throws -> [String: String] {
            var result: [String: String] = [:]
            for (base, url) in [("vault", root), ("device", device)] {
                if let e = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey]) {
                    for case let file as URL in e where try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
                        result[base + "/" + String(file.path.dropFirst(url.path.count + 1))] = TextTextStableDigest.sha256Hex(try Data(contentsOf: file))
                    }
                }
            }
            try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]).write(to: control.appendingPathComponent(label + ".json"), options: .withoutOverwriting)
            return result
        }
        func state() throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json"))) as? [String: Any]) }
        func saved(_ id: String) throws -> Data { try JSONSerialization.data(withJSONObject: XCTUnwrap((try state()["sharedRenames"] as? [String: Any])?[id]), options: [.sortedKeys]) }
        func floor() throws -> Int { let d = try Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json")); return try XCTUnwrap((JSONSerialization.jsonObject(with: d) as? [String: Any])?["version"] as? Int) }

        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let transport = CurrentMacCompatibilityTransport()
        let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: "account-a")
        let id = "b4e5658d-8848-477c-95a2-851922319b32", source = "Notes/Fresh.textpack", destination = "Notes/Fresh moved.textpack"
        let doc = try BuiltinTextPackDocument.create(title: "Fresh", body: "Fresh immutable item")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Fresh\n---\n\nFresh immutable item", documentJSON: doc.documentJSON, templateJSON: doc.templateJSON, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pack, to: root.appendingPathComponent(source)); try FileManager.default.removeItem(at: pack)
        _ = try await engine.sync(); _ = try await engine.sync()
        let original = try LocalVaultDocumentStore(root: root).read(path: source)
        let session = try await engine.beginSharedEditing(itemId: id, path: source, expectedHash: original.hash)
        try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination))
        let journal: [String: Any] = ["version": 1, "journalGeneration": 1, "accountId": "account-a", "epoch": 1, "seq": 0, "revision": original.hash, "relativePath": destination, "update": "AQ==", "pending": [], "batch": NSNull()]
        _ = try await engine.materializeSharedEditing(sessionToken: session.sessionToken, itemId: id, expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: false, markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: id)
        let debt = try XCTUnwrap((try state()["baselines"] as? [String: [String: Any]])?[id])
        XCTAssertEqual(debt["path"] as? String, source)
        let readyCheckpoint = try await engine.readSharedCheckpoint(itemId: id)
        XCTAssertNotNil(readyCheckpoint); XCTAssertEqual(readyCheckpoint?.pending, false); XCTAssertEqual(readyCheckpoint?.path, destination); XCTAssertNil(readyCheckpoint?.retiredReason)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path))
        let held = try launch("held"); try await wait("held-request.json", process: held)
        XCTAssertEqual(try floor(), 5)
        let oldId = "e1111111-1111-4111-8111-111111111111", immutableOld = try saved(oldId)
        let oldFields = try XCTUnwrap(JSONSerialization.jsonObject(with: immutableOld) as? [String: Any])
        let oldCommand = try JSONSerialization.data(withJSONObject: XCTUnwrap(oldFields["request"]), options: [.sortedKeys])
        let actualRPC = try JSONSerialization.jsonObject(with: Data(contentsOf: control.appendingPathComponent("held-request.json")))
        XCTAssertEqual(oldCommand, try JSONSerialization.data(withJSONObject: actualRPC, options: [.sortedKeys]))
        let heldBefore = try inventory("held-before")
        let callsBeforeContention = await transport.calls
        do { _ = try await engine.sync(); XCTFail("Current writer entered held old workspace") }
        catch LocalVaultSyncFailure.busy {}
        catch { XCTFail("Unexpected contention error: \(type(of: error))"); throw error }
        XCTAssertEqual(try inventory("held-after"), heldBefore); XCTAssertEqual(try floor(), 5)
        let requestsWhileHeld = await transport.requests; XCTAssertTrue(requestsWhileHeld.isEmpty)
        let callsAfterContention = await transport.calls; XCTAssertEqual(callsAfterContention, callsBeforeContention)
        try signal("held-release"); try await wait("held-exited.json", process: held); try await exit(held)
        XCTAssertEqual(try saved(oldId), immutableOld)
        let idle = try launch("idle"); try await wait("idle-ready.json", process: idle)
        XCTAssertEqual(try floor(), 5)
        let oldPack = try LocalVaultDocumentStore(root: root).read(path: "Notes/Moved.textpack")
        await transport.seedOld(id: oldId, data: try Data(contentsOf: root.appendingPathComponent("Notes/Moved.textpack")), revision: oldPack.hash)
        let published = try await engine.sync(); XCTAssertFalse(published.errors.isEmpty)
        XCTAssertEqual(try floor(), 6); XCTAssertEqual(try saved(oldId), immutableOld)
        let requestsAfter = await transport.requests; XCTAssertTrue(requestsAfter.contains { $0.itemId == id && $0.source == source && $0.destination == destination })
        let newRecord = try saved(id), fields = try XCTUnwrap(JSONSerialization.jsonObject(with: newRecord) as? [String: Any])
        XCTAssertEqual(fields["version"] as? Int, 2); XCTAssertEqual((fields["generation"] as? [String: String])?["kind"], "observed-absent")
        let dispatched = try XCTUnwrap(requestsAfter.first { $0.itemId == id })
        XCTAssertEqual((fields["request"] as? [String: Any])?["operationId"] as? String, dispatched.operationId)
        XCTAssertNotEqual((oldFields["request"] as? [String: Any])?["operationId"] as? String, dispatched.operationId)
        let beforeIdle = try inventory("idle-before")
        try signal("idle-go"); try await wait("write-result.json", process: idle)
        XCTAssertEqual(try inventory("write-after"), beforeIdle)
        let writeResult = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: control.appendingPathComponent("write-result.json"))) as? [String: Any])
        XCTAssertEqual(writeResult["refused"] as? Bool, true)
        try signal("idle-sync-go"); try await wait("idle-result.json", process: idle); try await exit(idle)
        XCTAssertEqual(try inventory("idle-after"), beforeIdle)
        XCTAssertEqual(try saved(id), newRecord); XCTAssertEqual(try saved(oldId), immutableOld)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: control.appendingPathComponent("idle-result.json"))) as? [String: Any])
        XCTAssertEqual(result["refused"] as? Bool, true); XCTAssertEqual(result["manifestCalls"] as? Int, 0); XCTAssertEqual(result["renameCalls"] as? Int, 0)
        let restart = try launch("restart"); try await wait("restart-result.json", process: restart); try await exit(restart)
        XCTAssertEqual(try inventory("restart-after"), beforeIdle)
        let restartResult = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: control.appendingPathComponent("restart-result.json"))) as? [String: Any])
        XCTAssertEqual(restartResult["refused"] as? Bool, true); XCTAssertEqual(restartResult["manifestCalls"] as? Int, 0); XCTAssertEqual(restartResult["renameCalls"] as? Int, 0)
        guard testRun?.failureCount == 0 else { throw LocalVaultSyncFailure.changed }
        try JSONSerialization.data(withJSONObject: ["passed": true, "oldBinarySha256": TextTextStableDigest.sha256Hex(Data(contentsOf: binary)), "oldSource": "4fdddd4ad9d854f1523c16ca1836e92d17e3b501", "heldFloor": 5, "publishedFloor": 6, "inventoriesExact": true, "absenceNamingDebtReadyBeforeOldHeld": true], options: [.sortedKeys]).write(to: control.appendingPathComponent("result.json"), options: .withoutOverwriting)
    }
}
private actor CurrentMacCompatibilityTransport: LocalVaultSyncTransport {
    nonisolated let protectedRenameBinding: LocalVaultProtectedRenameScope? = .init(origin: "https://texttext.test", workspaceId: "workspace", accountId: "account-a")
    var items: [String: LocalVaultRemoteItem] = [:], packs: [String: Data] = [:], calls = 0
    var requests: [LocalVaultProtectedRenameRequest] = []
    func seedOld(id: String, data: Data, revision: String) { packs[id] = data; items[id] = .init(itemId: id, relativePath: "Notes/Note.textpack", revision: revision, canEditContent: true, lifecycle: "owned-generation") }
    func manifest() async throws -> [LocalVaultRemoteItem] { calls += 1; return Array(items.values) }
    func generationEvidence(itemId: String) async throws -> LocalVaultManifestGenerationEvidence? { guard let item = items[itemId] else { return nil }; return .init(scope: protectedRenameBinding!, item: item, manifestHash: String(repeating: "a", count: 64), generation: item.lifecycle.map(LocalVaultGeneration.present) ?? .observedAbsent) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { let item = items[itemId]!; return .init(data: packs[itemId]!, relativePath: item.relativePath, revision: item.revision) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { let revision = TextTextStableDigest.sha256Hex(data); packs[itemId] = data; items[itemId] = .init(itemId: itemId, relativePath: path, revision: revision, canEditContent: true); return revision }
    func protectedRename(_ request: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt { calls += 1; requests.append(request); throw LocalVaultSyncFailure.httpStatus(503) }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
