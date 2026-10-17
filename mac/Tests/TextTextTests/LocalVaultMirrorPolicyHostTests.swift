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
        func ready() async throws {
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
        view.reload(); try await Task.sleep(nanoseconds: 100_000_000); try await ready()
        do { _ = try await next.decide(vectors[0].observed); XCTFail("Old adapter adopted a new page") } catch {}
    }
}
