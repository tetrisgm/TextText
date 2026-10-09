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
