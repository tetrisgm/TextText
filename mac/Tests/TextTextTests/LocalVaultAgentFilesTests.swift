import XCTest
import TextTextFileProviderKit
import ZIPFoundation
@testable import TextTextApp

final class LocalVaultAgentFilesTests: XCTestCase {
    func testStoryPreviewReadsPublicationFromTheTextPack() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Story", "body": "Published words"], root: root)
        let pack = root.appendingPathComponent("Story.textpack")
        let marker = root.appendingPathComponent("publication.json")
        let publishedAt = "2026-10-01T10:00:00.000Z"
        try Data("{\"schemaVersion\":1,\"status\":\"public\",\"publishedAt\":\"\(publishedAt)\",\"operationId\":\"release-1\"}".utf8).write(to: marker)
        do {
            let archive = try Archive(url: pack, accessMode: .update)
            let document = try XCTUnwrap(archive.first { $0.path == "document.json" || $0.path.hasSuffix("/document.json") })
            let prefix = String(document.path.dropLast("document.json".count))
            try archive.addEntry(with: prefix + "publication.json", fileURL: marker, compressionMethod: .deflate)
        }
        let store = LocalVaultDocumentStore(root: root)
        XCTAssertEqual(try LocalVaultWindowController.preview(store.readMetadata(path: "Story.textpack"))["publishedAt"] as? String, publishedAt)
        XCTAssertEqual(try LocalVaultWindowController.preview(store.read(path: "Story.textpack"))["publishedAt"] as? String, publishedAt)
    }

    func testStoryPreviewUsesSelectedFeaturedImageWithoutChangingStoryCover() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Story", "body": "A story with two images.\n\n![First](assets/first.png)\n\n![Second](assets/second.png)"], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let initial = try store.read(path: "Story.textpack")
        var snapshot = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(initial.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(snapshot["content"] as? [String: Any])
        content["assets"] = [
            ["id": "first", "kind": "image", "src": "assets/first.png", "contentType": "image/png"],
            ["id": "second", "kind": "image", "src": "assets/second.png", "contentType": "image/png"],
        ]
        var fields = content["fields"] as? [String: Any] ?? [:]
        fields["texttextFeaturedImage"] = "assets/second.png"
        content["fields"] = fields
        snapshot["content"] = content
        let updated = try store.write(path: initial.path, expectedHash: initial.hash, markdown: initial.contents.markdown,
            documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self),
            templateJSON: initial.contents.templateJSON, templateAuthoringSourceJSON: initial.contents.templateAuthoringSourceJSON)
        let images = [
            ("first.png", "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWMwzZsLRwzEcQAB0hQBRMWh9wAAAABJRU5ErkJggg=="),
            ("second.png", "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWPYVe4ARwzEcQBfkhcRwMvKgQAAAABJRU5ErkJggg=="),
        ]
        let archive = try Archive(url: root.appendingPathComponent(updated.path), accessMode: .update)
        let document = try XCTUnwrap(archive.first { $0.path == "document.json" || $0.path.hasSuffix("/document.json") })
        let prefix = String(document.path.dropLast("document.json".count))
        for (name, encoded) in images {
            let file = root.appendingPathComponent(name)
            try XCTUnwrap(Data(base64Encoded: encoded)).write(to: file)
            try archive.addEntry(with: prefix + "assets/" + name, fileURL: file, compressionMethod: .deflate)
        }
        let chosen = try LocalVaultWindowController.preview(store.read(path: updated.path))
        let chosenImage = try XCTUnwrap((chosen["image"] as? [String: String])?["data"])
        fields.removeValue(forKey: "texttextFeaturedImage")
        content["fields"] = fields
        snapshot["content"] = content
        let withDefault = try store.read(path: updated.path)
        let defaultFile = try store.write(path: withDefault.path, expectedHash: withDefault.hash, markdown: withDefault.contents.markdown,
            documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self),
            templateJSON: withDefault.contents.templateJSON, templateAuthoringSourceJSON: withDefault.contents.templateAuthoringSourceJSON)
        let firstImage = try XCTUnwrap((LocalVaultWindowController.preview(defaultFile)["image"] as? [String: String])?["data"])
        XCTAssertNotEqual(chosenImage, firstImage)
        XCTAssertNil((chosen["document"] as? [String: Any]).flatMap { $0["content"] as? [String: Any] }.flatMap { $0["fields"] as? [String: Any] }?["cover"])
    }

    func testOversizedGalleryPreviewKeepsPrimaryImageAndFittingTiles() throws {
        let thumbnail = ["contentType": "image/jpeg", "data": String(repeating: "A", count: 160_000)]
        var preview: [String: Any] = ["title": "Visual collection", "image": thumbnail,
                                      "images": [thumbnail, thumbnail, thumbnail]]
        try LocalVaultWindowController.fitPreviewImages(&preview)
        XCTAssertNotNil(preview["image"])
        XCTAssertEqual((preview["images"] as? [[String: String]])?.count, 2)
        XCTAssertLessThanOrEqual(try JSONSerialization.data(withJSONObject: preview).count, 512 * 1024)
    }

    func testPreviewMarksOnlyIncompleteBindingsAndPreservesScalarWhitespace() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Preview", "body": ""], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let initial = try store.read(path: "Preview.textpack")
        var snapshot = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(initial.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(snapshot["content"] as? [String: Any])
        content["subtitle"] = "A considered subtitle"
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
        XCTAssertEqual(projectedContent["subtitle"] as? String, "A considered subtitle")
        let fields = try XCTUnwrap(projectedContent["fields"] as? [String: Any])
        XCTAssertEqual(fields["category"] as? String, "  Research  notes  ")
        var presentation = try XCTUnwrap(snapshot["presentation"] as? [String: Any])
        presentation["template"] = ["id": "local.custom-note-look", "version": 1]
        snapshot["presentation"] = presentation
        var savedLook = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(initial.contents.templateJSON).utf8)) as? [String: Any])
        savedLook["id"] = "local.custom-note-look"
        savedLook["experience"] = "note"
        let custom = try store.write(path: changed.path, expectedHash: changed.hash, markdown: changed.contents.markdown,
            documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self),
            templateJSON: String(decoding: try JSONSerialization.data(withJSONObject: savedLook), as: UTF8.self),
            templateAuthoringSourceJSON: changed.contents.templateAuthoringSourceJSON)
        XCTAssertNil(try store.readMetadata(path: custom.path).contents.templateJSON)
        XCTAssertEqual(try store.readMetadata(path: custom.path, includeTemplate: true).contents.templateJSON, custom.contents.templateJSON)
        let customPreview = try LocalVaultWindowController.preview(custom)
        let customDocument = try XCTUnwrap(customPreview["document"] as? [String: Any])
        let customPresentation = try XCTUnwrap(customDocument["presentation"] as? [String: Any])
        let customReference = try XCTUnwrap(customPresentation["template"] as? [String: Any])
        XCTAssertEqual(customReference["id"] as? String, "local.custom-note-look")
    }

    func testAgentCreatesReadsAndSafelyEditsTheActualPack() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Agent note", "body": "Original."], root: root)
        let path = "Agent note.textpack"
        let store = LocalVaultDocumentStore(root: root)
        let initial = try store.read(path: path)
        XCTAssertNotNil(initial.contents.templateJSON)
        let result = try run("read_file", arguments: ["path": path], root: root)
        XCTAssertTrue(result.contains("Original."))
        _ = try run("write_file", arguments: [
            "path": path, "hash": initial.hash, "markdown": "Agent edit."
        ], root: root)
        let changed = try store.read(path: path)
        XCTAssertTrue(changed.contents.markdown.contains("Agent edit."))
        XCTAssertThrowsError(try run("write_file", arguments: [
            "path": path, "hash": initial.hash, "markdown": "Stale replacement."
        ], root: root))
        XCTAssertEqual(try store.read(path: path).hash, changed.hash)
        XCTAssertThrowsError(try run("read_file", arguments: ["path": "../outside.textpack"], root: root))
    }

    func testCurrentItemScopeAllowsOnlyTheExactTextPack() throws {
        let root = try temporaryVault()
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Selected", "body": "Selected body"], root: root)
        _ = try run("create_file", arguments: ["title": "Sibling", "body": "Private sibling"], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let selected = try store.read(path: "Selected.textpack")
        let access = LocalVaultAgentAccess.item(path: selected.path)

        XCTAssertTrue(try run("read_file", arguments: ["path": selected.path], root: root, access: access).contains("Selected body"))
        _ = try run("write_file", arguments: [
            "path": selected.path, "hash": selected.hash, "markdown": "Scoped edit"
        ], root: root, access: access)
        XCTAssertTrue(try store.read(path: selected.path).contents.markdown.contains("Scoped edit"))
        XCTAssertThrowsError(try run("read_file", arguments: ["path": "Sibling.textpack"], root: root, access: access))
        let sibling = try store.read(path: "Sibling.textpack")
        XCTAssertThrowsError(try run("write_file", arguments: [
            "path": sibling.path, "hash": sibling.hash, "markdown": "Denied"
        ], root: root, access: access))
        XCTAssertEqual(try store.read(path: sibling.path).hash, sibling.hash)
        for tool in ["list_files", "search_files", "create_file", "propose_template"] {
            XCTAssertThrowsError(try run(tool, arguments: [
                "query": "Private", "title": "Denied", "body": "Denied", "path": selected.path,
                "hash": selected.hash, "templateJSON": selected.contents.templateJSON ?? ""
            ], root: root, access: access))
        }
        XCTAssertEqual(toolNames(for: access), ["read_file", "write_file"])
    }

    func testFolderScopeListsSearchesReadsWritesAndCreatesOnlyInsideBoundary() throws {
        let root = try temporaryVault()
        defer { try? FileManager.default.removeItem(at: root) }
        for folder in ["Projects", "Projects/Nested", "Projects2"] {
            try FileManager.default.createDirectory(at: root.appendingPathComponent(folder), withIntermediateDirectories: true)
        }
        _ = try run("create_file", arguments: ["title": "Inside", "body": "scoped needle", "folder": "Projects"], root: root)
        _ = try run("create_file", arguments: ["title": "Deep", "body": "deep needle", "folder": "Projects/Nested"], root: root)
        _ = try run("create_file", arguments: ["title": "Outside", "body": "outside needle", "folder": "Projects2"], root: root)
        _ = try run("create_file", arguments: ["title": "Root", "body": "root needle"], root: root)
        let access = LocalVaultAgentAccess.folder(path: "Projects")

        let list = try json(try run("list_files", arguments: [:], root: root, access: access))
        XCTAssertEqual(Set(try XCTUnwrap(list["paths"] as? [String])), ["Projects/Inside.textpack", "Projects/Nested/Deep.textpack"])
        let search = try run("search_files", arguments: ["query": "needle"], root: root, access: access)
        XCTAssertTrue(search.contains("Projects/Inside.textpack"))
        XCTAssertTrue(search.contains("Projects/Nested/Deep.textpack"), search)
        XCTAssertFalse(search.contains("Projects2/Outside.textpack"))
        XCTAssertFalse(search.contains("Root.textpack"))

        let store = LocalVaultDocumentStore(root: root)
        let inside = try store.read(path: "Projects/Inside.textpack")
        _ = try run("write_file", arguments: [
            "path": inside.path, "hash": inside.hash, "markdown": "Folder edit"
        ], root: root, access: access)
        _ = try run("create_file", arguments: [
            "title": "Created", "body": "Created inside", "folder": "Projects/Nested"
        ], root: root, access: access)
        XCTAssertNoThrow(try store.read(path: "Projects/Nested/Created.textpack"))
        XCTAssertThrowsError(try run("read_file", arguments: ["path": "Projects2/Outside.textpack"], root: root, access: access))
        let outside = try store.read(path: "Projects2/Outside.textpack")
        XCTAssertThrowsError(try run("write_file", arguments: [
            "path": outside.path, "hash": outside.hash, "markdown": "Denied"
        ], root: root, access: access))
        XCTAssertEqual(try store.read(path: outside.path).hash, outside.hash)
        XCTAssertThrowsError(try run("create_file", arguments: [
            "title": "Escaped", "body": "Denied", "folder": "Projects2"
        ], root: root, access: access))
        XCTAssertEqual(toolNames(for: access), ["create_file", "list_files", "read_file", "search_files", "write_file"])
    }

    func testFolderScopeRejectsTraversalAbsolutePathsAndSiblingPrefixes() throws {
        let root = try temporaryVault()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Projects"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Projects2"), withIntermediateDirectories: true)
        _ = try run("create_file", arguments: ["title": "Inside", "body": "Inside", "folder": "Projects"], root: root)
        _ = try run("create_file", arguments: ["title": "Sibling", "body": "Sibling", "folder": "Projects2"], root: root)
        let access = LocalVaultAgentAccess.folder(path: "Projects")

        for path in ["../Projects2/Sibling.textpack", "Projects/../Projects2/Sibling.textpack",
                     "Projects2/Sibling.textpack", root.appendingPathComponent("Projects/Inside.textpack").path] {
            XCTAssertThrowsError(try run("read_file", arguments: ["path": path], root: root, access: access), path)
        }
        for folder in ["../Projects2", "Projects/../Projects2", "Projects2", "/tmp"] {
            XCTAssertThrowsError(try run("create_file", arguments: [
                "title": "Escaped", "body": "Denied", "folder": folder
            ], root: root, access: access), folder)
        }
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).list().sorted(),
                       ["Projects/Inside.textpack", "Projects2/Sibling.textpack"])
    }
    func testCancelledQueuedWorkCannotCreateAFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fence = LocalVaultAgentCancellation()
        fence.cancel()
        XCTAssertThrowsError(try run("create_file", arguments: ["title": "Cancelled", "body": "Never saved"], root: root, cancellation: fence))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    func testMalformedTemplateCannotReplaceAFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Valid", "body": "Keep"], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let original = try store.read(path: "Valid.textpack")
        XCTAssertThrowsError(try run("write_file", arguments: [
            "path": "Valid.textpack", "hash": original.hash, "markdown": "Broken",
            "templateJSON": "{}"
        ], root: root))
        XCTAssertEqual(try store.read(path: "Valid.textpack").hash, original.hash)
    }

    func testTemplateProposalPreservesBytesAndAllowsNewTemplateIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        _ = try run("create_file", arguments: ["title": "Preview", "body": "Keep this content."], root: root)
        let store = LocalVaultDocumentStore(root: root), path = "Preview.textpack"
        let original = try store.read(path: path)
        let bytes = try Data(contentsOf: store.url(for: path))
        var template = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap(original.contents.templateJSON).utf8)) as? [String: Any])
        template["id"] = "custom.preview"
        template["version"] = 2
        let json = String(decoding: try JSONSerialization.data(withJSONObject: template), as: UTF8.self)
        let result = try run("propose_template", arguments: [
            "path": path, "hash": original.hash, "templateJSON": json,
            "templateAuthoringSourceJSON": "{\"schemaVersion\":1}"
        ], root: root, access: .itemCustomization(path: path))
        let proposal = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any])
        XCTAssertEqual(proposal["path"] as? String, path)
        XCTAssertEqual(proposal["hash"] as? String, original.hash)
        XCTAssertEqual(proposal["templateJSON"] as? String, json)
        XCTAssertEqual(proposal["templateAuthoringSourceJSON"] as? String, "{\"schemaVersion\":1}")
        XCTAssertEqual(try Data(contentsOf: store.url(for: path)), bytes)
        XCTAssertEqual(try store.list(), [path])
        for invalid in ["{}", "[]", "not JSON"] {
            XCTAssertThrowsError(try run("propose_template", arguments: [
                "path": path, "hash": original.hash, "templateJSON": invalid
            ], root: root, access: .itemCustomization(path: path)))
        }
        XCTAssertThrowsError(try run("propose_template", arguments: [
            "path": path, "hash": "stale", "templateJSON": json
        ], root: root, access: .itemCustomization(path: path)))
        XCTAssertThrowsError(try run("propose_template", arguments: [
            "path": path, "hash": original.hash, "templateJSON": json, "templateAuthoringSourceJSON": "[]"
        ], root: root, access: .itemCustomization(path: path)))
        XCTAssertEqual(try Data(contentsOf: store.url(for: path)), bytes)
    }

    func testCustomizationScopesAreReadAndProposeOnly() throws {
        let root = try temporaryVault()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Projects"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Other"), withIntermediateDirectories: true)
        _ = try run("create_file", arguments: ["title": "Folder view", "body": "Design", "folder": "Projects"], root: root)
        _ = try run("create_file", arguments: ["title": "Member", "body": "Member content", "folder": "Projects"], root: root)
        _ = try run("create_file", arguments: ["title": "Outside", "body": "Outside content", "folder": "Other"], root: root)
        let store = LocalVaultDocumentStore(root: root)
        let design = try store.read(path: "Projects/Folder view.textpack")
        let member = try store.read(path: "Projects/Member.textpack")
        let folderAccess = LocalVaultAgentAccess.folderCustomization(
            folder: "Projects", designPath: design.path)

        XCTAssertTrue(try run("read_file", arguments: ["path": member.path], root: root, access: folderAccess).contains("Member content"))
        let list = try run("list_files", arguments: [:], root: root, access: folderAccess)
        XCTAssertTrue(list.contains(member.path)); XCTAssertFalse(list.contains("Other/Outside.textpack"))
        let search = try run("search_files", arguments: ["query": "content"], root: root, access: folderAccess)
        XCTAssertTrue(search.contains(member.path)); XCTAssertFalse(search.contains("Other/Outside.textpack"))
        _ = try run("propose_template", arguments: [
            "path": design.path, "hash": design.hash, "templateJSON": try XCTUnwrap(design.contents.templateJSON)
        ], root: root, access: folderAccess)
        XCTAssertThrowsError(try run("propose_template", arguments: [
            "path": member.path, "hash": member.hash, "templateJSON": try XCTUnwrap(member.contents.templateJSON)
        ], root: root, access: folderAccess))
        XCTAssertThrowsError(try run("read_file", arguments: ["path": "Other/Outside.textpack"], root: root, access: folderAccess))
        for tool in ["write_file", "create_file"] {
            XCTAssertThrowsError(try run(tool, arguments: [
                "path": member.path, "title": "Other", "body": "Do not create", "folder": "Projects",
                "markdown": "Do not write", "hash": member.hash
            ], root: root, access: folderAccess))
        }
        XCTAssertEqual(toolNames(for: folderAccess), ["list_files", "propose_template", "read_file", "search_files"])

        let itemAccess = LocalVaultAgentAccess.itemCustomization(path: member.path)
        XCTAssertTrue(try run("read_file", arguments: ["path": member.path], root: root, access: itemAccess).contains("Member content"))
        XCTAssertThrowsError(try run("read_file", arguments: ["path": design.path], root: root, access: itemAccess))
        XCTAssertThrowsError(try run("list_files", arguments: [:], root: root, access: itemAccess))
        XCTAssertThrowsError(try run("write_file", arguments: [
            "path": member.path, "hash": member.hash, "markdown": "Denied"
        ], root: root, access: itemAccess))
        XCTAssertEqual(toolNames(for: itemAccess), ["propose_template", "read_file"])
    }

    private func temporaryVault() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func run(_ name: String, arguments: [String: Any], root: URL,
                     access: LocalVaultAgentAccess = .folder(path: ""),
                     cancellation: LocalVaultAgentCancellation? = nil) throws -> String {
        try LocalVaultAgentFiles.perform(name, arguments: arguments, root: root,
                                         access: access, cancellation: cancellation)
    }

    private func json(_ value: String) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }

    private func toolNames(for access: LocalVaultAgentAccess) -> [String] {
        LocalVaultAgentFiles.tools(for: access).compactMap { $0["name"] as? String }.sorted()
    }

}
