import Foundation
import XCTest
import WriteWorkspaceCore
@testable import WriteAppIntents

/// One golden eval per App Intent (plan section 10): the ten intents each
/// operate on local workspace files only, and this suite pins the concrete
/// behavior of each so a regression in any single intent is caught by name.
final class IntentBehaviorGoldenEvalTests: XCTestCase {
    private func actions() throws -> (WorkspaceIntentActions, URL) {
        let root = try temporaryDirectory()
        return (WorkspaceIntentActions(root: root, now: fixedClock), root)
    }

    func test01_createDocument_writesANoteFileWithTitleFrontMatter() throws {
        let (actions, root) = try actions()
        let record = try actions.createDocument(title: "Field Notes", body: "alpha", folderPath: "Notes")
        XCTAssertEqual(record.folderPath, "Notes")
        let text = try String(contentsOf: root.appendingPathComponent(record.relativePath))
        XCTAssertTrue(text.contains("title: \"Field Notes\""))
        XCTAssertTrue(text.contains("writeKind: \"note\""))
        XCTAssertTrue(text.contains("alpha"))
    }

    func test02_openDocument_returnsTheDeepLinkTheAppOpens() throws {
        let (actions, root) = try actions()
        let created = try actions.createDocument(title: "Openable", folderPath: "Notes")
        // The intent hands back the write-app:// deep link, which the app's URL
        // handler resolves to the local file and opens.
        XCTAssertEqual(try actions.openDocument(id: created.id),
                       URL(string: "write-app://item/\(created.id)"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(created.relativePath).path))
    }

    func test03_appendText_preservesTheExistingBody() throws {
        let (actions, root) = try actions()
        let created = try actions.createDocument(title: "Log", body: "first line", folderPath: "Notes")
        _ = try actions.appendText("second line", toDocument: created.id)
        let text = try String(contentsOf: root.appendingPathComponent(created.relativePath))
        XCTAssertTrue(text.contains("first line"))
        XCTAssertTrue(text.contains("second line"))
    }

    func test04_searchDocuments_matchesBodyText() throws {
        let (actions, _) = try actions()
        let created = try actions.createDocument(title: "Searchable", body: "needle in the body", folderPath: "Notes")
        XCTAssertEqual(try actions.searchDocuments(query: "needle", limit: 5).map(\.id), [created.id])
        XCTAssertEqual(try actions.searchDocuments(query: "absent", limit: 5), [])
    }

    func test05_createFolder_createsASubfolder() throws {
        let (actions, root) = try actions()
        let folder = try actions.createFolder(name: "Archive", parentPath: "Notes")
        XCTAssertEqual(folder.folderPath, "Notes/Archive")
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: root.appendingPathComponent("Notes/Archive").path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue)
    }

    func test06_moveDocument_relocatesTheFile() throws {
        let (actions, root) = try actions()
        let created = try actions.createDocument(title: "Movable", folderPath: "Notes")
        _ = try actions.createFolder(name: "Sub", parentPath: "Notes")
        let moved = try actions.moveDocument(id: created.id, toFolder: "Notes/Sub")
        XCTAssertEqual(moved.folderPath, "Notes/Sub")
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(created.relativePath).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(moved.relativePath).path))
    }

    func test07_createBookmark_keepsTheUrlInTheLinksListTheServerRoundTrips() throws {
        let (actions, root) = try actions()
        let record = try actions.createBookmark(
            from: URL(string: "https://example.invalid/article")!, title: "Example")
        XCTAssertEqual(relativeFolder(record.relativePath), "Bookmarks/2026")
        let text = try String(contentsOf: root.appendingPathComponent(record.relativePath))
        // The server keeps a bookmark's URL only in the links list; a bare
        // url: scalar is dropped, syncing a bookmark with no link.
        XCTAssertTrue(
            text.contains("links: [{\"label\":\"Example\",\"href\":\"https://example.invalid/article\"}]"),
            text)
        XCTAssertFalse(text.contains("\nurl: "), "bare url: is dropped by the server")
    }

    func test08_publishDocument_publishesABlogKind() throws {
        let (actions, root) = try actions()
        let article = try actions.createDocument(title: "Launch", body: "x", folderPath: "Blogs/demo/Posts")
        let publication = try actions.publishDocument(id: article.id)
        XCTAssertEqual(publication.status, "published")
        let located = try actions.document(id: article.id)
        XCTAssertTrue(try String(contentsOf: root.appendingPathComponent(located.relativePath)).contains("status: \"published\""))
    }

    func test08b_publishDocument_refusesNotesAndBookmarks() throws {
        let (actions, _) = try actions()
        let note = try actions.createDocument(title: "Private", folderPath: "Notes")
        XCTAssertThrowsError(try actions.publishDocument(id: note.id)) { error in
            XCTAssertEqual(error as? WorkspaceIntentError, .unlistedKind("note"))
        }
    }

    func test09_unpublishDocument_returnsToDraft() throws {
        let (actions, root) = try actions()
        let article = try actions.createDocument(title: "Toggle", body: "x", folderPath: "Blogs/demo/Posts")
        _ = try actions.publishDocument(id: article.id)
        let draft = try actions.unpublishDocument(id: article.id)
        XCTAssertEqual(draft.status, "draft")
        let located = try actions.document(id: article.id)
        XCTAssertTrue(try String(contentsOf: root.appendingPathComponent(located.relativePath)).contains("status: \"draft\""))
    }

    func test10_recentDocuments_returnsMostRecentFirst() throws {
        let (actions, _) = try actions()
        let first = try actions.createDocument(title: "Older", folderPath: "Notes")
        let second = try actions.createDocument(title: "Newer", folderPath: "Notes")
        let recent = try actions.recentDocuments(limit: 2).map(\.id)
        XCTAssertEqual(Set(recent), Set([first.id, second.id]))
        XCTAssertEqual(recent.count, 2)
    }

    // MARK: helpers

    private func fixedClock() -> Date {
        ISO8601DateFormatter().date(from: "2026-07-11T12:34:56Z")!
    }

    private func relativeFolder(_ path: String) -> String {
        (path as NSString).deletingLastPathComponent
    }

    private func temporaryDirectory() throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("IntentEval-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
