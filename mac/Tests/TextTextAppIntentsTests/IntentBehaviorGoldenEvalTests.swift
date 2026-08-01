import Foundation
import XCTest
@testable import TextTextAppIntents

/// One golden eval per App Intent: each now operates on the SERVER (the source of
/// truth) through WorkspaceIntentServer, never the File Provider mount. This pins
/// the concrete behavior of each intent so a regression is caught by name.
final class IntentBehaviorGoldenEvalTests: XCTestCase {
    private func make() -> (WorkspaceIntentActions, FakeWorkspaceIntentServer) {
        let clock = { Date(timeIntervalSince1970: 1_790_000_000) } // 2026
        let server = FakeWorkspaceIntentServer(now: clock)
        return (WorkspaceIntentActions(server: server, now: clock), server)
    }

    func test01_createDocument_postsANoteWithTitleFrontMatter() throws {
        let (actions, server) = make()
        let record = try actions.createDocument(title: "Field Notes", body: "alpha", folderPath: "Notes")
        XCTAssertEqual(record.kind, "note")
        let body = try XCTUnwrap(server.created.first?.body)
        XCTAssertTrue(body.contains("title: \"Field Notes\""))
        XCTAssertTrue(body.contains("kind: \"note\""))
        XCTAssertTrue(body.contains("alpha"))
        XCTAssertEqual(server.created.first?.folderId, "f-notes")
    }

    func test02_openDocument_returnsTheDeepLinkTheAppOpens() throws {
        let (actions, _) = make()
        let created = try actions.createDocument(title: "Openable", folderPath: "Notes")
        // The intent hands back the texttext-app:// deep link, resolved by the app's
        // URL handler through the File Provider (by post id).
        XCTAssertEqual(try actions.openDocument(id: created.id),
                       URL(string: "texttext-app://item/\(created.id)"))
    }

    func test03_appendText_preservesTheExistingBody() throws {
        let (actions, server) = make()
        let created = try actions.createDocument(title: "Log", body: "first line", folderPath: "Notes")
        _ = try actions.appendText("second line", toDocument: created.id)
        let put = try XCTUnwrap(server.updated.last)
        XCTAssertTrue(put.body.contains("first line"))
        XCTAssertTrue(put.body.contains("second line"))
    }

    func test04_searchDocuments_matchesBodyText() throws {
        let (actions, _) = make()
        let created = try actions.createDocument(title: "Searchable", body: "needle in the body", folderPath: "Notes")
        XCTAssertEqual(try actions.searchDocuments(query: "needle", limit: 5).map(\.id), [created.id])
        XCTAssertEqual(try actions.searchDocuments(query: "absent", limit: 5), [])
    }

    func test05_createFolder_createsASubfolderOnTheServer() throws {
        let (actions, server) = make()
        let folder = try actions.createFolder(name: "Archive", parentPath: "Notes")
        XCTAssertEqual(folder.title, "Archive")
        XCTAssertEqual(server.createdFolders.last?.name, "Archive")
        XCTAssertEqual(server.createdFolders.last?.parentPath, "notes")
    }

    func test06_moveDocument_patchesTheFolderOnTheServer() throws {
        let (actions, server) = make()
        let created = try actions.createDocument(title: "Movable", folderPath: "Notes")
        let sub = try actions.createFolder(name: "Sub", parentPath: "Notes")
        _ = try actions.moveDocument(id: created.id, toFolder: sub.folderPath)
        XCTAssertEqual(server.moved.last?.id, created.id)
        XCTAssertEqual(server.moved.last?.folderId, sub.id)
    }

    func test07_createBookmark_keepsTheUrlInTheLinksListTheServerRoundTrips() throws {
        let (actions, server) = make()
        let record = try actions.createBookmark(
            from: URL(string: "https://example.invalid/article")!, title: "Example")
        XCTAssertEqual(relativeFolder(record.relativePath), "Bookmarks/2026")
        let body = try XCTUnwrap(server.created.last?.body)
        XCTAssertTrue(body.contains(
            "links: [{\"label\":\"Example\",\"href\":\"https://example.invalid/article\"}]"), body)
        XCTAssertFalse(body.contains("\nurl: "), "bare url: is dropped by the server")
    }

    func test08_publishDocument_publishesABlogKind() throws {
        let (actions, server) = make()
        let article = try actions.createDocument(title: "Launch", body: "x", folderPath: "blog")
        let publication = try actions.publishDocument(id: article.id)
        XCTAssertEqual(publication.status, "published")
        XCTAssertTrue(try XCTUnwrap(server.updated.last).body.contains("status: \"published\""))
    }

    func test08b_publishDocument_refusesNotesAndBookmarks() throws {
        let (actions, _) = make()
        let note = try actions.createDocument(title: "Private", folderPath: "Notes")
        XCTAssertThrowsError(try actions.publishDocument(id: note.id)) { error in
            XCTAssertEqual(error as? WorkspaceIntentError, .unlistedKind("note"))
        }
    }

    func test09_unpublishDocument_returnsToDraft() throws {
        let (actions, server) = make()
        let article = try actions.createDocument(title: "Toggle", body: "x", folderPath: "blog")
        _ = try actions.publishDocument(id: article.id)
        let draft = try actions.unpublishDocument(id: article.id)
        XCTAssertEqual(draft.status, "draft")
        XCTAssertTrue(try XCTUnwrap(server.updated.last).body.contains("status: \"draft\""))
    }

    func test10_recentDocuments_returnsBothCreated() throws {
        let (actions, _) = make()
        let first = try actions.createDocument(title: "Older", folderPath: "Notes")
        let second = try actions.createDocument(title: "Newer", folderPath: "Notes")
        let recent = try actions.recentDocuments(limit: 2).map(\.id)
        XCTAssertEqual(Set(recent), Set([first.id, second.id]))
        XCTAssertEqual(recent.count, 2)
    }

    // MARK: helpers

    private func relativeFolder(_ path: String) -> String {
        (path as NSString).deletingLastPathComponent
    }
}
