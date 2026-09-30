import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultAgentFilesTests: XCTestCase {
    func testPreviewMarksOnlyIncompleteBindingsAndPreservesScalarWhitespace() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try LocalVaultAgentFiles.perform("create_file", arguments: ["title": "Preview", "body": ""], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let initial = try store.read(path: "Preview.textpack")
        var snapshot = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(initial.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(snapshot["content"] as? [String: Any])
        content["fields"] = ["annotations": [["quote": "Saved highlight"]], "description": String(repeating: "x", count: 2049), "category": "  Research  notes  "]
        snapshot["content"] = content
        let changed = try store.write(path: initial.path, expectedHash: initial.hash, markdown: initial.contents.markdown,
            documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self), templateJSON: initial.contents.templateJSON, templateAuthoringSourceJSON: initial.contents.templateAuthoringSourceJSON)
        let preview = try LocalVaultWindowController.preview(changed)
        let incomplete = try XCTUnwrap(preview["incompleteFields"] as? [String])
        XCTAssertTrue(incomplete.contains("content.fields.annotations"))
        XCTAssertTrue(incomplete.contains("content.fields.description"))
        XCTAssertFalse(incomplete.contains("title"))
        XCTAssertFalse(incomplete.contains("content.fields.category"))
        let projected = try XCTUnwrap(preview["document"] as? [String: Any])
        let projectedContent = try XCTUnwrap(projected["content"] as? [String: Any])
        let fields = try XCTUnwrap(projectedContent["fields"] as? [String: Any])
        XCTAssertEqual(fields["category"] as? String, "  Research  notes  ")
    }

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

    func testTemplateProposalPreservesBytesAndAllowsNewTemplateIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try LocalVaultAgentFiles.perform("create_file", arguments: ["title": "Preview", "body": "Keep this content."], root: root)
        let store = LocalVaultDocumentStore(root: root), path = "Preview.textpack"
        let original = try store.read(path: path)
        let bytes = try Data(contentsOf: store.url(for: path))
        var template = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(original.contents.templateJSON).utf8)) as? [String: Any])
        template["id"] = "custom.preview"
        template["version"] = 2
        let json = String(decoding: try JSONSerialization.data(withJSONObject: template), as: UTF8.self)
        let result = try LocalVaultAgentFiles.perform("propose_template", arguments: [
            "path": path, "hash": original.hash, "templateJSON": json,
            "templateAuthoringSourceJSON": "{\"schemaVersion\":1}"
        ], root: root, customizationPath: path)
        let proposal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any])
        XCTAssertEqual(proposal["path"] as? String, path)
        XCTAssertEqual(proposal["hash"] as? String, original.hash)
        XCTAssertEqual(proposal["templateJSON"] as? String, json)
        XCTAssertEqual(proposal["templateAuthoringSourceJSON"] as? String, "{\"schemaVersion\":1}")
        XCTAssertEqual(try Data(contentsOf: store.url(for: path)), bytes)
        XCTAssertEqual(try store.list(), [path])
        for invalid in ["{}", "[]", "not JSON"] {
            XCTAssertThrowsError(try LocalVaultAgentFiles.perform("propose_template", arguments: [
                "path": path, "hash": original.hash, "templateJSON": invalid
            ], root: root))
        }
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("propose_template", arguments: [
            "path": path, "hash": "stale", "templateJSON": json
        ], root: root))
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("propose_template", arguments: [
            "path": path, "hash": original.hash, "templateJSON": json, "templateAuthoringSourceJSON": "[]"
        ], root: root))
        XCTAssertEqual(try Data(contentsOf: store.url(for: path)), bytes)
    }

    func testCustomizationCannotWriteCreateOrProposeAnotherFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        for tool in ["write_file", "create_file"] {
            XCTAssertThrowsError(try LocalVaultAgentFiles.perform(tool, arguments: [
                "path": "Other.textpack", "title": "Other", "body": "Do not create", "markdown": "Do not write", "hash": "unused"
            ], root: root, customizationPath: "Selected.textpack"))
        }
        XCTAssertThrowsError(try LocalVaultAgentFiles.perform("propose_template", arguments: [
            "path": "Other.textpack", "hash": "unused", "templateJSON": "{}"
        ], root: root, customizationPath: "Selected.textpack"))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

}
