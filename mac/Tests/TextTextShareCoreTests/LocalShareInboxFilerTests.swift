import Foundation
import XCTest
@testable import TextTextApp
import TextTextShareCore
import TextTextFileProviderKit
import TextTextWorkspaceCore

final class LocalShareInboxFilerTests: XCTestCase {
    func testCaptureRetryAfterPublicationDoesNotDuplicateOrOverwrite() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let writer = InboxWriter(containerURL: base.appendingPathComponent("InboxContainer"))
        let item = InboxItem(kind: .bookmark, title: "Example", text: "Saved context", urlString: "https://example.com/")
        let first = try writer.write(item)
        let filer = LocalShareInboxFiler()
        let created = try filer.file(first, root: root)
        let bytes = try Data(contentsOf: created)
        XCTAssertEqual(created.deletingLastPathComponent().lastPathComponent, "Bookmarks")
        XCTAssertEqual(try filer.file(first, root: root), created)
        XCTAssertEqual(try Data(contentsOf: created), bytes)
        let second = try filer.file(writer.write(item), root: root)
        XCTAssertNotEqual(second, created)
        XCTAssertEqual(try Data(contentsOf: created), bytes)
        let otherRoot = base.appendingPathComponent("Other")
        try FileManager.default.createDirectory(at: otherRoot, withIntermediateDirectories: true)
        XCTAssertThrowsError(try filer.file(first, root: otherRoot))
        XCTAssertEqual(try InboxReader(containerURL: writer.containerURL).completeItems().count, 2)
    }

    func testUnsupportedShareRemainsInDurableInbox() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let writer = InboxWriter(containerURL: base)
        let record = try writer.write(InboxItem(kind: .file, text: "Keep me"))
        XCTAssertThrowsError(try LocalShareInboxFiler().file(record, root: base))
        let retained = try InboxReader(containerURL: base).completeItems()
        XCTAssertEqual(retained.count, 1)
        XCTAssertEqual(retained.first?.id, record.id)
        XCTAssertEqual(retained.first?.item, record.item)
    }

    func testSharedAttachmentPublishesCompletePackageAndBindsRetryToBytes() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let writer = InboxWriter(containerURL: base.appendingPathComponent("InboxContainer"))
        let bytes = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        let record = try writer.write(InboxItem(kind: .file, title: "Shared image"),
            payload: InboxPayload(filename: "image.png", data: bytes))
        let filer = LocalShareInboxFiler()
        let created = try filer.file(record, root: root)
        XCTAssertEqual(created.deletingLastPathComponent().lastPathComponent, "Gallery")
        let files = LocalVaultDocumentStore(root: root)
        let original = try files.read(path: "Gallery/" + created.lastPathComponent)
        XCTAssertTrue(original.contents.markdown.contains("kind: \"media_post\""))
        XCTAssertFalse(original.contents.markdown.contains("kind: \"gallery\""))
        XCTAssertEqual(original.contents.assets.count, 1)
        XCTAssertEqual(original.contents.assets.first?.data, bytes)
        let snapshot = try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(original.contents.documentJSON).utf8)) as! [String: Any]
        let content = snapshot["content"] as! [String: Any]
        let presentation = snapshot["presentation"] as! [String: Any]
        XCTAssertEqual((presentation["template"] as? [String: Any])?["id"] as? String, "texttext.gallery")
        let assets = content["assets"] as! [[String: Any]]
        XCTAssertEqual(assets.first?["kind"] as? String, "image")
        XCTAssertEqual(assets.first?["title"] as? String, "image.png")
        XCTAssertEqual(assets.first?["src"] as? String, "assets/" + original.contents.assets[0].filename)
        XCTAssertEqual(try filer.file(record, root: root), created)
        XCTAssertEqual(try files.read(path: original.path).hash, original.hash)
        try Data("different attachment".utf8).write(to: try XCTUnwrap(record.payloadURL))
        XCTAssertThrowsError(try filer.file(record, root: root))
        XCTAssertEqual(try files.read(path: original.path).hash, original.hash)
        XCTAssertEqual(try InboxReader(containerURL: writer.containerURL).completeItems().count, 1)
    }

    func testSharedPDFIsAnAttachedNoteAndMissingOrSymlinkPayloadStaysQueued() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let writer = InboxWriter(containerURL: base.appendingPathComponent("InboxContainer"))
        let pdf = Data("%PDF-1.4\nfixture".utf8)
        let record = try writer.write(InboxItem(kind: .file, text: "Keep this context"),
            payload: InboxPayload(filename: "Report.pdf", data: pdf))
        let filer = LocalShareInboxFiler()
        let created = try filer.file(record, root: root)
        let note = try LocalVaultDocumentStore(root: root).read(path: "Notes/" + created.lastPathComponent)
        XCTAssertEqual(created.lastPathComponent, "Report.textpack")
        XCTAssertTrue(note.contents.markdown.contains("Keep this context"))
        XCTAssertTrue(note.contents.markdown.contains("[Report.pdf](assets/"))
        XCTAssertEqual(note.contents.assets.first?.data, pdf)
        let unsafe = try writer.write(InboxItem(kind: .file), payload: InboxPayload(filename: "Other.pdf", data: pdf))
        let payload = try XCTUnwrap(unsafe.payloadURL)
        try FileManager.default.removeItem(at: payload)
        XCTAssertThrowsError(try filer.file(unsafe, root: root))
        try FileManager.default.createSymbolicLink(at: payload, withDestinationURL: created)
        XCTAssertThrowsError(try filer.file(unsafe, root: root))
        try FileManager.default.removeItem(at: payload)
        XCTAssertTrue(FileManager.default.createFile(atPath: payload.path, contents: Data()))
        let oversized = try FileHandle(forWritingTo: payload)
        try oversized.truncate(atOffset: 64 * 1_024 * 1_024 + 1)
        try oversized.close()
        XCTAssertThrowsError(try filer.file(unsafe, root: root))
    }

    func testAppendRetrySurvivesLaterFileEditsAndRename() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let root = base.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let writer = InboxWriter(containerURL: base.appendingPathComponent("InboxContainer"))
        let filer = LocalShareInboxFiler()
        let created = try filer.file(writer.write(InboxItem(kind: .note, title: "Original", text: "Original body")), root: root)
        let files = LocalVaultDocumentStore(root: root)
        let initial = try files.read(path: "Notes/" + created.lastPathComponent)
        let identity = try XCTUnwrap(MarkdownIdentityCodec.extract(from: initial.contents.markdown)?.itemId)
        let record = try writer.write(InboxItem(kind: .append, text: "Shared excerpt", targetTextTextId: identity))
        _ = try filer.file(record, root: root)
        let appended = try files.read(path: initial.path)
        XCTAssertEqual(appended.contents.markdown.components(separatedBy: "Shared excerpt").count, 2)
        let edited = try files.write(path: appended.path, expectedHash: appended.hash,
            markdown: appended.contents.markdown + "\nLater human edit",
            documentJSON: appended.contents.documentJSON, templateJSON: appended.contents.templateJSON,
            templateAuthoringSourceJSON: appended.contents.templateAuthoringSourceJSON)
        let moved = try files.rename(path: edited.path, expectedHash: edited.hash, newPath: "Notes/Moved.textpack")
        XCTAssertEqual(try filer.file(record, root: root).lastPathComponent, "Moved.textpack")
        let retried = try files.read(path: moved.path)
        XCTAssertEqual(retried.hash, moved.hash)
        XCTAssertTrue(retried.contents.markdown.contains("Later human edit"))
        XCTAssertEqual(retried.contents.markdown.components(separatedBy: "Shared excerpt").count, 2)
    }
}
