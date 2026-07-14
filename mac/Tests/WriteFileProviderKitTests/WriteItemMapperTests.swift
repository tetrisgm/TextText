import XCTest
@testable import WriteFileProviderKit

final class WriteItemMapperTests: XCTestCase {
    private let h = "demo"

    func testTopLevelFolderParentsToWorkspace() {
        let f = Fixtures.folder("blog", "Blog")
        let item = WriteItemMapper.item(for: f, handle: h, readOnly: true)
        XCTAssertEqual(item.parentIdentifier, .workspace(h))
        XCTAssertEqual(item.identifier, .folder(handle: h, id: "blog"))
        XCTAssertEqual(item.typeIdentifier, WriteItem.folderTypeIdentifier)
    }

    func testSubfolderParentsToItsFolder() {
        let f = Fixtures.folder("drafts", "Drafts", parent: "blog")
        let item = WriteItemMapper.item(for: f, handle: h, readOnly: true)
        XCTAssertEqual(item.parentIdentifier, .folder(handle: h, id: "blog"))
    }

    func testWorkspaceItemIsAContainerNamedForTheWorkspace() {
        let item = WriteItemMapper.workspaceItem(handle: h, name: "Shoku's Space", readOnly: false)
        XCTAssertEqual(item.identifier, .workspace(h))
        XCTAssertEqual(item.parentIdentifier, .rootContainer)
        XCTAssertEqual(item.filename, "Shoku's Space")
        XCTAssertTrue(item.isFolder)
        // New items are created inside the system folders, never at this level.
        XCTAssertFalse(item.capabilities.contains(.addingSubItems))
        // Renamable: renaming the folder renames the workspace, and without this
        // the framework would stamp the folder immutable (the Finder lock badge).
        XCTAssertTrue(item.capabilities.contains(.renaming))
    }

    func testWorkspaceItemFallsBackToHandleWhenNameEmpty() {
        let item = WriteItemMapper.workspaceItem(handle: h, name: "", readOnly: false)
        XCTAssertEqual(item.filename, h)
    }

    func testWorkspaceAndFolderNamesUsePortableReversibleComponents() {
        let workspace = WriteItemMapper.workspaceItem(
            handle: h, name: ".Research?? ", readOnly: false)
        XCTAssertEqual(WriteFilename.decodeComponent(workspace.filename), ".Research?? ")
        XCTAssertFalse(workspace.filename.contains("?"))
        XCTAssertFalse(workspace.filename.hasPrefix("."))

        let folder = WriteItemMapper.item(
            for: Fixtures.folder("f", "A/B: C"), handle: h, readOnly: false)
        XCTAssertEqual(WriteFilename.decodeComponent(folder.filename), "A/B: C")
        XCTAssertFalse(folder.filename.contains("/"))
        XCTAssertFalse(folder.filename.contains(":"))
    }

    func testKindMapping() {
        let cases: [(String, WriteItemKind)] = [
            ("article", .article), ("project", .project), ("talk", .talk),
            ("note", .note), ("bookmark", .bookmark), ("weird", .other("weird")),
        ]
        for (raw, expected) in cases {
            let entry = Fixtures.entry(id: "x", file: "x.md", kind: raw, title: "X")
            let item = WriteItemMapper.item(for: entry, inFolder: "blog", handle: h, readOnly: true)
            XCTAssertEqual(item?.kind, expected)
            XCTAssertEqual(item?.typeIdentifier, WriteItem.markdownTypeIdentifier)
            XCTAssertEqual(item?.identifier, .file(handle: h, id: "x"))
            XCTAssertEqual(item?.parentIdentifier, .folder(handle: h, id: "blog"))
        }
    }

    func testRepresentationExplicitlyControlsFilenameAndTypeIdentifier() throws {
        let cases: [(WriteFileRepresentation, String, String)] = [
            (.textbundle, "Title.textbundle", WriteItem.textBundleTypeIdentifier),
            (.markdown, "Title.md", WriteItem.markdownTypeIdentifier),
            (.text, "Title.txt", WriteItem.plainTextTypeIdentifier),
        ]

        for (representation, filename, typeIdentifier) in cases {
            // Deliberately leave the wire path as .md: mapping must use the
            // explicit representation instead of inferring from `file`.
            let entry = WriteManifestItem(
                file: "posts/stale.md", representation: representation,
                kind: "note", slug: "title", title: "Title", status: "draft",
                hash: "h", id: representation.rawValue, date: nil,
                createdAt: nil, updatedAt: nil, url: nil)
            let item = try XCTUnwrap(WriteItemMapper.item(
                for: entry, inFolder: "notes", handle: h, readOnly: true))

            XCTAssertEqual(item.filename, filename)
            XCTAssertEqual(item.typeIdentifier, typeIdentifier)
            XCTAssertEqual(item.representation, representation)
            XCTAssertFalse(item.isFolder)
        }
    }

    func testEntryWithoutIdIsSkipped() {
        let entry = WriteManifestItem(
            file: "x.md", kind: "note", slug: "x", title: "X", status: "draft",
            hash: "h", id: nil, date: nil, createdAt: nil, updatedAt: nil, url: nil)
        XCTAssertNil(WriteItemMapper.item(for: entry, inFolder: "notes", handle: h, readOnly: true))
    }

    func testFilenameIsTheTitleNotTheSlug() {
        // The user's bug: a post titled "Madonna's Best Album" whose slug is a
        // placeholder must show its TITLE in Finder, not "untitled-...".
        let entry = WriteManifestItem(
            file: "posts/untitled-mrfti1hc.md", kind: "article", slug: "untitled-mrfti1hc",
            title: "Madonna's Best Album", status: "draft", hash: "h", id: "p1",
            date: nil, createdAt: nil, updatedAt: nil, url: nil)
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", handle: h, readOnly: true)
        XCTAssertEqual(item?.filename, "Madonna's Best Album.md")
        XCTAssertFalse(item?.filename.contains("/") ?? true)
        // Identity still anchors on the stable post id, not the display name.
        XCTAssertEqual(item?.identifier, .file(handle: h, id: "p1"))
    }

    func testTitlelessDraftFallsBackToSlug() {
        let entry = WriteManifestItem(
            file: "posts/untitled-abc.md", kind: "note", slug: "untitled-abc",
            title: "", status: "draft", hash: "h", id: "n1",
            date: nil, createdAt: nil, updatedAt: nil, url: nil)
        let item = WriteItemMapper.item(for: entry, inFolder: "notes", handle: h, readOnly: true)
        XCTAssertEqual(item?.filename, "untitled-abc.md")
    }

    func testQuestionMarksInTitleProduceSafeReversibleFilename() {
        let entry = Fixtures.entry(
            id: "p1", file: "why.md", kind: "article", title: "Why??")
        let item = WriteItemMapper.item(
            for: entry, inFolder: "blog", handle: h, readOnly: true)
        XCTAssertEqual(item?.filename, "Why~3F~3F.md")
        XCTAssertEqual(WriteFilename.titleFromFilename(item?.filename ?? ""), "Why??")
    }

    func testHashCarriesForConflictChecks() {
        let entry = Fixtures.entry(id: "p1", file: "a.md", kind: "article", title: "A", hash: "deadbeef")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", handle: h, readOnly: false)
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
        let item = WriteItemMapper.item(for: entry, inFolder: "notes", handle: h, readOnly: false)
        XCTAssertEqual(item?.documentSize, 4096)
    }

    func testManifestURLIsAuthoritativeAndSurvivesLocalCopies() {
        let entry = WriteManifestItem(
            file: "posts/a.md", kind: "note", slug: "stale-slug", title: "A",
            status: "draft", hash: "h", id: "p1", date: nil, createdAt: nil,
            updatedAt: nil, url: "https://links.example/write/authoritative")
        let item = WriteItemMapper.item(
            for: entry, inFolder: "notes", handle: h, readOnly: false)!

        XCTAssertEqual(item.manifestURL, "https://links.example/write/authoritative")
        XCTAssertEqual(item.withContent(hash: "h2", size: 12).manifestURL, item.manifestURL)
        XCTAssertEqual(item.withFilename("Renamed.md").manifestURL, item.manifestURL)
        XCTAssertEqual(
            item.withParentIdentifier(.folder(handle: h, id: "blog")).manifestURL,
            item.manifestURL)
        XCTAssertEqual(item.withContent(hash: "h2", size: 12).representation, .markdown)
        XCTAssertEqual(item.withFilename("Renamed.md").representation, .markdown)
        XCTAssertEqual(
            item.withParentIdentifier(.folder(handle: h, id: "blog")).representation,
            .markdown)
    }

    func testWithContentCarriesHashAndSize() {
        let entry = Fixtures.entry(id: "p1", file: "a.md", kind: "note", title: "A")
        let base = WriteItemMapper.item(for: entry, inFolder: "notes", handle: h, readOnly: false)!
        XCTAssertNil(base.documentSize) // enumeration does not know the size
        let materialized = base.withContent(hash: "newhash", size: 334)
        XCTAssertEqual(materialized.contentHash, "newhash")
        XCTAssertEqual(materialized.documentSize, 334)
    }

    func testTimestampsParse() {
        let entry = Fixtures.entry(
            id: "p1", file: "a.md", kind: "article", title: "A",
            updatedAt: "2026-07-11T10:00:00Z")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", handle: h, readOnly: true)
        XCTAssertNotNil(item?.contentModificationDate)
    }

    func testFractionalSecondTimestampsParse() {
        let entry = Fixtures.entry(
            id: "p1", file: "a.md", kind: "article", title: "A",
            updatedAt: "2026-07-11T10:00:00.123Z")
        let item = WriteItemMapper.item(for: entry, inFolder: "blog", handle: h, readOnly: true)
        XCTAssertNotNil(item?.contentModificationDate)
    }
}
