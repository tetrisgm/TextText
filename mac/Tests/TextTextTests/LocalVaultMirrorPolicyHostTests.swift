import AppKit
import WebKit
import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultMirrorPolicyHostTests: XCTestCase {
    private struct Manifest: Decodable { let digest: String }
    private struct Vector: Decodable { let name: String, observed: LocalVaultMirrorObservation, disposition: LocalVaultMirrorDisposition }
    func testUnresponsivePolicyTimesOutAndRetiresItsLease() async throws {
        let policy = LocalVaultMirrorPolicy(digest: String(repeating: "f", count: 64),
            scope: LocalVaultMirrorScope(accountId: "a", workspaceId: "w", lifecycle: "l"), timeoutNanoseconds: 20_000_000) { _ in
                try await Task.sleep(nanoseconds: 5_000_000_000); return "{}"
            }
        let observed = LocalVaultMirrorObservation(localHash: "a", baselineHash: "a", remoteRevision: "r", baselineRevision: "r", refresh: false)
        let started = Date()
        do { _ = try await policy.decide(observed); XCTFail("Unresponsive host passed") }
        catch LocalVaultMirrorPolicy.Failure.timeout {} catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 1)
        do { _ = try await policy.decide(observed); XCTFail("Timed out lease resumed") }
        catch LocalVaultMirrorPolicy.Failure.stale {} catch { XCTFail("Unexpected error: \(error)") }
    }
    @MainActor
    func testPackagedPolicyWithoutEditorAndAfterWindowClose() async throws {
        guard let fixture = ProcessInfo.processInfo.environment["TEXTTEXT_MIRROR_POLICY_BUNDLE"] else { throw XCTSkip("Requires explicit policy bundle") }
        _ = NSApplication.shared
        let base = URL(fileURLWithPath: fixture)
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: base.appendingPathComponent("mirror-policy.json")))
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: base.appendingPathComponent("vectors.json")))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-policy-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let controller = LocalVaultWindowController(entry: base.appendingPathComponent("index.html"), root: root, websiteDataStore: .nonPersistent())
        let window = try XCTUnwrap(controller.window), view = try XCTUnwrap(window.contentView as? WKWebView)
        controller.showWindow(nil)
        defer { controller.shutdown(); window.orderOut(nil); view.stopLoading(); try? FileManager.default.removeItem(at: root) }
        let ready: @MainActor @Sendable () async throws -> Void = {
            let deadline = Date().addingTimeInterval(10)
            while (try? await view.evaluateJavaScript("typeof window.texttextMirrorPolicy==='object'&&typeof window.texttextFlushForNativeClose==='function'")) as? Bool != true {
                if Date() > deadline { throw LocalVaultMirrorPolicy.Failure.stale }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
        }
        try await ready()
        let noEditor = try await view.evaluateJavaScript("!document.querySelector('[aria-label=\"Document body\"]')") as? Bool
        XCTAssertEqual(noEditor, true)
        let evaluate: @MainActor @Sendable (String) async throws -> String = { script in
            guard let result = try await view.callAsyncJavaScript("return JSON.stringify(" + script + ");", arguments: [:], in: nil, contentWorld: .page) as? String else { throw LocalVaultMirrorPolicy.Failure.stale }
            return result
        }
        let reload: @MainActor @Sendable () async throws -> Void = {
            let previous = try await view.evaluateJavaScript("window.texttextMirrorPolicy.handshake().pageId") as? String
            view.reload()
            let deadline = Date().addingTimeInterval(10)
            while true {
                if let current = try? await view.evaluateJavaScript("window.texttextMirrorPolicy.handshake().pageId") as? String,
                   current != previous { break }
                if Date() > deadline { throw LocalVaultMirrorPolicy.Failure.stale }
                try await Task.sleep(nanoseconds: 20_000_000)
            }
            try await ready()
        }
        let policy = LocalVaultMirrorPolicy(digest: manifest.digest,
            scope: LocalVaultMirrorScope(accountId: "account-a", workspaceId: "workspace", lifecycle: "connection-a"), evaluate: { try await evaluate($0) })
        for vector in vectors {
            let result = try await policy.decide(vector.observed)
            XCTAssertEqual(result, vector.disposition, vector.name)
        }
        // Exercise the production window's close guard and retained page.
        window.performClose(nil)
        let closeDeadline = Date().addingTimeInterval(10)
        while window.isVisible && Date() < closeDeadline { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertFalse(window.isVisible, "Production home window must close normally")
        let closedResult = try await policy.decide(vectors[0].observed)
        XCTAssertEqual(closedResult, vectors[0].disposition)
        for field in ["scope", "requestId", "observed", "digest", "pageId", "disposition"] {
            let tampered: @MainActor @Sendable (String) async throws -> String = { script in
                let raw = try await evaluate(script)
                guard script.contains(".evaluate(") else { return raw }
                var result = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as! [String: Any]
                result[field] = "invalid"
                return String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self)
            }
            let bad = LocalVaultMirrorPolicy(digest: manifest.digest,
                scope: LocalVaultMirrorScope(accountId: "account-a", workspaceId: "workspace", lifecycle: "connection-a"), evaluate: { try await tampered($0) })
            do { _ = try await bad.decide(vectors[0].observed); XCTFail("Accepted forged \(field)") } catch {}
        }
        let next = LocalVaultMirrorPolicy(digest: manifest.digest,
            scope: LocalVaultMirrorScope(accountId: "account-b", workspaceId: "other", lifecycle: "connection-b"), evaluate: { try await evaluate($0) })
        let switched = try await next.decide(vectors[0].observed)
        XCTAssertEqual(switched, vectors[0].disposition)
        do { _ = try await policy.decide(vectors[0].observed); XCTFail("Replaced connection accepted work") } catch {}
        try await reload()
        do { _ = try await next.decide(vectors[0].observed); XCTFail("Old adapter adopted a new page") } catch {}
        let production = try controller.policyFactory(LocalVaultSyncBinding(origin: URL(string: "https://policy.test")!, workspaceId: "workspace"),
            LocalVaultAccountCredential(origin: URL(string: "https://policy.test")!, token: "isolated-not-a-token", accountId: "account-a"))
        try await production.ready()
        for vector in vectors {
            let action = try await production.decide(vector.observed)
            XCTAssertEqual(action, vector.disposition, "Production policy factory: " + vector.name)
        }
        await production.retire()
        try await exerciseEngine(root: root.appendingPathComponent("engine"), digest: manifest.digest, evaluate: evaluate, reload: reload)
    }

    @MainActor
    private func exerciseEngine(root: URL, digest: String,
        evaluate: @escaping @MainActor @Sendable (String) async throws -> String,
        reload: @escaping @MainActor @Sendable () async throws -> Void) async throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let id = "f1111111-1111-4111-8111-111111111111", file = root.appendingPathComponent("Note.textpack")
        func pack(_ body: String) throws -> Data {
            let scratch = root.appendingPathComponent(".fixture-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: scratch) }
            let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
            let bundle = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\(body)",
                documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
            return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: bundle.url, in: scratch))
        }
        func policy(_ hook: MirrorDecisionHook) -> LocalVaultMirrorPolicy {
            let callback: @MainActor @Sendable (String) async throws -> String = { script in
                if script.contains(".evaluate(") { hook.calls += 1; let before = hook.before; hook.before = nil; try await before?() }
                return try await evaluate(script)
            }
            return LocalVaultMirrorPolicy(digest: digest,
                scope: LocalVaultMirrorScope(accountId: "account-a", workspaceId: "workspace", lifecycle: UUID().uuidString), evaluate: { try await callback($0) })
        }
        let initial = try pack("Original"); try initial.write(to: file)
        let remote = MirrorFixtureTransport(itemId: id, data: initial)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://policy.test")!, workspaceId: "workspace")
        let hook = MirrorDecisionHook()
        let engine = try LocalVaultSync(root: root, binding: binding, transport: remote, mirrorPolicy: policy(hook))
        _ = try await engine.sync()
        let local = try pack("Local edit"); try local.write(to: file, options: .atomic)
        var report = try await engine.sync(); XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        let uploaded = await remote.snapshot(); XCTAssertEqual(uploaded, local); XCTAssertGreaterThan(hook.calls, 0)
        let received = try pack("Remote edit"); await remote.set(received)
        report = try await engine.sync(); XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        XCTAssertEqual(try Data(contentsOf: file), received)
        try pack("Captured edit").write(to: file, options: .atomic)
        let newer = try pack("Newer external edit")
        hook.before = {
            let competitor = try LocalVaultSync(root: root, binding: binding, transport: remote, mirrorPolicy: policy(MirrorDecisionHook()))
            do { _ = try await competitor.sync(); XCTFail("Workspace lease released during policy await") } catch {}
            try newer.write(to: file, options: .atomic)
        }
        report = try await engine.sync(); XCTAssertFalse(report.errors.isEmpty)
        XCTAssertEqual(try Data(contentsOf: file), newer)
        var server = await remote.snapshot(); XCTAssertEqual(server, received)
        report = try await engine.sync(); XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        server = await remote.snapshot(); XCTAssertEqual(server, newer)
        let pending = try pack("Pending through page replacement"); try pending.write(to: file, options: .atomic)
        hook.before = reload
        report = try await engine.sync(); XCTAssertFalse(report.errors.isEmpty)
        XCTAssertEqual(try Data(contentsOf: file), pending)
        server = await remote.snapshot(); XCTAssertEqual(server, newer)
        let resumed = try LocalVaultSync(root: root, binding: binding, transport: remote, mirrorPolicy: policy(MirrorDecisionHook()))
        report = try await resumed.sync(); XCTAssertTrue(report.errors.isEmpty, "\(report.errors)")
        server = await remote.snapshot(); XCTAssertEqual(server, pending); XCTAssertEqual(try Data(contentsOf: file), pending)
    }
}

@MainActor private final class MirrorDecisionHook {
    var calls = 0
    var before: (@MainActor @Sendable () async throws -> Void)?
}
private actor MirrorFixtureTransport: LocalVaultSyncTransport {
    let itemId: String
    private var data: Data
    init(itemId: String, data: Data) { self.itemId = itemId; self.data = data }
    func snapshot() -> Data { data }
    func set(_ next: Data) { data = next }
    func manifest() async throws -> [LocalVaultRemoteItem] { [LocalVaultRemoteItem(itemId: itemId, relativePath: "Note.textpack", revision: TextTextStableDigest.sha256Hex(data))] }
    func download(itemId: String) async throws -> LocalVaultRemotePack { LocalVaultRemotePack(data: data, relativePath: "Note.textpack", revision: TextTextStableDigest.sha256Hex(data)) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String {
        guard baseRevision == TextTextStableDigest.sha256Hex(self.data) else { throw LocalVaultSyncFailure.conflict }
        self.data = data; return TextTextStableDigest.sha256Hex(data)
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
