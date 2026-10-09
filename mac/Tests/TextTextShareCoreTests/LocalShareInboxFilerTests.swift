import Foundation
import XCTest
@testable import TextTextApp
import TextTextShareCore

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
        let record = try writer.write(InboxItem(kind: .append, text: "Keep me", targetTextTextId: UUID().uuidString))
        XCTAssertThrowsError(try LocalShareInboxFiler().file(record, root: base))
        let retained = try InboxReader(containerURL: base).completeItems()
        XCTAssertEqual(retained.count, 1)
        XCTAssertEqual(retained.first?.id, record.id)
        XCTAssertEqual(retained.first?.item, record.item)
    }
}
