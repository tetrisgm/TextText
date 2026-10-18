import AppKit
import WebKit
import XCTest
@testable import TextTextFileProviderKit
@testable import TextTextApp

final class FolderRenameBridgeTests: XCTestCase {
    @MainActor
    func testScopedRecoveryBridgeListsFolderConflictBeforeFencedDocumentRecovery() async throws {
        _ = NSApplication.shared
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("folder-bridge-" + UUID().uuidString).resolvingSymlinksInPath()
        let root = temporary.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try LocalVaultAccountRootOwnership.open(root: root, binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace"), accountId: "account-a")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Before"), withIntermediateDirectories: false)
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" {
                try FileManager.default.moveItem(at: root.appendingPathComponent("Before"), to: root.appendingPathComponent("Preserved"))
                try FileManager.default.createDirectory(at: root.appendingPathComponent("Before"), withIntermediateDirectories: false)
            }
        })
        XCTAssertThrowsError(try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: nil))
        let entry = temporary.appendingPathComponent("index.html")
        try Data("""
            <!doctype html><script>
            window.replies={};window.addEventListener('texttext:vault-reply',e=>window.replies[e.detail.id]=e.detail);
            window.ready=true;
            </script>
            """.utf8).write(to: entry)
        let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), credentials: { nil })
        defer { controller.shutdown(); controller.close() }
        let view = try XCTUnwrap(controller.window?.contentView as? WKWebView)
        controller.showWindow(nil)
        let deadline = Date().addingTimeInterval(15)
        while (try? await view.evaluateJavaScript("window.ready===true")) as? Bool != true {
            guard Date() < deadline else { throw NSError(domain: "FolderBridge", code: 1) }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        func rpc(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
            let id = UUID().uuidString
            let data = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": params])
            _ = try await view.evaluateJavaScript("window.webkit.messageHandlers.localVault.postMessage(\(String(decoding: data, as: UTF8.self)));true")
            let expires = Date().addingTimeInterval(10)
            while true {
                if let reply = try await view.evaluateJavaScript("window.replies['\(id)']||null") as? [String: Any] { return reply }
                guard Date() < expires else { throw NSError(domain: "FolderBridge", code: 2) }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
        }
        let response = try await rpc("recoveryList", ["workspaceRoot": root.path])
        let result = try XCTUnwrap(response["result"] as? [String: Any])
        let rows = try XCTUnwrap(result["folderRenames"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(Set(row.keys), Set(["id","fromPath","toPath","expectedIdentity","from","to","inspection","summary","resolutionBlocked","resolved"]))
        let from = try XCTUnwrap(row["from"] as? [String: Any])
        XCTAssertEqual(from["present"] as? Bool, false); XCTAssertTrue(from["identity"] is NSNull)
        XCTAssertTrue(row["resolutionBlocked"] is NSNull)
        for key in ["entries", "replacements", "assets"] { XCTAssertEqual((result[key] as? [Any])?.count, 0) }
        let id = try XCTUnwrap(row["id"] as? String)
        let stale = try await rpc("folderRenameRead", ["workspaceRoot": root.path + "/Other", "id": id])
        XCTAssertNotNil(stale["error"]); XCTAssertNil(stale["result"])
        let fresh = try await rpc("folderRenameRead", ["workspaceRoot": root.path, "id": id])
        XCTAssertEqual((fresh["result"] as? [String: Any])?["inspection"] as? String, row["inspection"] as? String)
    }
}
