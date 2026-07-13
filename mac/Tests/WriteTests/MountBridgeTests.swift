import XCTest
@testable import Write

final class MountFrontmatterTests: XCTestCase {
    // A realistic File Provider mount file (the server's render).
    private let sample = """
    ---
    schema: "write.markdown-file.v1"
    folder: "bright-blue-journal"
    folderName: "Shoku's Space"
    mode: "blog"
    kind: "article"
    type: "article"
    slug: "untitled-mrfti1hc"
    title: "Old Title"
    status: "draft"
    canonical: "https://write.ramine.net/@ramine-2/untitled-mrfti1hc"
    ---

    The body of the post.
    Second line.
    """

    func testValueReadsJSONScalar() {
        XCTAssertEqual(MountFrontmatter.value(sample, "slug"), "untitled-mrfti1hc")
        XCTAssertEqual(MountFrontmatter.value(sample, "title"), "Old Title")
        XCTAssertEqual(MountFrontmatter.value(sample, "folder"), "bright-blue-journal")
        XCTAssertNil(MountFrontmatter.value(sample, "nope"))
    }

    func testSetTitleRewritesOnlyTheTitleLineAndPreservesEverythingElse() {
        let out = MountFrontmatter.setTitle(sample, "New Title")
        // Title line changed to the JSON-encoded new value.
        XCTAssertTrue(out.contains("\ntitle: \"New Title\"\n"))
        // The old title is gone; body and every other field are byte-identical.
        XCTAssertFalse(out.contains("Old Title"))
        XCTAssertEqual(
            out.replacingOccurrences(of: "title: \"New Title\"", with: "title: \"Old Title\""),
            sample, "setTitle must touch ONLY the title line")
    }

    func testSetTitleJSONEscapes() {
        let out = MountFrontmatter.setTitle(sample, "Quote \" and \\ slash")
        XCTAssertTrue(out.contains(#"title: "Quote \" and \\ slash""#))
    }

    func testStripTitleRemovesOnlyTheTitleLine() {
        let stripped = MountFrontmatter.stripTitle(sample)
        XCTAssertFalse(stripped.contains("title:"))
        XCTAssertTrue(stripped.contains("slug: \"untitled-mrfti1hc\""))
        XCTAssertTrue(stripped.contains("The body of the post."))
        // Two files differing ONLY by title strip to the same signature (the
        // loop-safety property: a title-only difference is not a content edit).
        let renamed = MountFrontmatter.setTitle(sample, "Totally Different")
        XCTAssertEqual(MountFrontmatter.stripTitle(sample), MountFrontmatter.stripTitle(renamed))
    }

    func testStripTitleLeavesBodyEditsVisible() {
        let edited = sample.replacingOccurrences(of: "The body of the post.", with: "EDITED body.")
        XCTAssertNotEqual(MountFrontmatter.stripTitle(sample), MountFrontmatter.stripTitle(edited),
                          "a real body edit must survive title-stripping")
    }

    func testNoFrontmatterIsLeftAlone() {
        let plain = "just text, no frontmatter"
        XCTAssertEqual(MountFrontmatter.setTitle(plain, "X"), plain)
        XCTAssertEqual(MountFrontmatter.stripTitle(plain), plain)
        XCTAssertNil(MountFrontmatter.value(plain, "slug"))
    }
}
