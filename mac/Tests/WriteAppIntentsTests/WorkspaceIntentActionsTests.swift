import Foundation
import XCTest
import WriteWorkspaceCore
@testable import WriteAppIntents

final class WorkspaceIntentActionsTests: XCTestCase {
    func testCreateAppendMoveSearchRecentAndPublishFlipUseLocalWorkspace() throws {
        let root = try temporaryDirectory()
        let actions = WorkspaceIntentActions(root: root, now: fixedClock())

        let created = try actions.createDocument(
            title: "Research Note",
            body: "alpha body",
            folderPath: "Notes"
        )
        XCTAssertEqual(created.title, "Research Note")
        XCTAssertEqual(created.kind, "note")
        XCTAssertEqual(created.folderPath, "Notes")
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(created.relativePath).path))

        let appended = try actions.appendText("beta line", toDocument: created.id)
        let appendedText = try String(contentsOf: root.appendingPathComponent(appended.relativePath), encoding: .utf8)
        XCTAssertTrue(appendedText.contains("alpha body"))
        XCTAssertTrue(appendedText.contains("beta line"))

        let matches = try actions.searchDocuments(query: "beta", limit: 5)
        XCTAssertEqual(matches.map(\.id), [created.id])

        _ = try actions.createFolder(name: "Archive", parentPath: "Notes")
        let moved = try actions.moveDocument(id: created.id, toFolder: "Notes/Archive")
        XCTAssertEqual(moved.folderPath, "Notes/Archive")
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(created.relativePath).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(moved.relativePath).path))

        let recent = try actions.recentDocuments(limit: 1)
        XCTAssertEqual(recent.first?.id, created.id)

        // Publishing operates on blog kinds; notes are unlisted forever.
        let article = try actions.createDocument(
            title: "Launch Post",
            body: "article body",
            folderPath: "Blogs/demo/Posts"
        )
        let publication = try actions.publishDocument(id: article.id)
        XCTAssertEqual(publication.status, "published")
        let located = try actions.document(id: article.id)
        let publishedText = try String(contentsOf: root.appendingPathComponent(located.relativePath), encoding: .utf8)
        XCTAssertTrue(publishedText.contains("status: \"published\""))

        let draft = try actions.unpublishDocument(id: article.id)
        XCTAssertEqual(draft.status, "draft")
        let draftLocated = try actions.document(id: article.id)
        let draftText = try String(contentsOf: root.appendingPathComponent(draftLocated.relativePath), encoding: .utf8)
        XCTAssertTrue(draftText.contains("status: \"draft\""))

        let index = try XCTUnwrap(WorkspaceIndexStore.load(root: root))
        XCTAssertEqual(index.entries[created.id]?.relativePath, moved.relativePath)
    }

    func testPublishingANoteOrBookmarkIsRefusedAndLeavesBytesUnchanged() throws {
        let root = try temporaryDirectory()
        let actions = WorkspaceIntentActions(root: root, now: fixedClock())
        let note = try actions.createDocument(
            title: "Private Note",
            body: "stays private",
            folderPath: "Notes"
        )
        let path = root.appendingPathComponent(note.relativePath)
        let before = try Data(contentsOf: path)

        XCTAssertThrowsError(try actions.publishDocument(id: note.id)) { error in
            XCTAssertEqual(error as? WorkspaceIntentError, .unlistedKind("note"))
        }
        XCTAssertEqual(try Data(contentsOf: path), before, "a refused publish must not touch the file")
    }

    func testCreateBookmarkWritesBookmarkMarkdownUnderYearFolder() throws {
        let root = try temporaryDirectory()
        let actions = WorkspaceIntentActions(root: root, now: fixedClock())

        let bookmark = try actions.createBookmark(
            from: URL(string: "https://example.invalid/read")!,
            title: "Reading"
        )

        XCTAssertEqual(bookmark.kind, "bookmark")
        XCTAssertTrue(bookmark.relativePath.hasPrefix("Bookmarks/2026/"))
        let text = try String(contentsOf: root.appendingPathComponent(bookmark.relativePath), encoding: .utf8)
        XCTAssertTrue(text.contains("type: \"bookmark\""))
        XCTAssertTrue(text.contains("url: \"https:\\/\\/example.invalid\\/read\""))
        XCTAssertTrue(text.contains("created_at:"))
        XCTAssertNotNil(MarkdownIdentityCodec.extract(from: text))
    }

    private func fixedClock() -> @Sendable () -> Date {
        { Date(timeIntervalSince1970: 1_790_000_000) }
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("WriteAppIntentsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
