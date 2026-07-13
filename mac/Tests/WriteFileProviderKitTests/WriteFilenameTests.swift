import XCTest
@testable import WriteFileProviderKit

final class WriteFilenameTests: XCTestCase {

    func testSlugifyMatchesServerRules() {
        // Must mirror src/lib/markdown-files.ts slugify so the " (N)" de-dup tail
        // detection lines up with the server's "<slug>-N".
        XCTAssertEqual(WriteFilename.slugify("Madonna's Best Album"), "madonna-s-best-album")
        XCTAssertEqual(WriteFilename.slugify("  Hello, World!  "), "hello-world")
        XCTAssertEqual(WriteFilename.slugify("5 Dad Jokes"), "5-dad-jokes")
        XCTAssertEqual(WriteFilename.slugify("---"), "")
    }

    func testFilenameIsTitlePlusExtension() {
        XCTAssertEqual(WriteFilename.filename(title: "5 Dad Jokes", slug: "5-dad-jokes"), "5 Dad Jokes.md")
    }

    func testFilenameFallsBackToSlugThenUntitled() {
        XCTAssertEqual(WriteFilename.filename(title: "", slug: "untitled-abc"), "untitled-abc.md")
        XCTAssertEqual(WriteFilename.filename(title: "", slug: ""), "untitled.md")
    }

    func testServerDedupSuffixShowsAsParenN() {
        // Two posts titled "Foo": the server slugs them foo and foo-2; the second
        // reads as "Foo (2).md" without needing its siblings.
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "foo"), "Foo.md")
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "foo-2"), "Foo (2).md")
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "foo-13"), "Foo (13).md")
        // A hand-set slug that is not the "<stem>-N" form gets no suffix.
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "totally-custom"), "Foo.md")
    }

    func testSanitizeReplacesIllegalLeafCharacters() {
        // "/" is illegal in a leaf and ":" shows as "/" in Finder; both -> "-".
        XCTAssertEqual(WriteFilename.filename(title: "A/B: C", slug: "a-b-c"), "A-B- C.md")
    }

    func testTitleFromFilenameStripsExtensionVerbatim() {
        XCTAssertEqual(WriteFilename.titleFromFilename("My Great Note.md"), "My Great Note")
        XCTAssertEqual(WriteFilename.titleFromFilename("No Extension"), "No Extension")
        // Not slugged: the title is taken as typed.
        XCTAssertEqual(WriteFilename.titleFromFilename("Madonna's Best Album.md"), "Madonna's Best Album")
    }

    func testDisambiguateBreaksIntraFolderCollisions() {
        // Two posts, same title, unrelated hand-set slugs -> same filename. The
        // sibling-aware pass appends a stable id suffix to BOTH.
        let a = fileItem(id: "aaaaaa11", parent: "blog", filename: "Same.md")
        let b = fileItem(id: "bbbbbb22", parent: "blog", filename: "Same.md")
        let out = WriteFilename.disambiguate([a, b])
        XCTAssertEqual(out[0].filename, "Same-aaaaaa.md")
        XCTAssertEqual(out[1].filename, "Same-bbbbbb.md")
    }

    func testDisambiguateLeavesUniqueNamesAlone() {
        let a = fileItem(id: "a", parent: "blog", filename: "One.md")
        let b = fileItem(id: "b", parent: "blog", filename: "Two.md")
        // Same name but DIFFERENT parents must not collide.
        let c = fileItem(id: "c", parent: "notes", filename: "One.md")
        let out = WriteFilename.disambiguate([a, b, c])
        XCTAssertEqual(out.map(\.filename), ["One.md", "Two.md", "One.md"])
    }

    private func fileItem(id: String, parent: String, filename: String) -> WriteItem {
        WriteItem(
            identifier: .file(handle: "demo", id: id),
            parentIdentifier: .folder(handle: "demo", id: parent),
            filename: filename, isFolder: false, kind: .note,
            typeIdentifier: WriteItem.markdownTypeIdentifier, serverId: id,
            contentHash: "h", documentSize: nil, creationDate: nil,
            contentModificationDate: nil, capabilities: .readOnlyFile)
    }
}
