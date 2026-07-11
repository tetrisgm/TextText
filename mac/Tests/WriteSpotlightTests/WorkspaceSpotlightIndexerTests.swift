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

    func testDeepLinkCarriesTheWriteId() throws {
        let document = WorkspaceSpotlightDocument(
            writeId: "abc-123",
            entry: IndexEntry(hash: "h", relativePath: "Notes/a.md", fileMtime: nil, folderId: "notes", kind: "note"),
            relativePath: "Notes/a.md",
            fileURL: URL(fileURLWithPath: "/tmp/a.md"),
            markdown: "---\ntitle: \"A\"\n---\nbody"
        )
        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)
        XCTAssertEqual(attributes.url, URL(string: "write-app://item/abc-123"))
    }

    func testMachineFrontMatterKeysNeverBecomeSearchableContent() throws {
        let text = """
        ---
        writeId: "secret-id"
        writeFolderId: "notes"
        writeKind: "note"
        schema: "write.markdown-file.v1"
        title: "Visible Title"
        ---

        Visible body.
        """
        let document = WorkspaceSpotlightDocument(
            writeId: "secret-id",
            entry: IndexEntry(hash: "h", relativePath: "Notes/a.md", fileMtime: nil, folderId: "notes", kind: "note"),
            relativePath: "Notes/a.md",
            fileURL: URL(fileURLWithPath: "/tmp/a.md"),
            markdown: text
        )
        let attributes = WorkspaceSpotlightIndexer.attributeSet(for: document)
        let haystack = [attributes.textContent, attributes.contentDescription, attributes.title]
            .compactMap { $0 }.joined(separator: " ")
        XCTAssertFalse(haystack.contains("secret-id"), "identity id must not be indexed as content")
        XCTAssertFalse(haystack.contains("write.markdown-file.v1"))
        XCTAssertEqual(attributes.title, "Visible Title")
    }

    func testEvictedFileIsIndexedFromMetadataWithoutForcingADownload() throws {
        // An evicted iCloud file has no readable bytes yet; the indexer must
        // still produce a metadata-only item (title from the path, no body)
        // rather than dropping the item or blocking on a download.
        let root = try temporaryDirectory()
        let indexer = WorkspaceSpotlightIndexer(root: root)
        // No file written at Notes/evicted.md: reads fail exactly as an
        // evicted item would.
        let item = indexer.makeSearchableItem(
            writeId: "ev-1",
            entry: IndexEntry(hash: "h", relativePath: "Notes/evicted.md", fileMtime: 5, folderId: "notes", kind: "note")
        )
        let attributes = try XCTUnwrap(item?.attributeSet)
        XCTAssertEqual(item?.uniqueIdentifier, "ev-1")
        XCTAssertEqual(attributes.title, "evicted", "falls back to the filename stem")
        XCTAssertEqual(attributes.kind, "note")
    }

    private func temporaryDirectory() throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("WriteSpotlightEval-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
