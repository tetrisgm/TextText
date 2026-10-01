import AppKit
import WebKit
import XCTest
import TextTextCLICore
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultWindowTests: XCTestCase {
    @MainActor
    func testBundledEditorReadsWritesAndObservesRealFilesWithoutServer() async throws {
        _ = NSApplication.shared
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let entry = repository.appendingPathComponent("mac/build/LocalVault/index.html")
        guard FileManager.default.fileExists(atPath: entry.path) else {
            throw XCTSkip("Run node scripts/build-local-vault.mjs before the native editor integration test")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-native-vault-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let files = DocumentStore(root: root)
        let target = try files.create(title: "Integration", body: "Original body.")
        let controller = LocalVaultWindowController(entry: entry, root: root,
            starterTemplates: repository.appendingPathComponent("presets/builtin"))
        defer { controller.close() }
        let view = try XCTUnwrap(controller.window?.contentView as? WKWebView)
        controller.showWindow(nil)
        try await until(view: view) {
            (try? await view.evaluateJavaScript("document.querySelector('button[aria-label=\"Integration Workspace Open →\"]') !== null") as? Bool) == true
        }
        _ = try await view.evaluateJavaScript("document.querySelector('button[aria-label=\"Integration Workspace Open →\"]').click()")
        try await until(view: view) {
            (try? await view.evaluateJavaScript("document.querySelector('[aria-label=\"Document body\"]')?.textContent?.trim()") as? String) == "Original body."
        }
        _ = try await view.evaluateJavaScript("const body=document.querySelector('[aria-label=\"Document body\"]'); body.focus(); body.textContent='Human edited the real file.'; body.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));")
        try await until(view: view) { (try? files.readMarkdown(at: target).contains("Human edited the real file.")) == true }
        // Simulate an external editor atomically replacing text.md inside the
        // actual ZIP, without any app command, HTTP call, or database mutation.
        let temporary = root.appendingPathComponent(".external-edit")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        let before = try TextTextTextBundlePackage.read(from: target, in: temporary)
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: before.markdown.replacingOccurrences(of: "Human edited the real file.", with: "Agent edited the file directly."),
            documentJSON: before.documentJSON, templateJSON: before.templateJSON,
            assets: [], sourceURL: nil, in: temporary)
        let changed = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: temporary)
        try Data(contentsOf: changed).write(to: target, options: .atomic)
        try await until(view: view) {
            (try? await view.evaluateJavaScript("document.querySelector('[aria-label=\"Document body\"]')?.textContent?.trim()") as? String) == "Agent edited the file directly."
        }
        XCTAssertTrue(try files.readMarkdown(at: target).contains("Agent edited the file directly."))
        XCTAssertEqual(view.url?.standardizedFileURL, entry.standardizedFileURL)
    }

    @MainActor
    private func until(view: WKWebView, _ condition: () async throws -> Bool) async throws {
        for _ in 0..<240 {
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let rendered = (try? await view.evaluateJavaScript("document.body.innerText")) ?? "No page"
        XCTFail("The native file editor did not reach the expected state: \(rendered)")
        throw CocoaError(.coderInvalidValue)
    }
}
