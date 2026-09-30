import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultAgentFilesTests: XCTestCase {
    func testAgentCreatesReadsAndSafelyEditsTheActualPack() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try LocalVaultAgentFiles.perform("create_file", arguments: ["title": "Agent note", "body": "Original."], root: root)
        let path = "Agent note.textpack"
        let store = LocalVaultDocumentStore(root: root)
        let initial = try store.read(path: path)
        XCTAssertNotNil(initial.contents.templateJSON)
        let result = try LocalVaultAgentFiles.perform("read_file", arguments: ["path": path], root: root)
        XCTAssertTrue(result.contains("Original."))
        _ = try LocalVaultAgentFiles.perform("write_file", arguments: [
            "path": path, "hash": initial.hash, "markdown": "Agent edit."
        ], root: root)
        let changed = try store.read(path: path)
        XCTAssertTrue(changed.contents.markdown.contains("Agent edit."))
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("write_file", arguments: [
            "path": path, "hash": initial.hash, "markdown": "Stale replacement."
        ], root: root))
        XCTAssertEqual(try store.read(path: path).hash, changed.hash)
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("read_file", arguments: ["path": "../outside.textpack"], root: root))
    }
    func testCancelledQueuedWorkCannotCreateAFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fence = LocalVaultAgentCancellation()
        fence.cancel()
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("create_file", arguments: ["title": "Cancelled", "body": "Never saved"], root: root, cancellation: fence))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    func testMalformedTemplateCannotReplaceAFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try LocalVaultAgentFiles.perform("create_file", arguments: ["title": "Valid", "body": "Keep"], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let original = try store.read(path: "Valid.textpack")
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("write_file", arguments: [
            "path": "Valid.textpack", "hash": original.hash, "markdown": "Broken",
            "templateJSON": "{}"
        ], root: root))
        XCTAssertEqual(try store.read(path: "Valid.textpack").hash, original.hash)
    }

}
