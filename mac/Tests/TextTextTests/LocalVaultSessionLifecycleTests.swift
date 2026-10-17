import AppKit
import WebKit
import XCTest
import TextTextWorkspaceCore
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultSessionLifecycleTests: XCTestCase {
    @MainActor
    func testProductionAccountReviewHonorsChoiceIdentityAndFreshPermission() async throws {
        _ = NSApplication.shared
        func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
        for scenario in ["cancel", "changed", "revoked", "keep"] {
            let base = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-review-" + UUID().uuidString)
            let root = base.appendingPathComponent("workspace")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: base) }
            let workspace = scenario + "-" + UUID().uuidString
            let binding = try LocalVaultSyncBinding(origin: URL(string: "https://native-review.test")!, workspaceId: workspace)
            try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
            let directory = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let original = try JSONSerialization.data(withJSONObject: ["version": 1, "binding": try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding)), "baselines": [:], "outbox": [:], "conflicts": [:], "cursor": 0])
            let state = directory.appendingPathComponent("state.json"); try original.write(to: state)
            let entry = base.appendingPathComponent("index.html")
            try "<html><script>window.texttextFlushForNativeClose=async()=>({ok:true,idle:true,durability:{outcome:'durable'}});</script><p>Isolated native review fixture</p></html>".write(to: entry, atomically: true, encoding: .utf8)
            var credential = LocalVaultAccountCredential(origin: binding.origin, token: "fixture", accountId: "account-a")
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeReviewProtocol.self]
            let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
            let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), verifiedCredentials: { credential }, accountReviewSession: session)
            let window = try XCTUnwrap(controller.window), view = try XCTUnwrap(window.contentView as? WKWebView)
            defer { window.orderOut(nil); controller.shutdown() }
            controller.showWindow(nil)
            let deadline = Date().addingTimeInterval(15)
            while (try? await view.evaluateJavaScript("typeof window.texttextFlushForNativeClose==='function'")) as? Bool != true {
                if Date() >= deadline { XCTFail("Review fixture did not load"); return }; try await Task.sleep(nanoseconds: 20_000_000)
            }
            let review = try XCTUnwrap(controller.reviewSavedWork())
            while window.attachedSheet == nil && Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
            let sheet = try XCTUnwrap(window.attachedSheet), content = try XCTUnwrap(sheet.contentView)
            let texts = descendants(content).compactMap { ($0 as? NSTextField)?.stringValue }
            XCTAssertTrue(texts.contains { $0.contains("fixture@example.test") })
            XCTAssertTrue(texts.contains { $0.contains(root.path) })
            if scenario == "cancel", let output = ProcessInfo.processInfo.environment["TEXTTEXT_REVIEW_SCREENSHOT"] {
                try await Task.sleep(nanoseconds: 200_000_000)
                let capture = Process(); capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                capture.arguments = ["-x", "-l", String(sheet.windowNumber), output]
                try capture.run(); capture.waitUntilExit()
                XCTAssertEqual(capture.terminationStatus, 0, "Capture only the isolated review sheet")
            }
            if scenario == "changed" { credential = LocalVaultAccountCredential(origin: binding.origin, token: "fixture-b", accountId: "account-b") }
            let button = try XCTUnwrap(descendants(content).compactMap { $0 as? NSButton }.first { $0.title == (scenario == "cancel" ? "Cancel" : "Keep saved work") })
            button.performClick(nil)
            var finished = false
            Task { await review.value; finished = true }
            while !finished && Date() < deadline {
                if let failure = window.attachedSheet, failure !== sheet, let content = failure.contentView {
                    if scenario == "keep" { XCTFail("Keep failed: " + descendants(content).compactMap { ($0 as? NSTextField)?.stringValue }.joined(separator: " | ")) }
                    descendants(content).compactMap { $0 as? NSButton }.first { $0.title == "OK" }?.performClick(nil)
                }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
            XCTAssertTrue(finished, "Native review must settle after its choice")
            if !finished { review.cancel(); return }
            if scenario == "keep" {
                let adopted = try JSONSerialization.jsonObject(with: Data(contentsOf: state)) as? [String: Any]
                XCTAssertEqual(adopted?["accountId"] as? String, "account-a")
            } else { XCTAssertEqual(try Data(contentsOf: state), original, "\(scenario) must preserve unbound originals") }
            controller.shutdown()
        }
    }
    @MainActor
    func testOlderProfileViewerReadsOriginalWKStorageWithoutReplayingIt() async throws {
        guard let bundle = ProcessInfo.processInfo.environment["TEXTTEXT_LEGACY_VIEWER_BUNDLE"] else { throw XCTSkip("Requires the explicit bundled recovery viewer fixture") }
        _ = NSApplication.shared
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-older-profile-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        for file in ["legacy-recovery.html", "legacy-recovery.js"] { try FileManager.default.copyItem(at: URL(fileURLWithPath: bundle).appendingPathComponent(file), to: base.appendingPathComponent(file)) }
        let entry = base.appendingPathComponent("index.html")
        try "<html><p>Isolated previous profile</p></html>".write(to: entry, atomically: true, encoding: .utf8)
        let store = WKWebsiteDataStore(forIdentifier: UUID()), config = WKWebViewConfiguration(); config.websiteDataStore = store
        let seed = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        let seedWindow = NSWindow(contentRect: seed.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false); seedWindow.contentView = seed; seedWindow.orderFront(nil)
        defer { seedWindow.orderOut(nil); seed.stopLoading() }
        seed.loadFileURL(entry, allowingReadAccessTo: base)
        let deadline = Date().addingTimeInterval(15)
        while (try? await seed.evaluateJavaScript("document.readyState==='complete' && location.pathname.endsWith('/index.html')")) as? Bool != true {
            if Date() >= deadline { XCTFail("Older profile fixture did not load"); return }; try await Task.sleep(nanoseconds: 20_000_000)
        }
        let raw = "{\"draft\":{\"title\":\"Native older draft\",\"body\":\"Retained WK writing\"}}"
        let key = "texttext:workspace-draft:v1:workspace:item"
        _ = try await seed.callAsyncJavaScript("localStorage.setItem(key,raw);const r=indexedDB.open('texttext-workspace-pool',2);await new Promise((resolve,reject)=>{r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts','readwrite');t.objectStore('drafts').put(JSON.parse(raw),'workspace:item');t.oncomplete=()=>{db.close();resolve()}}});", arguments: ["key": key, "raw": raw], in: nil, contentWorld: .page)
        seedWindow.orderOut(nil)
        let viewer = LegacyDraftsWindowController(entry: base.appendingPathComponent("legacy-recovery.html"), dataStore: store)
        defer { viewer.close() }; viewer.present()
        while (try? await viewer.webView.evaluateJavaScript("document.querySelector('#status')?.textContent.includes('2 saved records')")) as? Bool != true {
            if Date() >= deadline { XCTFail("Native recovery viewer did not find the old profile: \((try? await viewer.webView.evaluateJavaScript("document.body.innerText")) ?? "unavailable")"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let retained = try await viewer.webView.evaluateJavaScript("localStorage.getItem('texttext:workspace-draft:v1:workspace:item')") as? String
        let count = try await viewer.webView.evaluateJavaScript("document.querySelectorAll('#records section').length") as? Int
        let bridge = try await viewer.webView.evaluateJavaScript("typeof window.webkit?.messageHandlers?.localVault") as? String
        XCTAssertEqual(retained, raw); XCTAssertEqual(count, 2); XCTAssertEqual(bridge, "undefined")
        let offline = try await viewer.webView.callAsyncJavaScript("try{await fetch('https://unexpected.test/write');return false}catch{return true}", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(offline as? Bool, true)
        if let output = ProcessInfo.processInfo.environment["TEXTTEXT_LEGACY_SCREENSHOT"] {
            let snapshot = try await viewer.webView.takeSnapshot(configuration: nil)
            if let tiff = snapshot.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) { try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: output)) }
        }
    }
    @MainActor
    func testProductionWindowCloseWaitsForItsRendererCheckpoint() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let entry = root.appendingPathComponent("index.html")
        try """
        <!doctype html><title>Isolated close fixture</title><script>
        window.texttextFlushForNativeClose=()=>new Promise(resolve=>{
          window.finishFlush=()=>resolve({ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:1,outcome:'durable'}});
        });
        </script><p>Isolated native window close</p><input aria-label="Fixture input" value="before">
        """.write(to: entry, atomically: true, encoding: .utf8)
        let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent())
        let window = try XCTUnwrap(controller.window)
        let view = try XCTUnwrap(window.contentView as? WKWebView)
        defer { window.orderOut(nil); controller.shutdown() }
        controller.showWindow(nil)
        let deadline = Date().addingTimeInterval(12)
        while (try? await view.evaluateJavaScript("typeof window.texttextFlushForNativeClose==='function'")) as? Bool != true {
            if Date() >= deadline { XCTFail("Isolated renderer did not load"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        window.makeKeyAndOrderFront(nil)
        XCTAssertTrue(window.makeFirstResponder(view))
        _ = try await view.evaluateJavaScript("document.querySelector('input').focus()")
        let previousResponder = window.firstResponder
        window.performClose(nil)
        guard window.isVisible else { XCTFail("Production close released the window before its durable renderer reply"); return }
        XCTAssertTrue(window.ignoresMouseEvents, "Pending close must prevent pointer input from refocusing the editor")
        if let previousResponder { XCTAssertFalse(window.firstResponder === previousResponder, "Pending close must relinquish editor keyboard focus") }
        while (try? await view.evaluateJavaScript("typeof window.finishFlush==='function'")) as? Bool != true {
            if Date() >= deadline { XCTFail("Production close never requested renderer durability"); return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        _ = try await view.evaluateJavaScript("window.finishFlush()")
        while window.isVisible && Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertFalse(window.isVisible, "A durable renderer reply must complete the pending close")
    }
    @MainActor
    func testAccountReplacementCannotCheckpointOrRetireCapturedLocalSession() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let itemId = "captured-account-note", path = "Note.textpack"
        let document = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\n---\nOriginal",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
        let original = try LocalVaultDocumentStore(root: root).read(path: path)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let engine = try LocalVaultSync(root: root, binding: binding, transport: LifecycleTransport())
        _ = try await engine.sync()
        var credential = LocalVaultAccountCredential(origin: binding.origin, token: "fixture-a")
        let relay = LocalVaultCollaboration(verifiedCredentials: { credential }, expectedLifetime: .captured(credential), engine: { engine })
        let opened = try await request(relay, "collaborationOpen", ["itemId": itemId, "path": path, "hash": original.hash], root)
        let token = try XCTUnwrap(opened["sessionToken"] as? String)
        credential = LocalVaultAccountCredential(origin: binding.origin, token: "fixture-b")
        do {
            _ = try await request(relay, "collaborationCheckpoint", ["itemId": itemId, "sessionToken": token], root)
            XCTFail("Replacement account acquired an old local session")
        } catch let error as LocalVaultCollaborationError { XCTAssertEqual(error.code, "account_changed") }
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, original.hash)
        _ = try await request(relay, "collaborationClose", ["itemId": itemId, "sessionToken": token, "retiredReason": "Replacement account supplied this reason"], root)
        do {
            _ = try await request(relay, "collaborationOpen", ["itemId": itemId, "path": path, "hash": original.hash], root)
            XCTFail("Replacement account opened a new session in the old legacy realm")
        } catch let error as LocalVaultCollaborationError { XCTAssertEqual(error.code, "account_changed") }
        let reopened = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: original.hash)
        XCTAssertNil(reopened.checkpoint?.retiredReason)
        try await engine.endSharedEditing(sessionToken: reopened.sessionToken, itemId: itemId)
    }

    func testCacheHydrationDoesNotRelabelAnOpenLegacyWindow() {
        let origin = URL(string: "https://texttext.test")!
        let initial = LocalVaultAccountCredential(origin: origin, token: "fixture-a")
        let verified = LocalVaultAccountCredential(origin: origin, token: "fixture-a", accountId: "account-a")
        XCTAssertNil(LocalVaultAccountCredential.forWindow(initial: initial, current: verified)?.accountId)
        XCTAssertEqual(LocalVaultAccountCredential.forWindow(initial: initial, current: LocalVaultAccountCredential(origin: origin, token: "fixture-b", accountId: "account-b"))?.accountId, "account-b")
        XCTAssertNil(LocalVaultAccountCredential.forWindow(initial: initial, current: nil))
    }

    func testNativeWebProfilesSeparateAccountsAndRemainStableAcrossOriginSpelling() throws {
        let a = try LocalVaultWindowController.accountProfileIdentifier(origin: URL(string: "https://texttext.test")!, accountId: "account-a")
        XCTAssertEqual(a, try LocalVaultWindowController.accountProfileIdentifier(origin: URL(string: "https://texttext.test/")!, accountId: "account-a"))
        XCTAssertNotEqual(a, try LocalVaultWindowController.accountProfileIdentifier(origin: URL(string: "https://texttext.test")!, accountId: "account-b"))
        XCTAssertNotEqual(a, try LocalVaultWindowController.accountProfileIdentifier(origin: URL(string: "https://other.test")!, accountId: "account-a"))
        XCTAssertThrowsError(try LocalVaultWindowController.accountProfileIdentifier(origin: URL(string: "https://texttext.test")!, accountId: "../unverified"))
    }

    func testNativeCloseRequiresTypedDurableResult() {
        let durable: [String: Any] = ["ok": true, "durability": [
            "workspaceId": "workspace", "itemId": "item", "lifecycle": "lifecycle", "generation": 8, "outcome": "durable",
        ]]
        let accepted = LocalVaultWindowController.nativeFlushDecision(durable)
        XCTAssertTrue(accepted.acknowledged)
        XCTAssertEqual(accepted.durability?["generation"] as? Int, 8)

        for outcome in ["pending", "storage-unavailable", "invalid-journal", "stale-lifecycle"] {
            let rejected = LocalVaultWindowController.nativeFlushDecision(["ok": true, "durability": [
                "workspaceId": "workspace", "itemId": "item", "lifecycle": "lifecycle", "generation": 8, "outcome": outcome,
            ]])
            XCTAssertFalse(rejected.acknowledged, "\(outcome) must not release the native close guard")
        }
        XCTAssertFalse(LocalVaultWindowController.nativeFlushDecision(["ok": true, "durability": ["outcome": "durable"]]).acknowledged,
            "A durable label without its lifecycle identity must not release the native close guard")
        XCTAssertTrue(LocalVaultWindowController.nativeFlushDecision(["ok": true, "idle": true, "durability": ["outcome": "durable"]]).acknowledged,
            "An explicitly empty editor can leave the home screen")
        XCTAssertFalse(LocalVaultWindowController.nativeFlushDecision(["ok": false, "idle": true, "durability": ["outcome": "durable"]]).acknowledged)
        XCTAssertFalse(LocalVaultWindowController.nativeFlushDecision(["ok": true, "idle": true, "durability": ["outcome": "durable", "itemId": "item"]]).acknowledged)
        let localFile: [String: Any] = ["ok": true, "durability": [
            "workspaceId": "workspace", "itemId": "item", "lifecycle": "local-file:Notes/Note.textpack",
            "fileHash": "saved-file-hash", "outcome": "local-file-durable",
        ]]
        XCTAssertTrue(LocalVaultWindowController.nativeFlushDecision(localFile).acknowledged)
        XCTAssertFalse(LocalVaultWindowController.nativeFlushDecision(["ok": true, "durability": [
            "workspaceId": "workspace", "itemId": "item", "lifecycle": "local-file:Notes/Note.textpack",
            "outcome": "local-file-durable",
        ]]).acknowledged)
        XCTAssertFalse(LocalVaultWindowController.nativeFlushDecision(true).acknowledged,
            "An untyped Boolean cannot satisfy the native durability contract")
    }

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

private final class NativeReviewProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var profiles: [String: Int] = [:]
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native-review.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path, workspace = request.url!.deletingLastPathComponent().path
        Self.lock.lock()
        if path.hasSuffix("/account") { Self.profiles[workspace, default: 0] += 1 }
        let count = Self.profiles[workspace, default: 0]
        Self.lock.unlock()
        let authorized = request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture" && request.value(forHTTPHeaderField: "X-TextText-Account") == "account-a"
        let status = !authorized || (path.contains("/revoked-") && count >= 2 && path.hasSuffix("/items")) ? 403 : 200
        let body: [String: Any] = path.hasSuffix("/account") ? ["accountId": "account-a", "email": "fixture@example.test"] : ["items": []]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
