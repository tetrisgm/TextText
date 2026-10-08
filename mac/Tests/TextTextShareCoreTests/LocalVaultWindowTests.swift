import AppKit
import WebKit
import XCTest
import TextTextCLICore
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultWindowTests: XCTestCase {
    @MainActor
    func testSelectingEmptyAccountFolderDoesNotSeedLocalTemplatesOrDocuments() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-no-local-seed-\(UUID().uuidString)")
        let root = temporary.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let entry = temporary.appendingPathComponent("index.html")
        try Data("<!doctype html><p>Fixture</p>".utf8).write(to: entry)
        let controller = LocalVaultWindowController(entry: entry, root: root,
            websiteDataStore: .nonPersistent(), credentials: { nil })
        defer { controller.close() }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [],
            "Folder selection waits for authoritative account provisioning, even when offline.")
    }

    @MainActor
    func testSignedInBundledEditorReadsWritesAndObservesRealFilesWhileOffline() async throws {
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
        let binding = try LocalVaultSyncBinding(origin: URL(string: "http://127.0.0.1:1")!, workspaceId: "offline-fixture")
        try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
        let capabilities = try JSONDecoder().decode(LocalVaultSyncCapabilities.self, from: Data(#"{"fullAccess":true,"canCreateContent":true,"writableFolders":[],"writableItems":[],"knownPaths":["Integration.textpack"],"writablePaths":["Integration.textpack"]}"#.utf8))
        try LocalVaultCapabilityCache.write(capabilities, root: root, binding: binding)
        let controller = LocalVaultWindowController(entry: entry, root: root,
            websiteDataStore: .nonPersistent(),
            credentials: { (origin: URL(string: "http://127.0.0.1:1")!, token: "offline-test-fixture") })
        defer { controller.close() }
        let view = try XCTUnwrap(controller.window?.contentView as? WKWebView)
        controller.showWindow(nil)
        try await until(view: view) {
            (try? await view.evaluateJavaScript("document.querySelector('nav[aria-label=\"Folders\"]') !== null && document.querySelector('section[aria-label=\"TextText account\"] small')?.textContent === 'Signed in'") as? Bool) == true
        }
        XCTAssertTrue(controller.openFile(target), "The native bridge should open a file inside its selected local root.")
        try await until(view: view) {
            (try? await view.evaluateJavaScript("document.querySelector('[aria-label=\"Note card\"]')?.innerText.includes('Original body.') === true && document.querySelector('button[aria-label=\"Edit card\"]') !== null") as? Bool) == true
        }
        _ = try await view.evaluateJavaScript("document.querySelector('button[aria-label=\"Edit card\"]').click()")
        try await until(view: view) {
            (try? await view.evaluateJavaScript("document.querySelector('[aria-label=\"Document body\"]')?.textContent?.trim()") as? String) == "Original body."
        }
        let signedInRemains = (try? await view.evaluateJavaScript("document.querySelector('section[aria-label=\"TextText account\"] small')?.textContent === 'Signed in'") as? Bool) == true
        XCTAssertTrue(signedInRemains,
            "A signed-in account must retain local editing while the server is offline.")
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
        let buttons = (try? await view.evaluateJavaScript("Array.from(document.querySelectorAll('button[aria-label]')).map(button => button.getAttribute('aria-label'))")) ?? "No button labels"
        let state = (try? await view.evaluateJavaScript("JSON.stringify({url: location.href, hash: location.hash, folders: !!document.querySelector('nav[aria-label=\\\"Folders\\\"]'), connection: document.querySelector('[aria-label=\\\"Web connection\\\"]')?.innerText, buttons: Array.from(document.querySelectorAll('button[aria-label]')).map(button => button.getAttribute('aria-label')), locations: Object.keys(localStorage).filter(key => key.startsWith('texttext:vault-location:')).map(key => [key, localStorage.getItem(key)])})")) ?? "No page state"
        XCTFail("The native file editor did not reach the expected state: \(rendered)\nButtons: \(buttons)\nState: \(state)")
        throw CocoaError(.coderInvalidValue)
    }
}
