import XCTest
@testable import WriteFileProviderKit

final class WriteItemMapperTests: XCTestCase {
    func testTopLevelFolderParentsToRoot() {
        let f = Fixtures.folder("blog", "Blog")
        let item = WriteItemMapper.item(for: f, readOnly: true)
        XCTAssertEqual(item.parentIdentifier, .rootContainer)
        XCTAssertEqual(item.identifier, .folder("blog"))
        XCTAssertEqual(item.typeIdentifier, WriteItem.folderTypeIdentifier)
    }

    func testSubfolderParentsToItsFolder() {
        let f = Fixtures.folder("drafts", "Drafts", parent: "blog")
        let item = WriteItemMapper.item(for: f, readOnly: true)
        XCTAssertEqual(item.parentIdentifier, .folder("blog"))
    }

    func testKindMapping() {
        let cases: [(String, WriteItemKind)] = [
            ("article", .article), ("project", .project), ("talk", .talk),
            ("note", .note), ("bookmark", .bookmark), ("weird", .other("weird")),
        ]
        for (raw, expected) in cases {
            let entry = Fixtures.entry(id: "x", file: "x.md", kind: raw, title: "X")
            let item = WriteItemMapper.item(for: entry, inFolder: "blog", readOnly: true)
            XCTAssertEqual(item?.kind, expected)
            XCTAssertEqual(item?.typeIdentifier, WriteItem.markdownTypeIdentifier)
        }
    }

    func testEntryWithoutIdIsSkipped() {
        let entry = WriteManifestItem(
            file: "x.md", kind: "note", slug: "x", title: "X", status: "draft",
            hash: "h", id: nil, date: nil, createdAt: nil, updatedAt: nil, url: nil)
        XCTAssertNil(WriteItemMapper.item(for: entry, inFolder: "notes", readOnly: true))
    }

    func testFilenameIsTheLeafNotThePathFromManifest() {
        // The manifest `file` is a workspace path ("posts/<slug>.md"); the File
        // Provider filename must be the bare leaf, or a "/" makes the item
        // malformed (materializes as zero bytes and will not open).
        let entry = Fixtures.entry(
            id: "p1", file: "posts/gamedeveloper-com.md", kind: "bookmark", title: "GD")
        let item = WriteItemMapper.item(for: entry, inFolder: "bookmarks", readOnly: true)
        XCTAssertEqual(item?.filename, "gamedeveloper-com.md")
        XCTAssertFalse(item?.filename.contains("/") ?? true)
    }

    func testHashCarriesForConflictChecks() {
        let entry = Fixtures.entry(id: "p1", file: "a.md", kind: "article", title: "A", hash: "deadbeef")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", readOnly: false)
        XCTAssertEqual(item?.contentHash, "deadbeef")
    }

    func testDocumentSizeComesFromManifestSize() {
        // The File Provider sizes the dataless placeholder from documentSize, so
        // enumeration must carry the manifest's byte size (a note fetched later
        // would otherwise materialize as zero bytes).
        let entry = WriteManifestItem(
            file: "posts/a.md", kind: "note", slug: "a", title: "A", status: "draft",
            hash: "h", id: "p1", date: nil, createdAt: nil, updatedAt: nil, url: nil,
            size: 4096)
        let item = WriteItemMapper.item(for: entry, inFolder: "notes", readOnly: false)
        XCTAssertEqual(item?.documentSize, 4096)
    }

    func testWithContentCarriesHashAndSize() {
        // fetchContents stamps the fetched bytes' hash AND size onto the returned
        // item. The size is load-bearing: the File Provider uses documentSize as
        // the content length, so an enumeration-time nil materializes zero bytes.
        let entry = Fixtures.entry(id: "p1", file: "a.md", kind: "note", title: "A")
        let base = WriteItemMapper.item(for: entry, inFolder: "notes", readOnly: false)!
        XCTAssertNil(base.documentSize) // enumeration does not know the size
        let materialized = base.withContent(hash: "newhash", size: 334)
        XCTAssertEqual(materialized.contentHash, "newhash")
        XCTAssertEqual(materialized.documentSize, 334)
    }

    func testTimestampsParse() {
        let entry = Fixtures.entry(
            id: "p1", file: "a.md", kind: "article", title: "A",
            updatedAt: "2026-07-11T10:00:00Z")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", readOnly: true)
        XCTAssertNotNil(item?.contentModificationDate)
    }

    func testFractionalSecondTimestampsParse() {
        let entry = Fixtures.entry(
            id: "p1", file: "a.md", kind: "article", title: "A",
            updatedAt: "2026-07-11T10:00:00.123Z")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", readOnly: true)
        XCTAssertNotNil(item?.contentModificationDate)
    }
}
