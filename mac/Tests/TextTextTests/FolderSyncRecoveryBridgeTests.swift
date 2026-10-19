import AppKit
import Darwin
import WebKit
import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit
@testable import TextTextApp

/// Actual WK message handler and native connection against an owned loopback
/// directory server. Fixture authority is synthetic, not authenticated acceptance.
final class FolderSyncRecoveryBridgeTests: XCTestCase {
    @MainActor
    func testPendingFolderRecoveryBridgeScopesConsentAndPreservesDirectories() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_VAULT_HTTP_TEST"] == "1",
              let bundlePath = ProcessInfo.processInfo.environment["TEXTTEXT_MIRROR_POLICY_BUNDLE"] else {
            throw XCTSkip("Requires explicit loopback and current packaged policy fixture")
        }
        _ = NSApplication.shared
        var repository = URL(fileURLWithPath: #filePath); for _ in 0..<4 { repository.deleteLastPathComponent() }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("folder-sync-wk-" + UUID().uuidString).resolvingSymlinksInPath()
        let root = temporary.appendingPathComponent("Workspace"), serverRoot = temporary.appendingPathComponent("server"), page = temporary.appendingPathComponent("page"), ready = temporary.appendingPathComponent("ready.json")
        for directory in [root, page, serverRoot.appendingPathComponent("contract-workspace/Case/Empty")] { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/env"); process.currentDirectoryURL = repository
        process.arguments = ["node", "--import", "tsx", "scripts/vault-http-test-server.ts", serverRoot.path, ready.path]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() }; try? FileManager.default.removeItem(at: temporary) }
        for _ in 0..<500 { if FileManager.default.fileExists(atPath: ready.path) || !process.isRunning { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        struct Ready: Decodable { let origin: URL }
        let origin = try JSONDecoder().decode(Ready.self, from: Data(contentsOf: ready)), token = "vault-http-fixture"
        func control(_ path: String) async throws {
            var request = URLRequest(url: URL(string: path, relativeTo: origin.origin)!.absoluteURL); request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request); XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
        let binding = try LocalVaultSyncBinding(origin: origin.origin, workspaceId: "contract-workspace"), account = LocalVaultAccountCredential(origin: origin.origin, token: token, accountId: "folder-wk-account")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "folder-wk-account")
        try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
        try await control("__test/folder-case?enabled=1")
        let transport = try HTTPLocalVaultSyncTransport(origin: origin.origin, workspaceId: binding.workspaceId, token: token, accountId: account.accountId)
        let sync = try makeTestSync(root: root, binding: binding, transport: transport, accountId: account.accountId)
        _ = try await sync.sync()
        guard Darwin.rename(root.appendingPathComponent("Case").path, root.appendingPathComponent("CASE").path) == 0 else { throw POSIXError(.init(rawValue: errno)!) }
        try await control("__test/folder-case-race")
        do { _ = try await sync.sync(); XCTFail("Raced catalog must retain pending command") } catch LocalVaultSyncFailure.conflict { }
        let pending = try await sync.folderSyncMoveList(), pendingRow = try XCTUnwrap(pending.first)
        XCTAssertEqual(pendingRow.state, "review")
        for filename in ["mirror-policy.js", "mirror-policy.json"] { try FileManager.default.copyItem(at: URL(fileURLWithPath: bundlePath).appendingPathComponent(filename), to: page.appendingPathComponent(filename)) }
        let entry = page.appendingPathComponent("index.html")
        try Data("<!doctype html><script src='mirror-policy.js'></script><script>window.replies={};window.addEventListener('texttext:vault-reply',e=>window.replies[e.detail.id]=e.detail);window.ready=true;</script>".utf8).write(to: entry)
        var activeAccount: LocalVaultAccountCredential? = account
        var controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), verifiedCredentials: { activeAccount })
        defer { controller.shutdown(); controller.close() }
        var view = try XCTUnwrap(controller.window?.contentView as? WKWebView); controller.showWindow(nil)
        for _ in 0..<500 { if (try? await view.evaluateJavaScript("window.ready===true")) as? Bool == true { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        func rpc(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
            let id = UUID().uuidString, bytes = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": params])
            _ = try await view.evaluateJavaScript("window.webkit.messageHandlers.localVault.postMessage(\(String(decoding: bytes, as: UTF8.self)));true")
            for _ in 0..<500 { if let reply = try await view.evaluateJavaScript("window.replies['\(id)']||null") as? [String: Any] { return reply }; try await Task.sleep(nanoseconds: 20_000_000) }
            throw CocoaError(.coderInvalidValue)
        }
        let stale = try await rpc("folderSyncMoveRead", ["workspaceRoot": root.path + "/Other", "id": pendingRow.id]); XCTAssertNotNil(stale["error"])
        let savedMoves = try await rpc("recoveryList", ["workspaceRoot": root.path])
        let savedPage = try XCTUnwrap(savedMoves["result"] as? [String: Any])
        XCTAssertEqual((savedPage["savedFileMoves"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(savedPage["savedFileMovesTruncated"] as? Bool, false)
        let wrongSavedScope = try await rpc("savedFileMoveRead", ["workspaceRoot": root.path + "/Other", "id": UUID().uuidString.lowercased()])
        XCTAssertNotNil(wrongSavedScope["error"]); XCTAssertNil(wrongSavedScope["result"])
        let noSavedConsent = try await rpc("retrySavedFileMove", ["workspaceRoot": root.path, "id": UUID().uuidString.lowercased(), "requestHash": String(repeating: "a", count: 64), "inspection": String(repeating: "b", count: 64)])
        XCTAssertNotNil(noSavedConsent["error"]); XCTAssertNil(noSavedConsent["result"])
        let response = try await rpc("folderSyncMoveRead", ["workspaceRoot": root.path, "id": pendingRow.id]), row = try XCTUnwrap(response["result"] as? [String: Any])
        XCTAssertEqual(Set(row.keys), Set(["id", "command", "state", "requestHash", "expectedIdentity", "from", "to", "localInspection", "inspection", "manifestRevision", "folders", "items", "result", "resolutionBlocked"]))
        XCTAssertEqual(row["state"] as? String, "review"); XCTAssertTrue(row["resolutionBlocked"] is NSNull)
        activeAccount = nil
        let signedOut = try await rpc("folderSyncMoveRead", ["workspaceRoot": root.path, "id": pendingRow.id]); XCTAssertNotNil(signedOut["error"]); XCTAssertNil(signedOut["result"])
        controller.shutdown(); controller.close()
        activeAccount = account
        controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), verifiedCredentials: { activeAccount })
        view = try XCTUnwrap(controller.window?.contentView as? WKWebView); controller.showWindow(nil)
        for _ in 0..<500 { if (try? await view.evaluateJavaScript("window.ready===true")) as? Bool == true { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        var consent: [String: Any] = ["workspaceRoot": root.path, "id": pendingRow.id, "inspection": row["inspection"]!, "requestHash": row["requestHash"]!, "localInspection": row["localInspection"]!]
        let refused = try await rpc("resolveFolderSyncMove", consent); XCTAssertNotNil(refused["error"])
        consent["consent"] = true
        let resolved = try await rpc("resolveFolderSyncMove", consent); XCTAssertEqual((resolved["result"] as? [String: Any])?["resolved"] as? Bool, true)
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "CASE/Empty")); XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "Case"))
        let receipt = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/folder-case-cancellations/" + pendingRow.id + ".json")
        XCTAssertTrue(FileManager.default.fileExists(atPath: receipt.path))
    }
}
