#if TEXTTEXT_STRESS_ACTOR
import WebKit
import XCTest
@testable import TextTextApp

// Isolated real WKWebView action contract, not an authenticated actor journey.
final class NativeStressReaderActionTests: XCTestCase {
    @MainActor
    private func view(_ reader: String) async throws -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: configuration)
        view.loadHTMLString("<html><body>\(reader)<script>window.clicks=0;function edit(){window.clicks++;document.body.innerHTML='<div contenteditable=true aria-label=\"Document body\">Original body</div>';}</script></body></html>", baseURL: nil)
        for _ in 0..<200 {
            if (try? await view.evaluateJavaScript("typeof window.edit==='function'")) as? Bool == true { return view }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        throw CocoaError(.coderInvalidValue)
    }
    @MainActor
    func testActualStoryReaderActionEntersEditorWithoutChangingBody() async throws {
        // VaultStoryDisplay renders text, with no aria-label.
        let view = try await view("<section class='vault-story-display'><div class='vault-story-display-actions'><button type='button' onclick='edit()'>Edit story</button></div></section>")
        let ready = try await view.evaluateJavaScript(NativeStressReaderAction.ready)
        XCTAssertEqual(ready as? Bool, true)
        _ = try await view.evaluateJavaScript(NativeStressReaderAction.activate)
        let result = try await view.evaluateJavaScript("document.querySelector('[aria-label=\"Document body\"]')?.textContent")
        XCTAssertEqual(result as? String, "Original body")
    }
    @MainActor
    func testActualNoteReaderActionEntersEditor() async throws {
        let view = try await view("<section class='vault-note-display'><div class='vault-note-display-actions'><button type='button' aria-label='Edit card' onclick='edit()'><svg></svg></button></div></section>")
        let ready = try await view.evaluateJavaScript(NativeStressReaderAction.ready)
        XCTAssertEqual(ready as? Bool, true)
        _ = try await view.evaluateJavaScript(NativeStressReaderAction.activate)
        let editable = try await view.evaluateJavaScript("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable")
        XCTAssertEqual(editable as? Bool, true)
    }
    @MainActor
    func testUnavailableAmbiguousAndUnrelatedActionsRefuseWithoutClicking() async throws {
        let story = "<section class='vault-story-display'><div class='vault-story-display-actions'><button onclick='edit()'>Edit story</button></div></section>"
        let fixtures = [
            "<section class='vault-story-display'>Read only</section>",
            story.replacingOccurrences(of: "<button", with: "<button disabled"),
            story.replacingOccurrences(of: "<button", with: "<button aria-disabled='true'"),
            story.replacingOccurrences(of: "<section", with: "<section hidden"),
            story + story,
            "<button aria-label='Edit card' onclick='edit()'>Unrelated library action</button>",
            story.replacingOccurrences(of: "Edit story", with: "Edit another item")
        ]
        for html in fixtures {
            let view = try await view(html)
            let ready = try await view.evaluateJavaScript(NativeStressReaderAction.ready)
            let activated = try await view.evaluateJavaScript(NativeStressReaderAction.activate)
            let clicks = try await view.evaluateJavaScript("window.clicks")
            XCTAssertEqual(ready as? Bool, false)
            XCTAssertEqual(activated as? Bool, false)
            XCTAssertEqual(clicks as? Int, 0)
        }
    }
    @MainActor
    func testExistingVisibleEditorStaysMountedAndDoesNotClickReaderAction() async throws {
        let view = try await view("<div contenteditable=true aria-label='Document body'>Original body</div><section class='vault-story-display'><div class='vault-story-display-actions'><button onclick='edit()'>Edit story</button></div></section>")
        _ = try await view.evaluateJavaScript("window.original=document.querySelector('[aria-label=\"Document body\"]');true")
        for script in [NativeStressReaderAction.ready, NativeStressReaderAction.activate, NativeStressReaderAction.activate] {
            let result = try await view.evaluateJavaScript(script)
            XCTAssertEqual(result as? Bool, true)
        }
        let same = try await view.evaluateJavaScript("window.original===document.querySelector('[aria-label=\"Document body\"]')&&window.clicks===0")
        XCTAssertEqual(same as? Bool, true)
    }

}
#endif
