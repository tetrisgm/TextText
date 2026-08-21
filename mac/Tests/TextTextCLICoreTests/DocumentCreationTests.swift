import XCTest
import TextTextFileProviderKit
@testable import TextTextCLICore

final class DocumentCreationTests: XCTestCase {
    private var root: URL!
    private var store: DocumentStore!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-create-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        store = DocumentStore(root: root)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testCreatesAReadableDocument() throws {
        let url = try store.create(title: "My Idea", body: "First line.", folder: "Notes")

        let markdown = try store.readMarkdown(at: url)
        XCTAssertTrue(markdown.contains("title: \"My Idea\""))
        XCTAssertTrue(markdown.contains("First line."))
        XCTAssertEqual(url.lastPathComponent, "My Idea.textpack")
    }

    func testBookmarkCaptureKeepsItsCanonicalLink() throws {
        let url = try store.create(
            title: "paper.design", body: "[paper.design](https://paper.design/docs/mcp)",
            folder: "Notes", kind: "bookmark",
            sourceURL: "https://paper.design/docs/mcp")

        let markdown = try store.readMarkdown(at: url)
        XCTAssertTrue(
            markdown.contains(
                "links: [{\"href\":\"https://paper.design/docs/mcp\",\"label\":\"paper.design\"}]"))
    }

    func testFrontmatterIsSeparatedFromTheBody() throws {
        // Matches how every existing document on disk is laid out.
        let url = try store.create(title: "Spacing", body: "Body.", folder: "Notes")
        let markdown = try store.readMarkdown(at: url)
        XCTAssertTrue(markdown.contains("---\n\nBody."))
    }

    func testWritesOnlyServerSafeFrontmatter() {
        let frontmatter = DocumentCreation.frontmatter(title: "T", kind: "note")
        // Identity, slug, and canonical URL belong to the server. Guessing at
        // them would be ignored at best and conflict at worst.
        for owned in ["slug:", "canonical:", "textTextId:", "syncRevision:", "workspace:"] {
            XCTAssertFalse(
                frontmatter.contains(owned),
                "\(owned) is assigned by the server and must not be invented")
        }
        XCTAssertTrue(frontmatter.contains("title: \"T\""))
        XCTAssertTrue(frontmatter.contains("status: \"draft\""))
    }

    func testTitleWithSlashesDoesNotEscapeItsFolder() throws {
        let url = try store.create(title: "a/b: c", body: "", folder: "Notes")

        XCTAssertEqual(url.deletingLastPathComponent().lastPathComponent, "Notes")
        XCTAssertFalse(url.lastPathComponent.contains("/"))
    }

    func testQuotesInATitleStayValidJSON() throws {
        let url = try store.create(title: "The \"good\" part", body: "", folder: "Notes")
        let markdown = try store.readMarkdown(at: url)
        // The line must remain parseable single-line JSON.
        let line = markdown.components(separatedBy: "\n")
            .first { $0.hasPrefix("title:") }
        let value = line.map { String($0.dropFirst("title:".count)) } ?? ""
        XCTAssertNoThrow(
            try JSONSerialization.jsonObject(
                with: Data("[\(value)]".utf8), options: []))
    }

    func testRefusesToOverwriteAnExistingDocument() throws {
        _ = try store.create(title: "Once", body: "", folder: "Notes")

        XCTAssertThrowsError(try store.create(title: "Once", body: "", folder: "Notes")) {
            guard case TextTextCLIError.invalidDocument = $0 else {
                return XCTFail("expected invalidDocument, got \($0)")
            }
        }
    }

    func testRefusesAMissingFolder() {
        XCTAssertThrowsError(
            try store.create(title: "X", body: "", folder: "Nowhere"))
    }

    // MARK: - Linting

    func testCleanDocumentHasNoFindings() throws {
        let url = try store.create(title: "Clean", body: "Fine.", folder: "Notes")
        XCTAssertEqual(DocumentLinter.check(url, named: "Clean.textpack"), [])
    }

    func testCorruptPackIsReportedWithTheReaderIsOwnReason() throws {
        let url = root.appendingPathComponent("Notes/Broken.textpack")
        try Data("not a zip".utf8).write(to: url)

        let findings = DocumentLinter.check(url, named: "Broken.textpack")

        XCTAssertEqual(findings.count, 1)
        // The reader's message names the exact invariant that broke, which is
        // more useful to an agent than a generic "invalid".
        XCTAssertTrue(findings[0].problem.contains("ZIP"))
    }

    func testNonDocumentIsReported() throws {
        let url = root.appendingPathComponent("Notes/notes.txt")
        try Data("hi".utf8).write(to: url)

        XCTAssertEqual(
            DocumentLinter.check(url, named: "notes.txt"),
            [LintFinding(document: "notes.txt", problem: "not a document")])
    }

    func testPlainMarkdownIsAcceptedAndCheckedForEncoding() throws {
        let good = root.appendingPathComponent("Notes/plain.md")
        try Data("# Fine".utf8).write(to: good)
        XCTAssertEqual(DocumentLinter.check(good, named: "plain.md"), [])

        let bad = root.appendingPathComponent("Notes/bad.md")
        try Data([0xFF, 0xFE, 0xFF]).write(to: bad)
        XCTAssertEqual(
            DocumentLinter.check(bad, named: "bad.md").first?.problem, "not UTF-8")
    }
}
