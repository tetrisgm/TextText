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

    func testHashCarriesForConflictChecks() {
        let entry = Fixtures.entry(id: "p1", file: "a.md", kind: "article", title: "A", hash: "deadbeef")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", readOnly: false)
        XCTAssertEqual(item?.contentHash, "deadbeef")
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
