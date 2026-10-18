#if TEXTTEXT_STRESS_ACTOR
import AppKit
import WebKit
import XCTest
@testable import TextTextApp

// Real isolated NSWindow/WK guard fixture, not an authenticated six-client actor journey.
final class NativeStressWindowLifecycleTests: XCTestCase {
    @MainActor
    private func fixture(_ durability: String, hold: Bool = false) async throws -> (LocalVaultWindowController, WKWebView, URL) {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-window-guard-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let entry = root.appendingPathComponent("index.html")
        try """
        <html><body>Isolated actor window fixture<script>
        window.fixtureSession='original-mounted-session';window.calls=0;
        window.texttextFlushForNativeClose=async()=>{window.calls++;\(hold ? "return await new Promise(resolve=>window.releaseFlush=()=>resolve({ok:true,durability:\(durability)}));" : "return {ok:true,durability:\(durability)};")};
        </script></body></html>
        """.write(to: entry, atomically: true, encoding: .utf8)
        let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), credentials: { nil })
        let view = try XCTUnwrap(controller.window?.contentView as? WKWebView)
        controller.present()
        try await wait { (try? await view.evaluateJavaScript("typeof window.texttextFlushForNativeClose==='function'")) as? Bool == true }
        return (controller, view, root)
    }
    @MainActor
    private func wait(_ condition: () async throws -> Bool) async throws {
        for _ in 0..<250 {
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw CocoaError(.coderInvalidValue)
    }
    @MainActor
    func testActorCloseWaitsForProductionDurabilityThenReopensSameWindowAndView() async throws {
        let (controller, view, root) = try await fixture(#"{"outcome":"durable","workspaceId":"workspace","itemId":"item","lifecycle":"fixture-lifetime","generation":7}"#, hold: true)
        defer { controller.shutdown(); controller.close(); try? FileManager.default.removeItem(at: root) }
        let original = try XCTUnwrap(controller.window)
        let task = Task { @MainActor in
            try await NativeStressWindowLifecycle.close(controller: controller, webView: view, workspaceId: "workspace", itemId: "item", timeout: 5)
        }
        try await wait { (try? await view.evaluateJavaScript("window.calls===1&&typeof window.releaseFlush==='function'")) as? Bool == true }
        XCTAssertTrue(original.isVisible, "The real window must remain visible while production flush is pending.")
        _ = try await view.evaluateJavaScript("window.releaseFlush()")
        let receipt = try await task.value
        XCTAssertEqual(receipt["windowCloseObserved"] as? Bool, true)
        XCTAssertFalse(original.isVisible)
        XCTAssertTrue(controller.window === original)
        try await NativeStressWindowLifecycle.reopen(controller: controller, webView: view)
        XCTAssertTrue(original.isVisible)
        XCTAssertTrue(controller.window?.contentView === view)
        let retained = try await view.evaluateJavaScript("window.fixtureSession") as? String
        XCTAssertEqual(retained, "original-mounted-session")
    }
    @MainActor
    func testActorCloseRejectsDurabilityForAnotherFixtureAfterActualClose() async throws {
        let (controller, view, root) = try await fixture(#"{"outcome":"durable","workspaceId":"other","itemId":"item","lifecycle":"fixture-lifetime","generation":7}"#)
        defer { controller.shutdown(); controller.close(); try? FileManager.default.removeItem(at: root) }
        do { _ = try await NativeStressWindowLifecycle.close(controller: controller, webView: view, workspaceId: "workspace", itemId: "item", timeout: 5); XCTFail("Wrong fixture receipt must refuse acceptance") }
        catch { XCTAssertFalse(controller.window?.isVisible ?? true, "This checks a genuine close, not process termination.") }
    }
    @MainActor
    func testActorCloseRefusesPendingDurabilityAndLeavesWindowAvailable() async throws {
        let (controller, view, root) = try await fixture(#"{"outcome":"pending","workspaceId":"workspace","itemId":"item","lifecycle":"fixture-lifetime","generation":7}"#)
        defer { if let sheet = controller.window?.attachedSheet { controller.window?.endSheet(sheet) }; controller.shutdown(); controller.close(); try? FileManager.default.removeItem(at: root) }
        do { _ = try await NativeStressWindowLifecycle.close(controller: controller, webView: view, workspaceId: "workspace", itemId: "item", timeout: 5); XCTFail("Pending durability must refuse close") }
        catch { XCTAssertTrue(controller.window?.isVisible ?? false) }
    }
}
#endif
