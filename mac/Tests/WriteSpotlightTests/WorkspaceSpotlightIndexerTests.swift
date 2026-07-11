import CoreSpotlight
import Foundation
import XCTest
import WriteSpotlight
import WriteWorkspaceCore

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
            writeId: "write-1",
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
        XCTAssertEqual(attributes.relatedUniqueIdentifier, "write-1")
    }

    func testInternalWorkspacePathsAreExcluded() throws {
        let document = WorkspaceSpotlightDocument(
            writeId: "hidden",
            entry: IndexEntry(hash: "hash", relativePath: ".write/state/hidden.md", fileMtime: nil, folderId: nil, kind: nil),
            relativePath: ".write/state/hidden.md",
            fileURL: URL(fileURLWithPath: "/tmp/hidden.md"),
            markdown: "hidden"
        )

        XCTAssertNil(WorkspaceSpotlightIndexer.searchableItem(for: document))
    }
}
