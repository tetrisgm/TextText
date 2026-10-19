import AppKit
import WebKit
import TextTextSyncTestSupport
import TextTextWorkspaceCore
import XCTest
@testable import TextTextApp
@testable import TextTextFileProviderKit

final class LocalVaultFileMutationWakeTests: XCTestCase {
    private enum Outcome { case success, conflict, staleOwner, stoppedConnection, changedRoot }
    @MainActor func testSuccessfulBridgeWriteWakesAfterReleasePassFinishedBeforeCAS() async throws { try await exercise(.success) }
    @MainActor func testFailedCASDoesNotWakeAnotherPass() async throws { try await exercise(.conflict) }
    @MainActor func testChangedOwnerDoesNotWakeCapturedConnection() async throws { try await exercise(.staleOwner) }
    @MainActor func testStoppedConnectionDoesNotWakeAfterWrite() async throws { try await exercise(.stoppedConnection) }
    @MainActor func testChangedRootDoesNotWakeCapturedConnection() async throws { try await exercise(.changedRoot) }
    @MainActor private func exercise(_ outcome: Outcome) async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_VAULT_HTTP_TEST"] == "1" else { throw XCTSkip("Explicit loopback fixture required") }
        _ = NSApplication.shared
        var repository = URL(fileURLWithPath: #filePath); for _ in 0..<4 { repository.deleteLastPathComponent() }
        let fm = FileManager.default, temporary = fm.temporaryDirectory.appendingPathComponent("write-wake-" + UUID().uuidString).resolvingSymlinksInPath()
        let root = temporary.appendingPathComponent("Workspace"), ready = temporary.appendingPathComponent("ready.json")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(temporary.appendingPathComponent("private-state"))
        let server = Process(); server.executableURL = URL(fileURLWithPath: "/usr/bin/env"); server.currentDirectoryURL = repository
        server.arguments = ["node", "--import", "tsx", "scripts/vault-http-test-server.ts", temporary.appendingPathComponent("server").path, ready.path]
        server.standardOutput = FileHandle.nullDevice; server.standardError = FileHandle.nullDevice; try server.run()
        defer { if server.isRunning { server.terminate(); server.waitUntilExit() }; _ = LocalVaultDeviceState.exchangeConfiguredBase(previous); try? fm.removeItem(at: temporary) }
        for _ in 0..<500 { if fm.fileExists(atPath: ready.path) || !server.isRunning { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        struct Ready: Decodable { let origin: URL }
        let origin = try JSONDecoder().decode(Ready.self, from: Data(contentsOf: ready)).origin
        let binding = try LocalVaultSyncBinding(origin: origin, workspaceId: "contract-workspace")
        let credential = LocalVaultAccountCredential(origin: origin, token: "vault-http-fixture", accountId: "wake-owner")
        var currentCredential = credential
        let item = "92222222-2222-4222-8222-222222222222", path = "Notes/Write wake.textpack"
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: credential.accountId!)
        try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
        let transport = try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: binding.workspaceId, token: credential.token, accountId: credential.accountId)
        let builder = temporary.appendingPathComponent("builder"); try fm.createDirectory(at: builder, withIntermediateDirectories: true)
        let seed = try BuiltinTextPackDocument.create(title: "Write wake", body: "Existing fixture text.")
        let markdown = "---\ntextTextId: \"\(item)\"\ntitle: \"Write wake\"\n---\n\nExisting fixture text."
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: seed.documentJSON, templateJSON: seed.templateJSON, assets: [], sourceURL: nil, in: builder)
        let bytes = try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: builder))
        _ = try await transport.upload(itemId: item, path: path, data: bytes, baseRevision: nil, operationId: UUID().uuidString, nativeEditor: false)
        func establishBaseline() async throws { let e = try makeTestSync(root: root, binding: binding, transport: transport, accountId: credential.accountId); let report = try await e.sync(); XCTAssertTrue(report.errors.isEmpty) }
        try await establishBaseline()
        let gate = WriteWakeGate()
        var connection: LocalVaultConnectionController?, passes = 0
        var hooks = LocalVaultWindowController.TestDependencies()
        hooks.observesFiles = false; hooks.connectsAutomatically = false
        hooks.policyFactory = { binding, account in makeTestMirrorPolicy(workspaceId: binding.workspaceId, accountId: account.accountId) }
        hooks.syncPass = { engine in let report = try await engine.sync(); passes += 1; return report }
        hooks.didCreateConnection = { connection = $0 }
        hooks.beforeNativeWrite = { gate.enterAndWait() }
        let entry = temporary.appendingPathComponent("index.html")
        try Data("<script>window.replies={};addEventListener('texttext:vault-reply',e=>replies[e.detail.id]=e.detail);window.ready=true;</script>".utf8).write(to: entry)
        let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), verifiedCredentials: { currentCredential }, testDependencies: hooks)
        defer { gate.release(); controller.shutdown(); controller.close() }
        let view = try XCTUnwrap(controller.window?.contentView as? WKWebView); controller.showWindow(nil)
        let loaded = Date().addingTimeInterval(10)
        while (try? await view.evaluateJavaScript("window.ready===true")) as? Bool != true { guard Date() < loaded else { throw NSError(domain: "WriteWake", code: 1) }; try await Task.sleep(nanoseconds: 20_000_000) }
        func send(_ method: String, _ params: [String: Any]) async throws -> String {
            let id = UUID().uuidString, data = try JSONSerialization.data(withJSONObject: ["id": id, "method": method, "params": params])
            _ = try await view.evaluateJavaScript("webkit.messageHandlers.localVault.postMessage(\(String(decoding: data, as: UTF8.self)));true"); return id
        }
        func reply(_ id: String) async throws -> [String: Any] {
            let deadline = Date().addingTimeInterval(8)
            while true { if let v = try await view.evaluateJavaScript("replies['\(id)']||null") as? [String: Any] { return v }; guard Date() < deadline else { throw NSError(domain: "WriteWake", code: 2) }; try await Task.sleep(nanoseconds: 20_000_000) }
        }
        let engine = try XCTUnwrap(connection?.collaborationEngine), original = try LocalVaultDocumentStore(root: root).read(path: path)
        let openReply = try await reply(send("collaborationOpen", ["itemId": item, "path": path, "hash": original.hash]))
        let opened = try XCTUnwrap(openReply["result"] as? [String: Any]), token = try XCTUnwrap(opened["sessionToken"] as? String)
        let journal: [String: Any] = ["version": 1, "accountId": credential.accountId!, "journalGeneration": 1, "epoch": 1, "seq": 0, "revision": original.hash, "relativePath": path, "update": "AQ==", "pending": [], "batch": NSNull()]
        let clean = try await engine.materializeSharedEditing(sessionToken: token, itemId: item, expectedHash: original.hash, epoch: 1, seq: 0, acknowledgedRevision: original.hash,
            journalGeneration: 1, journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: false,
            markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
        let closed = try await reply(send("collaborationClose", ["itemId": item, "sessionToken": token])); XCTAssertNil(closed["error"])
        let source = clean.document
        var document = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(source.contents.documentJSON).utf8)) as? [String: Any]), content = try XCTUnwrap(document["content"] as? [String: Any])
        let body = "Existing fixture text.\n\n![square](assets/square.jpg)\n\n"
        content["body"] = body; content["assets"] = [["id": UUID().uuidString, "kind": "image", "src": "assets/square.jpg", "alt": "square", "contentType": "image/jpeg"]]; document["content"] = content
        let jpeg = try Data(contentsOf: repository.appendingPathComponent("public/fixtures/content-first/square.jpg"))
        let writeID = try await send("write", ["path": path, "hash": outcome == .conflict ? String(repeating: "0", count: 64) : source.hash, "markdown": "---\ntextTextId: \"\(item)\"\ntitle: \"Write wake\"\n---\n\n" + body,
            "documentJSON": String(decoding: JSONSerialization.data(withJSONObject: document), as: UTF8.self),
            "templateJSON": source.contents.templateJSON as Any, "addedAssets": [["filename": "square.jpg", "data": jpeg.base64EncodedString(), "contentType": "image/jpeg"]]])
        let early = Date().addingTimeInterval(4)
        while (!gate.entered || passes < 1) && Date() < early { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(gate.entered); XCTAssertEqual(passes, 1, "Release wake finishes while actual CAS is held")
        if outcome == .staleOwner { currentCredential = LocalVaultAccountCredential(origin: origin, token: credential.token, accountId: "different-owner") }
        if outcome == .stoppedConnection { controller.shutdown() }
        if outcome == .changedRoot {
            let other = temporary.appendingPathComponent("Other-owned-root")
            try fm.createDirectory(at: other, withIntermediateDirectories: true)
            try controller.selectRoot(other)
        }
        gate.release(); let written = try await reply(writeID)
        if outcome != .success {
            if outcome == .conflict { XCTAssertNotNil(written["error"]) }
            try await Task.sleep(nanoseconds: 800_000_000)
            XCTAssertEqual(passes, 1, "Failed CAS or stale owner/connection must not wake another pass")
            let unchanged = try await transport.download(itemId: item)
            XCTAssertEqual(unchanged.revision, original.hash)
            if outcome == .conflict { XCTAssertEqual(try LocalVaultDocumentStore(root: root).read(path: path).hash, source.hash) }
            else {
                let kept = try LocalVaultDocumentStore(root: root).read(path: path)
                XCTAssertNotEqual(kept.hash, source.hash, "Already authorized CAS bytes remain in their original root")
                let objects = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(kept.contents.documentJSON).utf8)) as? [String: Any])
                XCTAssertEqual((objects["content"] as? [String: Any])?["body"] as? String, body)
            }
            return
        }
        XCTAssertNil(written["error"])
        let settle = Date().addingTimeInterval(3)
        while passes < 2 && Date() < settle { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertGreaterThanOrEqual(passes, 2, "Successful native CAS must explicitly wake another pass without relying on FSEvents")
        let local = try LocalVaultDocumentStore(root: root).read(path: path)
        let serverPack = try await transport.download(itemId: item)
        XCTAssertEqual(serverPack.revision, local.hash, "Post-write mirror must acknowledge the exact image revision")
        let fresh = try await reply(send("collaborationOpen", ["itemId": item, "path": path, "hash": local.hash])); XCTAssertNil(fresh["error"])
        if let value = fresh["result"] as? [String: Any], let session = value["sessionToken"] as? String { _ = try await reply(send("collaborationClose", ["itemId": item, "sessionToken": session])) }
    }
}
private final class WriteWakeGate: @unchecked Sendable {
    private let lock = NSLock(), semaphore = DispatchSemaphore(value: 0)
    private var didEnter = false
    var entered: Bool { lock.lock(); defer { lock.unlock() }; return didEnter }
    func enterAndWait() { lock.lock(); didEnter = true; lock.unlock(); _ = semaphore.wait(timeout: .now() + 8) }
    func release() { semaphore.signal() }
}
