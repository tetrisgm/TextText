#if TEXTTEXT_STRESS_ACTOR
import WebKit
import XCTest
@testable import TextTextApp

final class NativeStressDocumentInspectionTests: XCTestCase {
    private let item = "11111111-1111-4111-8111-111111111111"
    private let title = "Six-client acceptance optional subtitle"
    private func snapshot(_ subtitle: Any? = nil) -> [String: Any] {
        var content: [String: Any] = ["title": title, "body": "Original body", "fields": ["author": "Original author"], "tags": ["kept"], "assets": [["id": "asset", "kind": "image", "src": "assets/square.jpg"]]]
        if let subtitle { content["subtitle"] = subtitle }
        return ["schemaVersion": 1, "content": content, "presentation": ["template": ["id": "texttext.article", "version": 1], "theme": ["kept": "original"]]]
    }
    private func json(_ value: Any) throws -> String { String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]), as: UTF8.self) }
    @MainActor
    private func view(_ document: [String: Any], subtitle: String = "", body: String = "Original body", selected: String? = nil, subtitlePresent: Bool = true) async throws -> WKWebView {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        let input = subtitlePresent ? "<textarea aria-label='Subtitle'></textarea>" : ""
        view.loadHTMLString("<section aria-label='Edit item' data-ai-item-id='\(selected ?? item)'>\(input)<div aria-label='Document body' contenteditable=true></div></section><script>window.fixture=\(try json(document));window.texttextDocumentInspection={version:1,read:()=>window.fixture};document.querySelector('[aria-label=\"Document body\"]').textContent=\(try json(body));const s=document.querySelector('textarea');if(s)s.value=\(try json(subtitle));window.ready=true;</script>", baseURL: nil)
        for _ in 0..<200 {
            if (try? await view.evaluateJavaScript("window.ready===true")) as? Bool == true { return view }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        throw CocoaError(.coderInvalidValue)
    }
    @MainActor
    func testActualWKAbsentOnlyComparisonPreservesOriginalFullSnapshot() async throws {
        for subtitle in [nil, "", "Existing subtitle"] as [String?] {
            let document = snapshot(subtitle), view = try await view(document, subtitle: subtitle ?? "")
            let script = try NativeStressDocumentInspection.script(itemId: item, workspaceId: "workspace", title: title)
            let inspected = try await view.evaluateJavaScript(script)
            let result = try XCTUnwrap(inspected as? [String: Any])
            XCTAssertEqual(result as NSDictionary, document as NSDictionary)
            let parsed = try NativeStressDocumentInspection.validate(try json(result), title: title)
            XCTAssertEqual(parsed as NSDictionary, document as NSDictionary)
            if subtitle == nil {
                XCTAssertNil((parsed["content"] as? [String: Any])?["subtitle"], "Readonly inspection must not insert the optional field.")
                let oldComparison = try await view.evaluateJavaScript("window.fixture.content.subtitle===document.querySelector('textarea').value")
                XCTAssertEqual(oldComparison as? Bool, false, "The original strict comparison rejects this genuine schema shape.")
            }
        }
    }
    @MainActor
    func testActualWKInvalidSubtitleAndVisibleIdentityMismatchesRefuse() async throws {
        var cases: [([String: Any], String, String, String?, Bool)] = [
            (snapshot(NSNull()), "", "Original body", nil, true),
            (snapshot(4), "", "Original body", nil, true),
            (snapshot(["wrong"]), "", "Original body", nil, true),
            (snapshot(), "Unexpected UI text", "Original body", nil, true),
            (snapshot("Saved"), "Different", "Original body", nil, true),
            (snapshot(), "", "Changed body", nil, true),
            (snapshot(), "", "Original body", "different-item", true),
            (snapshot(), "", "Original body", nil, false)
        ]
        var wrongTitle = snapshot(); var content = wrongTitle["content"] as! [String: Any]; content["title"] = "Other"; wrongTitle["content"] = content
        cases.append((wrongTitle, "", "Original body", nil, true))
        var future = snapshot(); future["schemaVersion"] = 2; cases.append((future, "", "Original body", nil, true))
        for (document, subtitle, body, selected, present) in cases {
            let view = try await view(document, subtitle: subtitle, body: body, selected: selected, subtitlePresent: present)
            let script = try NativeStressDocumentInspection.script(itemId: item, workspaceId: "workspace", title: title)
            let result = try await view.evaluateJavaScript(script)
            XCTAssertTrue(result is NSNull)
        }
    }
    func testNativeValidationRejectsNullNonstringMissingRequiredAndFutureSnapshots() throws {
        for subtitle in [NSNull(), 3, ["wrong"], ["wrong": "type"]] as [Any] {
            XCTAssertThrowsError(try NativeStressDocumentInspection.validate(try json(snapshot(subtitle)), title: title))
        }
        for key in ["title", "body"] {
            var doc = snapshot(); var content = doc["content"] as! [String: Any]; content.removeValue(forKey: key); doc["content"] = content
            XCTAssertThrowsError(try NativeStressDocumentInspection.validate(try json(doc), title: title))
        }
        for version in [true, 1.1, 2, "1"] as [Any] {
            var doc = snapshot(); doc["schemaVersion"] = version
            XCTAssertThrowsError(try NativeStressDocumentInspection.validate(try json(doc), title: title))
        }
        XCTAssertThrowsError(try NativeStressDocumentInspection.validate(String(repeating: " ", count: 262145), title: title))
    }
    func testFieldInputComparisonNormalizesOnlyAbsentSubtitleWithoutMutation() throws {
        let content = snapshot()["content"] as! [String: Any]
        XCTAssertEqual(try NativeStressDocumentInspection.fieldValue(content, field: "subtitle"), "")
        XCTAssertEqual(try NativeStressDocumentInspection.fieldValue(content, field: "body"), "Original body")
        XCTAssertNil(content["subtitle"])
        XCTAssertThrowsError(try NativeStressDocumentInspection.fieldValue([:], field: "body"))
        XCTAssertThrowsError(try NativeStressDocumentInspection.fieldValue(["subtitle": NSNull()], field: "subtitle"))
        XCTAssertThrowsError(try NativeStressDocumentInspection.fieldValue(["subtitle": 1], field: "subtitle"))
    }
}
#endif
