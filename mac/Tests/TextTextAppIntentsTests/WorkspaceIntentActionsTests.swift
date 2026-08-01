import Foundation
import XCTest
@testable import TextTextAppIntents

/// The App Intents actions now go through the SERVER (WorkspaceIntentServer), not
/// the File Provider mount. These exercise the create/append/move/search/publish
/// flow against an in-memory fake and assert what reached the sync API.
final class WorkspaceIntentActionsTests: XCTestCase {
    private func fixedClock() -> @Sendable () -> Date {
        { Date(timeIntervalSince1970: 1_790_000_000) }
    }

    private func make() -> (WorkspaceIntentActions, FakeWorkspaceIntentServer) {
        let server = FakeWorkspaceIntentServer(now: { Date(timeIntervalSince1970: 1_790_000_000) })
        return (WorkspaceIntentActions(server: server, now: fixedClock()), server)
    }

    func testCreateAppendMoveSearchRecentAndPublishFlipGoThroughTheServer() throws {
        let (actions, server) = make()

        let created = try actions.createDocument(
            title: "Research Note", body: "alpha body", folderPath: "Notes")
        XCTAssertEqual(created.title, "Research Note")
        XCTAssertEqual(created.kind, "note")
        // The POST reached the notes folder with title/kind frontmatter, no file.
        XCTAssertEqual(server.created.count, 1)
        XCTAssertEqual(server.created.first?.folderId, "f-notes")
        let postedBody = try XCTUnwrap(server.created.first?.body)
        XCTAssertTrue(postedBody.contains("title: \"Research Note\""))
        XCTAssertTrue(postedBody.contains("kind: \"note\""))
        XCTAssertTrue(postedBody.contains("alpha body"))

        let appended = try actions.appendText("beta line", toDocument: created.id)
        XCTAssertEqual(appended.id, created.id)
        // Append fetched then PUT the combined body with the fetched If-Match hash.
        let put = try XCTUnwrap(server.updated.last)
        XCTAssertEqual(put.id, created.id)
        XCTAssertTrue(put.body.contains("alpha body"))
        XCTAssertTrue(put.body.contains("beta line"))
        XCTAssertEqual(put.ifMatch, "h-\(created.id)-r1")

        // Search matches the appended body (fetched only when the title misses).
        let matches = try actions.searchDocuments(query: "beta", limit: 5)
        XCTAssertEqual(matches.map(\.id), [created.id])
        XCTAssertEqual(try actions.searchDocuments(query: "absent-term", limit: 5), [])

        let archive = try actions.createFolder(name: "Archive", parentPath: "Notes")
        XCTAssertEqual(server.createdFolders.last?.name, "Archive")
        let moved = try actions.moveDocument(id: created.id, toFolder: archive.folderPath)
        XCTAssertEqual(server.moved.last?.id, created.id)
        XCTAssertEqual(server.moved.last?.folderId, archive.id)

        let recent = try actions.recentDocuments(limit: 1)
        XCTAssertEqual(recent.first?.id, created.id)

        // Publishing operates on blog kinds; notes are unlisted forever.
        let article = try actions.createDocument(
            title: "Launch Post", body: "article body", folderPath: "blog")
        XCTAssertEqual(article.kind, "article")
        let publication = try actions.publishDocument(id: article.id)
        XCTAssertEqual(publication.status, "published")
        XCTAssertTrue(try XCTUnwrap(server.updated.last).body.contains("status: \"published\""))

        let draft = try actions.unpublishDocument(id: article.id)
        XCTAssertEqual(draft.status, "draft")
        XCTAssertTrue(try XCTUnwrap(server.updated.last).body.contains("status: \"draft\""))
    }

    func testPublishingANoteIsRefusedBeforeAnyServerWrite() throws {
        let (actions, server) = make()
        let note = try actions.createDocument(
            title: "Private Note", body: "stays private", folderPath: "Notes")
        let updatesBefore = server.updated.count

        XCTAssertThrowsError(try actions.publishDocument(id: note.id)) { error in
            XCTAssertEqual(error as? WorkspaceIntentError, .unlistedKind("note"))
        }
        XCTAssertEqual(
            server.updated.count, updatesBefore,
            "a refused publish must not PUT anything to the server")
    }

    func testCreateBookmarkPostsBookmarkMarkdownWithTheLinksList() throws {
        let (actions, server) = make()

        let bookmark = try actions.createBookmark(
            from: URL(string: "https://example.invalid/read")!, title: "Reading")

        XCTAssertEqual(bookmark.kind, "bookmark")
        XCTAssertTrue(bookmark.relativePath.hasPrefix("Bookmarks/2026/"))
        XCTAssertEqual(server.created.last?.folderId, "f-bookmarks")
        let body = try XCTUnwrap(server.created.last?.body)
        XCTAssertTrue(body.contains("type: \"bookmark\""))
        XCTAssertTrue(body.contains(
            "links: [{\"label\":\"Reading\",\"href\":\"https://example.invalid/read\"}]"))
        XCTAssertFalse(body.contains("\nurl: "), "bare url: is dropped by the server")
        XCTAssertTrue(body.contains("created_at:"))
    }

    func testActionsRequireSignIn() {
        // No server (signed out) -> every action throws notSignedIn.
        let actions = WorkspaceIntentActions(server: nil, now: fixedClock())
        XCTAssertThrowsError(try actions.createDocument(title: "x", folderPath: "Notes")) {
            XCTAssertEqual($0 as? WorkspaceIntentError, .notSignedIn)
        }
    }

    func testInvalidFolderPathsNeverFallBackToNotes() throws {
        let (actions, server) = make()

        XCTAssertThrowsError(
            try actions.createDocument(
                title: "Misfiled", folderPath: "Notes/Does Not Exist")
        ) { error in
            XCTAssertEqual(
                error as? WorkspaceIntentError,
                .invalidFolderPath("Notes/Does Not Exist"))
        }
        XCTAssertTrue(server.created.isEmpty)

        let note = try actions.createDocument(
            title: "Existing", folderPath: "Notes")
        XCTAssertThrowsError(
            try actions.moveDocument(id: note.id, toFolder: "Bogus")
        ) { error in
            XCTAssertEqual(
                error as? WorkspaceIntentError,
                .invalidFolderPath("Bogus"))
        }
        XCTAssertTrue(server.moved.isEmpty)

        XCTAssertThrowsError(
            try actions.createFolder(name: "Child", parentPath: "Bogus")
        ) { error in
            XCTAssertEqual(
                error as? WorkspaceIntentError,
                .invalidFolderPath("Bogus"))
        }
        XCTAssertTrue(server.createdFolders.isEmpty)
    }
}
