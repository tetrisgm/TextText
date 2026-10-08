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

    func testLocalFolderDefaultCreatesCompletePackAndPreservesExplicitOverrides() throws {
        let builtin = try BuiltinTextPackDocument.create(title: "Folder view", body: "")
        var template = try JSONSerialization.jsonObject(with: Data(builtin.templateJSON.utf8)) as! [String: Any]
        template["id"] = "local.research"
        template["starter"] = ["body": "Starter research", "fields": ["topic": "science"]]
        let defaultValue: [String: Any] = ["version": 1, "template": template]
        var document = try JSONSerialization.jsonObject(with: Data(builtin.documentJSON.utf8)) as! [String: Any]
        var content = document["content"] as! [String: Any]
        content["fields"] = ["texttextFolderView": "v1", "texttextFolderDefault": String(decoding: try JSONSerialization.data(withJSONObject: defaultValue), as: UTF8.self)]
        document["content"] = content
        let scratch = root.appendingPathComponent("fixture")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: 11111111-1111-4111-8111-111111111111\n---\n", documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: document), as: UTF8.self), templateJSON: builtin.templateJSON, assets: [], sourceURL: nil, in: scratch)
        let packed = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch)
        let view = root.appendingPathComponent("Notes/View.textpack")
        try FileManager.default.copyItem(at: packed, to: view)
        let original = try Data(contentsOf: view)
        let made = try store.create(title: "Research", folder: "Notes")
        let result = try LocalVaultDocumentStore(root: root).readMetadata(path: "Notes/Research.textpack", includeTemplate: true)
        XCTAssertTrue(result.contents.markdown.contains("Starter research"))
        XCTAssertTrue(try XCTUnwrap(result.contents.templateJSON).contains("local.research"))
        XCTAssertTrue(try XCTUnwrap(result.contents.documentJSON).contains("science"))
        XCTAssertEqual(try Data(contentsOf: view), original)
        XCTAssertTrue(FileManager.default.fileExists(atPath: made.path))
        _ = try store.create(title: "Blank", body: "", folder: "Notes")
        XCTAssertFalse(try store.readMarkdown(at: root.appendingPathComponent("Notes/Blank.textpack")).contains("Starter research"))
        _ = try store.create(title: "Explicit", folder: "Notes", kind: "note")
        XCTAssertFalse(try store.readMarkdown(at: root.appendingPathComponent("Notes/Explicit.textpack")).contains("Starter research"))
        try FileManager.default.copyItem(at: view, to: root.appendingPathComponent("Notes/Duplicate.textpack"))
        XCTAssertThrowsError(try store.create(title: "Ambiguous", folder: "Notes"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/Ambiguous.textpack").path))
        try FileManager.default.removeItem(at: root.appendingPathComponent("Notes/Duplicate.textpack"))
        var invalidDocument = document
        var invalidContent = content
        invalidContent["fields"] = ["texttextFolderView": "v1", "texttextFolderDefault": "{\"version\":99}"]
        invalidDocument["content"] = invalidContent
        let invalidPackage = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "Invalid fixture", documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: invalidDocument), as: UTF8.self), templateJSON: builtin.templateJSON, assets: [], sourceURL: nil, in: scratch)
        let invalidPack = try TextTextTextBundlePackage.zipToTextPack(packageURL: invalidPackage.url, in: scratch)
        try Data(contentsOf: invalidPack).write(to: view, options: .atomic)
        XCTAssertThrowsError(try store.create(title: "Malformed rejected", folder: "Notes"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/Malformed rejected.textpack").path))
        try original.write(to: view, options: .atomic)
        let retirementFolder = root.appendingPathComponent("Templates/Retired")
        try FileManager.default.createDirectory(at: retirementFolder, withIntermediateDirectories: true)
        var retiredDocument = try JSONSerialization.jsonObject(with: Data(builtin.documentJSON.utf8)) as! [String: Any]
        retiredDocument["content"] = ["title": "Retired", "body": "{\"format\":\"texttext-template-retirement\",\"version\":1,\"templateId\":\"local.research\"}", "fields": ["texttextRecordType": "template-retirement"], "tags": [], "assets": []] as [String: Any]
        let retiredPackage = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "Retired", documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: retiredDocument), as: UTF8.self), templateJSON: builtin.templateJSON, assets: [], sourceURL: nil, in: scratch)
        let retiredPack = try TextTextTextBundlePackage.zipToTextPack(packageURL: retiredPackage.url, in: scratch)
        try FileManager.default.copyItem(at: retiredPack, to: retirementFolder.appendingPathComponent("retired.textpack"))
        XCTAssertThrowsError(try store.create(title: "Retired rejected", folder: "Notes"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/Retired rejected.textpack").path))
        _ = try store.create(title: "Explicit after retirement", folder: "Notes", kind: "note")

    }

    func testCreatesAReadableDocument() throws {
        let url = try store.create(title: "My Idea", body: "First line.", folder: "Notes")

        let markdown = try store.readMarkdown(at: url)
        XCTAssertTrue(markdown.contains("title: \"My Idea\""))
        XCTAssertTrue(markdown.contains("First line."))
        XCTAssertEqual(url.lastPathComponent, "My Idea.textpack")
    }

    func testNewPacksContainSnapshotAndMatchingTemplateWithoutAServer() throws {
        for kind in ["note", "article", "bookmark", "gallery", "talk"] {
            let url = try store.create(title: kind, body: "Fresh content.", kind: kind)
            let scratch = root.appendingPathComponent("scratch-" + kind)
            try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
            let contents = try TextTextTextBundlePackage.read(from: url, in: scratch)
            let document = try XCTUnwrap(try JSONSerialization.jsonObject(
                with: Data(XCTUnwrap(contents.documentJSON).utf8)) as? [String: Any])
            let template = try XCTUnwrap(try JSONSerialization.jsonObject(
                with: Data(XCTUnwrap(contents.templateJSON).utf8)) as? [String: Any])
            XCTAssertEqual(document["schemaVersion"] as? Int, 1)
            let content = try XCTUnwrap(document["content"] as? [String: Any])
            XCTAssertEqual(content["title"] as? String, kind)
            XCTAssertEqual(content["body"] as? String, "Fresh content.")
            let presentation = try XCTUnwrap(document["presentation"] as? [String: Any])
            let reference = try XCTUnwrap(presentation["template"] as? [String: Any])
            XCTAssertEqual(reference["id"] as? String, "texttext." + kind)
            XCTAssertEqual(reference["id"] as? String, template["id"] as? String)
            XCTAssertEqual(reference["version"] as? Int, template["version"] as? Int)
            XCTAssertNotNil(template["item"])
            XCTAssertNotNil(store.itemId(at: url))
        }
    }

    func testIdentitySurvivesRenameAndBodyReplacement() throws {
        let url = try store.create(title: "Identity", body: "Original.")
        let id = try XCTUnwrap(store.itemId(at: url))
        XCTAssertNotNil(UUID(uuidString: id))
        let renamed = root.appendingPathComponent("Renamed.textpack")
        try FileManager.default.moveItem(at: url, to: renamed)
        try store.writeMarkdown("Updated body.", to: renamed)
        XCTAssertEqual(store.itemId(at: renamed), id)
        XCTAssertTrue(try store.readMarkdown(at: renamed).contains("Updated body."))
    }

    func testFolderCannotEscapeVault() throws {
        XCTAssertThrowsError(try store.create(title: "Outside", folder: ".."))
        XCTAssertThrowsError(try store.list(under: ".."))
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
        let contents = try TextTextTextBundlePackage.read(from: url, in: root)
        let snapshot = try XCTUnwrap(try JSONSerialization.jsonObject(
            with: Data(XCTUnwrap(contents.documentJSON).utf8)) as? [String: Any])
        let content = try XCTUnwrap(snapshot["content"] as? [String: Any])
        let fields = try XCTUnwrap(content["fields"] as? [String: Any])
        XCTAssertEqual(fields["sourceUrl"] as? String, "https://paper.design/docs/mcp")
        XCTAssertEqual(fields["captureStatus"] as? String, "pending")
        XCTAssertNotNil((fields["texttextBookmarkSavedAt"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) })
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
