import CoreSpotlight
import Foundation
import XCTest
import TextTextSpotlight
import TextTextWorkspaceCore

final class WorkspaceSpotlightIndexerTests: XCTestCase {
    func testAttributeMappingUsesFrontMatterAndDeepLink() throws {
        let text = """
        ---
        title: "Spotlight Note"
        status: "published"
        tags: "alpha, beta"
        published_url: "https://example.invalid/p/spotlight"
        ---

        Body text for search.
        """
        let document = WorkspaceSpotlightDocument(
            textTextId: "texttext-1",
            entry: IndexEntry(hash: "hash", relativePath: "Blogs/demo/Posts/spotlight.md", fileMtime: 100, folderId: "blog", kind: "article"),
            relativePath: "Blogs/demo/Posts/spotlight.md",
            fileURL: URL(fileURLWithPath: "/tmp/spotlight.md"),
            markdown: text
        )

        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)

        XCTAssertEqual(attributes.title, "Spotlight Note")
        XCTAssertEqual(attributes.textContent, "Body text for search.")
        XCTAssertEqual(attributes.kind, "article")
        XCTAssertEqual(attributes.containerIdentifier, "Blogs/demo/Posts")
        XCTAssertEqual(attributes.contentModificationDate, Date(timeIntervalSince1970: 100))
        XCTAssertEqual(Set(attributes.keywords ?? []), Set(["alpha", "beta", "article", "published", "Blogs/demo/Posts", "demo"]))
        XCTAssertEqual(attributes.relatedUniqueIdentifier, "texttext-1")
    }

    func testInternalWorkspacePathsAreExcluded() throws {
        let document = WorkspaceSpotlightDocument(
            textTextId: "hidden",
            entry: IndexEntry(hash: "hash", relativePath: ".texttext/state/hidden.md", fileMtime: nil, folderId: nil, kind: nil),
            relativePath: ".texttext/state/hidden.md",
            fileURL: URL(fileURLWithPath: "/tmp/hidden.md"),
            markdown: "hidden"
        )

        XCTAssertNil(WorkspaceSpotlightIndexer.searchableItem(for: document))
    }

    func testDeepLinkCarriesTheTextTextId() throws {
        let document = WorkspaceSpotlightDocument(
            textTextId: "abc-123",
            entry: IndexEntry(hash: "h", relativePath: "Notes/a.md", fileMtime: nil, folderId: "notes", kind: "note"),
            relativePath: "Notes/a.md",
            fileURL: URL(fileURLWithPath: "/tmp/a.md"),
            markdown: "---\ntitle: \"A\"\n---\nbody"
        )
        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)
        XCTAssertEqual(attributes.url, URL(string: "texttext-app://item/abc-123"))
    }

    func testMachineFrontMatterKeysNeverBecomeSearchableContent() throws {
        let text = """
        ---
        textTextId: "secret-id"
        textTextFolderId: "notes"
        textTextKind: "note"
        schema: "texttext.markdown-file.v1"
        title: "Visible Title"
        ---

        Visible body.
        """
        let document = WorkspaceSpotlightDocument(
            textTextId: "secret-id",
            entry: IndexEntry(hash: "h", relativePath: "Notes/a.md", fileMtime: nil, folderId: "notes", kind: "note"),
            relativePath: "Notes/a.md",
            fileURL: URL(fileURLWithPath: "/tmp/a.md"),
            markdown: text
        )
        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)
        let haystack = [attributes.textContent, attributes.contentDescription, attributes.title]
            .compactMap { $0 }.joined(separator: " ")
        XCTAssertFalse(haystack.contains("secret-id"), "identity id must not be indexed as content")
        XCTAssertFalse(haystack.contains("texttext.markdown-file.v1"))
        XCTAssertEqual(attributes.title, "Visible Title")
    }

}
