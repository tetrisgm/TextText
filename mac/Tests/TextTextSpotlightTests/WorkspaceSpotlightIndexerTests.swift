import CoreSpotlight
import Foundation
import XCTest
import TextTextSpotlight

final class WorkspaceSpotlightIndexerTests: XCTestCase {
    func testAttributeMappingUsesCanonicalMetadataAndDeepLink() throws {
        let document = WorkspaceSpotlightDocument(
            textTextId: "texttext-1",
            workspaceHandle: "demo",
            title: "Spotlight Note",
            kind: "article",
            status: "published",
            canonicalURL: "https://example.invalid/p/spotlight",
            relativePath: "Demo/Blog/Spotlight Note.textpack",
            fileURL: URL(fileURLWithPath: "/tmp/Spotlight Note.textpack"),
            textContent: "Body text for search.",
            keywords: ["alpha", "beta"],
            modifiedAt: Date(timeIntervalSince1970: 100)
        )

        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)

        XCTAssertEqual(attributes.title, "Spotlight Note")
        XCTAssertEqual(attributes.textContent, "Body text for search.")
        XCTAssertEqual(attributes.kind, "article")
        XCTAssertEqual(attributes.containerIdentifier, "Demo/Blog")
        XCTAssertEqual(attributes.contentModificationDate, Date(timeIntervalSince1970: 100))
        XCTAssertEqual(Set(attributes.keywords ?? []), Set(["alpha", "beta", "article", "published", "Demo/Blog", "demo"]))
        XCTAssertEqual(attributes.relatedUniqueIdentifier, "texttext-1")
    }

    func testInternalWorkspacePathsAreExcluded() throws {
        let document = WorkspaceSpotlightDocument(
            textTextId: "hidden",
            workspaceHandle: "demo",
            title: "Hidden",
            kind: "note",
            status: "draft",
            relativePath: ".texttext/state/hidden.md",
            fileURL: URL(fileURLWithPath: "/tmp/hidden.md")
        )

        XCTAssertNil(WorkspaceSpotlightIndexer.searchableItem(for: document))
    }

    func testDeepLinkCarriesTheTextTextId() throws {
        let document = WorkspaceSpotlightDocument(
            textTextId: "abc-123",
            workspaceHandle: "demo",
            title: "A",
            kind: "note",
            status: "draft",
            relativePath: "Demo/Notes/A.textpack",
            fileURL: URL(fileURLWithPath: "/tmp/A.textpack")
        )
        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)
        XCTAssertEqual(attributes.url, URL(string: "texttext-app://item/abc-123"))
    }

    func testIdentityMetadataNeverBecomesSearchableContent() throws {
        let document = WorkspaceSpotlightDocument(
            textTextId: "secret-id",
            workspaceHandle: "demo",
            title: "Visible Title",
            kind: "note",
            status: "draft",
            relativePath: "Demo/Notes/Visible Title.textpack",
            fileURL: URL(fileURLWithPath: "/tmp/Visible Title.textpack"),
            textContent: "Visible body."
        )
        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)
        let haystack = [attributes.textContent, attributes.contentDescription, attributes.title]
            .compactMap { $0 }.joined(separator: " ")
        XCTAssertFalse(haystack.contains("secret-id"), "identity id must not be indexed as content")
        XCTAssertFalse(haystack.contains("texttext.markdown-file.v1"))
        XCTAssertEqual(attributes.title, "Visible Title")
    }

}
