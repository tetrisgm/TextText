import AppKit
import WebKit
import XCTest
import TextTextWorkspaceCore
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultSessionLifecycleTests: XCTestCase {
    @MainActor
    func testClosingAndReopeningWindowPreservesPendingCheckpointSession() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("session-lifecycle-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let itemId = UUID().uuidString, path = "Note.textpack"
        let document = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
        let markdown = "---\ntextTextId: \"\(itemId)\"\ntitle: Note\n---\n\nOriginal"
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown,
            documentJSON: document.documentJSON, templateJSON: document.templateJSON,
            assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
        let original = try LocalVaultDocumentStore(root: root).read(path: path)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: LifecycleTransport())
        _ = try await engine.sync()
        let relay = LocalVaultCollaboration(credentials: { nil }, engine: { engine })
        let entry = root.appendingPathComponent("index.html")
        try "<html><body>Retained editor</body></html>".write(to: entry, atomically: true, encoding: .utf8)
        let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), collaboration: relay)
        defer { controller.shutdown(); controller.close() }
        controller.showWindow(nil)
        let view = try XCTUnwrap(controller.window?.contentView as? WKWebView)
        let opened = try await request(relay, "collaborationOpen", ["itemId": itemId, "path": path, "hash": original.hash], root)
        let token = try XCTUnwrap(opened["sessionToken"] as? String)
        XCTAssertEqual(opened["capabilities"] as? [String], ["epoch-adoption"], "The shared client keys automatic epoch recovery on this exact name")
        var hash = original.hash
        for generation in 1...4 {
            if generation == 2 {
                // Command-W closes the window but AppDelegate retains its controller
                // and WKWebView. The same editor sends the next checkpoint.
                controller.close()
                let visibility = try await view.evaluateJavaScript("document.visibilityState") as? String
                XCTAssertEqual(visibility, "hidden", "Hidden windows must suspend the editor's network polling")
            }
            if generation == 3 { controller.present() }
            if generation == 4 { controller.credentialsChanged() }
            let body = "Pending edit \(generation)"
            var json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(document.documentJSON.utf8)) as? [String: Any])
            var content = try XCTUnwrap(json["content"] as? [String: Any]); content["body"] = body; json["content"] = content
            let journal: [String: Any] = ["version": 1, "journalGeneration": generation, "epoch": 1, "seq": 0,
                "revision": original.hash, "relativePath": path, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
            let result = try await request(relay, "collaborationCheckpoint", ["itemId": itemId, "sessionToken": token,
                "hash": hash, "epoch": 1, "seq": 0, "revision": original.hash, "journalGeneration": generation,
                "journal": String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self),
                "pending": true, "markdown": markdown.replacingOccurrences(of: "Original", with: body),
                "documentJSON": String(decoding: try JSONSerialization.data(withJSONObject: json), as: UTF8.self)], root)
            hash = try XCTUnwrap(result["hash"] as? String)
            XCTAssertTrue(try LocalVaultDocumentStore(root: root).read(path: path).contents.markdown.contains(body))
        }
        XCTAssertTrue(controller.window?.contentView === view)
        let saved = try await engine.readSharedCheckpoint(itemId: itemId)
        XCTAssertEqual(saved?.journalGeneration, 4)
        XCTAssertEqual(saved?.pending, true)
        XCTAssertNil(saved?.retiredReason)
        controller.shutdown()
        do {
            _ = try await request(relay, "collaborationCheckpoint", ["itemId": itemId, "sessionToken": token], root)
            XCTFail("Disposing the editor must invalidate its native session")
        } catch let error as LocalVaultCollaborationError {
            XCTAssertEqual(error.code, "session_closed")
        }
    }

    @MainActor
    private func request(_ relay: LocalVaultCollaboration, _ method: String, _ params: [String: Any], _ root: URL) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            relay.start(id: UUID().uuidString, method: method, params: params, root: root) { result in
                continuation.resume(with: result.map { $0 ?? [:] })
            }
        }
    }
}

private actor LifecycleTransport: LocalVaultSyncTransport {
    func manifest() async throws -> [LocalVaultRemoteItem] { [] }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { TextTextStableDigest.sha256Hex(data) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
