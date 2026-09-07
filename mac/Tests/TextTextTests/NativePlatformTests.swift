import AppKit
import UniformTypeIdentifiers
import XCTest
@testable import TextTextApp

final class NativePlatformTests: XCTestCase {
    func testMenuRejectsUnknownGroup() {
        XCTAssertNil(NativeMenuCommand(["id": "one", "title": "Run", "menu": "Unknown", "enabled": true]))
    }
    func testMenuMapsStandardShortcutAndState() throws {
        let command = try XCTUnwrap(NativeMenuCommand(["id": "new", "title": "New folder", "menu": "File", "enabled": false, "key": "n", "modifiers": ["command", "shift"], "checked": true]))
        XCTAssertEqual(command.key, "n")
        XCTAssertEqual(command.modifiers, [.command, .shift])
        XCTAssertFalse(command.enabled)
        XCTAssertTrue(command.checked)
    }
    func testRestorationOnlyAcceptsSameWorkspaceItemRoutes() {
        XCTAssertTrue(NativeWindowRestoration.accepts("/t/me/hello?edit=1", homePath: "/@me"))
        for path in ["//evil.test/t/me/hello", "https://evil.test", "/t/other/hello", "/signin?token=secret", "/t/me/hello?token=secret", "/t/me/../secret"] {
            XCTAssertFalse(NativeWindowRestoration.accepts(path, homePath: "/@me"), path)
        }
        XCTAssertFalse(NativeWindowRestoration.accepts("/t/me/hello", homePath: nil))
    }
    func testRestorationSeparatesAccountsAndOrigins() {
        let origin = URL(string: "https://texttext.test")!
        XCTAssertNotEqual(NativeWindowRestoration.key(origin: origin, homePath: "/@one"), NativeWindowRestoration.key(origin: origin, homePath: "/@two"))
        XCTAssertNil(AppDelegate.restoredItemPath(origin: origin, handle: "one", signedIn: false))
    }
    func testDropFiltersUnsupportedAndCredentialURLs() {
        for raw in ["https://example.test/page", "http://example.test"] { XCTAssertTrue(NativeItemDrop.accepts(URL(string: raw)!)) }
        for raw in ["javascript:alert(1)", "texttext-app://item/one", "https://user:pass@example.test", "file:///tmp/image.png"] { XCTAssertFalse(NativeItemDrop.accepts(URL(string: raw)!)) }
    }
    func testURLDropUsesCaptureCommandArguments() throws {
        let args = try NativeItemDrop.arguments(for: URL(string: "https://example.test/page")!)
        XCTAssertEqual(args["capture"] as? String, "https://example.test/page")
        XCTAssertNotNil(args["idempotency_key"])
    }
    func testFileDropUsesTheExternalImporterMetadataAndIdentity() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".md")
        defer { try? FileManager.default.removeItem(at: url) }
        try "---\ntitle: Metadata title\ncustom: value\n---\n\nBody".write(to: url, atomically: true, encoding: .utf8)
        let opened = try OpenFileHandler.externalNoteImport(for: url)
        let args = try NativeItemDrop.arguments(for: url)
        let repeated = try NativeItemDrop.arguments(for: url)
        XCTAssertEqual(args["title"] as? String, "Metadata title")
        XCTAssertEqual(args["body"] as? String, "\nBody")
        XCTAssertEqual(args["body"] as? String, opened.body)
        XCTAssertEqual(args["kind"] as? String, "note")
        XCTAssertEqual(args["idempotency_key"] as? String, opened.idempotencyKey)
        XCTAssertEqual(args["idempotency_key"] as? String, repeated["idempotency_key"] as? String)
        try "Changed".write(to: url, atomically: true, encoding: .utf8)
        XCTAssertNotEqual(args["idempotency_key"] as? String, try NativeItemDrop.arguments(for: url)["idempotency_key"] as? String)
    }
    func testDropBatchCollectsEveryFailureWithoutStopping() {
        let urls = (0..<20).map { URL(string: "https://example.test/\($0)")! }
        var attempts = 0
        let result = NativeItemDrop.importBatch(urls) { _ in
            attempts += 1
            throw CocoaError(.fileReadUnknown)
        }
        XCTAssertEqual(attempts, 20)
        XCTAssertEqual(result.failures.count, 20)
        XCTAssertTrue(result.imported.isEmpty)
    }
    func testDropBatchReportsOnlySuccessfulImports() {
        let urls = (0..<3).map { URL(string: "https://example.test/\($0)")! }
        let result = NativeItemDrop.importBatch(urls) { args in
            if args["capture"] as? String == urls[1].absoluteString { throw CocoaError(.fileReadUnknown) }
        }
        XCTAssertEqual(result.imported, ["0", "2"])
        XCTAssertEqual(result.failures.count, 1)
        XCTAssertTrue(result.failures[0].hasPrefix("1:"))
    }
    func testFullScreenTitleDescribesTheAvailableAction() {
        XCTAssertEqual(NativeWorkspaceMenu.fullScreenTitle(isFullScreen: false), "Enter full screen")
        XCTAssertEqual(NativeWorkspaceMenu.fullScreenTitle(isFullScreen: true), "Exit full screen")
    }
    func testFilePromiseSanitizesNameAndLoadsOnlyOnDemand() {
        var loaded = false
        let promise = NativeTextPackPromise(title: "../bad:name") { _ in loaded = true }
        XCTAssertFalse(promise.filename.contains("/"))
        XCTAssertFalse(promise.filename.contains(":"))
        XCTAssertTrue(promise.filename.hasSuffix(".textpack"))
        XCTAssertEqual(promise.fileType, UTType("org.textbundle.pack")?.identifier ?? UTType.data.identifier)
        XCTAssertFalse(loaded)
    }
}

extension NativePlatformTests {
    func testFilePromiseWritesTheRequestedFilename() throws {
        if ProcessInfo.processInfo.environment["TEXTTEXT_TEST_NO_SANDBOX_EXTENSIONS"] == "1" {
            throw XCTSkip("This test requires NSItemProvider to issue a macOS sandbox extension; run without TEXTTEXT_TEST_NO_SANDBOX_EXTENSIONS on an unrestricted Mac")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.textpack")
        let destination = root.appendingPathComponent("renamed.textpack")
        let content = Data("promised bytes".utf8)
        try content.write(to: source)
        let completed = expectation(description: "file promise")
        let provider = NativeTextPackPromise(title: "Document") { completion in completion(source, nil) }
        provider.filePromiseProvider(provider, writePromiseTo: destination) { error in
            XCTAssertNil(error)
            XCTAssertEqual(try? Data(contentsOf: destination), content)
            completed.fulfill()
        }
        wait(for: [completed], timeout: 5)
    }
}

extension NativePlatformTests {
    func testPromiseWriterPreservesBytesAndNeverOverwrites() throws {
        if ProcessInfo.processInfo.environment["TEXTTEXT_TEST_NO_SANDBOX_EXTENSIONS"] == "1" {
            throw XCTSkip("This test requires the macOS file coordination service; run without TEXTTEXT_TEST_NO_SANDBOX_EXTENSIONS on an unrestricted Mac")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source.textpack")
        let destination = root.appendingPathComponent("chosen.textpack")
        let content = Data("promised content".utf8)
        try content.write(to: source)
        try NativeTextPackPromise.writeFile(from: source, to: destination)
        XCTAssertEqual(try Data(contentsOf: destination), content)
        try Data("different".utf8).write(to: source)
        XCTAssertThrowsError(try NativeTextPackPromise.writeFile(from: source, to: destination))
        XCTAssertEqual(try Data(contentsOf: destination), content)
    }
}
