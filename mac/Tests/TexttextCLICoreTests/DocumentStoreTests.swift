import XCTest
import WriteFileProviderKit
@testable import TexttextCLICore

final class DocumentStoreTests: XCTestCase {
    private var root: URL!
    private var store: DocumentStore!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        store = DocumentStore(root: root)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// Build a real .textpack the way the app does, so these tests exercise the
    /// shipping format rather than a stand-in.
    @discardableResult
    private func makeTextpack(
        named name: String, markdown: String, folder: String? = nil,
        assets: [WriteTextBundlePackage.MaterializedAsset] = []
    ) throws -> URL {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }

        let package = try WriteTextBundlePackage.materialize(
            canonicalMarkdown: markdown, documentJSON: nil,
            assets: assets, sourceURL: nil, in: temporary)
        let packed = try WriteTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: temporary)

        var destination = root!
        if let folder {
            destination = destination.appendingPathComponent(folder, isDirectory: true)
            try FileManager.default.createDirectory(
                at: destination, withIntermediateDirectories: true)
        }
        destination = destination.appendingPathComponent("\(name).textpack")
        try FileManager.default.copyItem(at: packed, to: destination)
        return destination
    }

    func testReadsMarkdownOutOfATextpack() throws {
        try makeTextpack(named: "Note", markdown: "# Hello\n\nBody.")
        let url = try store.resolve("Note")
        XCTAssertEqual(try store.readMarkdown(at: url), "# Hello\n\nBody.")
    }

    func testRoundTripPreservesContentExactly() throws {
        let original = "# Title\n\nParagraph with `code` and a [link](https://example.com).\n"
        try makeTextpack(named: "Round", markdown: original)
        let url = try store.resolve("Round")

        try store.writeMarkdown(original, to: url)

        XCTAssertEqual(
            try store.readMarkdown(at: url), original,
            "a write that changes nothing must not alter the document")
    }

    func testWritePreservesAssets() throws {
        let asset = WriteTextBundlePackage.MaterializedAsset(
            filename: "cover.png",
            data: Data([0x89, 0x50, 0x4E, 0x47]),
            remoteURL: "https://cdn.example.com/cover.png",
            contentType: "image/png")
        try makeTextpack(
            named: "WithAsset", markdown: "# Has asset\n\n![](https://cdn.example.com/cover.png)",
            assets: [asset])
        let url = try store.resolve("WithAsset")

        try store.writeMarkdown("# Has asset\n\nEdited.", to: url)

        // The asset must survive an unrelated body edit.
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let contents = try WriteTextBundlePackage.read(from: url, in: temporary)
        XCTAssertEqual(contents.assets.map(\.filename), ["cover.png"])
        XCTAssertTrue(contents.markdown.contains("Edited."))
    }

    func testWriteIsAtomicAndLeavesNoDebris() throws {
        try makeTextpack(named: "Atomic", markdown: "# One")
        let url = try store.resolve("Atomic")
        try store.writeMarkdown("# Two", to: url)

        XCTAssertEqual(try store.readMarkdown(at: url), "# Two")
        let leftovers = try FileManager.default
            .contentsOfDirectory(atPath: root.path)
            .filter { $0.hasPrefix(".texttext-") }
        XCTAssertTrue(leftovers.isEmpty, "staging files must not survive a write")
    }

    func testResolvesByBareNameFolderPathAndFullPath() throws {
        try makeTextpack(named: "Deep", markdown: "# Deep", folder: "Blog")

        XCTAssertNoThrow(try store.resolve("Deep"))
        XCTAssertNoThrow(try store.resolve("Blog/Deep"))
        XCTAssertNoThrow(try store.resolve("Blog/Deep.textpack"))
    }

    func testAmbiguousNameIsAnErrorThatListsTheMatches() throws {
        try makeTextpack(named: "Same", markdown: "# A", folder: "Blog")
        try makeTextpack(named: "Same", markdown: "# B", folder: "Notes")

        XCTAssertThrowsError(try store.resolve("Same")) { error in
            guard case TexttextCLIError.ambiguous(_, let matches) = error else {
                return XCTFail("expected an ambiguous error, got \(error)")
            }
            XCTAssertEqual(matches.count, 2)
        }
    }

    func testMissingDocumentIsAClearError() {
        XCTAssertThrowsError(try store.resolve("Nope")) { error in
            guard case TexttextCLIError.documentNotFound = error else {
                return XCTFail("expected documentNotFound, got \(error)")
            }
        }
    }

    func testListsDocumentsAndSkipsPackageInternals() throws {
        try makeTextpack(named: "One", markdown: "# 1")
        try makeTextpack(named: "Two", markdown: "# 2", folder: "Blog")

        let all = try store.list()
        XCTAssertTrue(all.contains("One.textpack"))
        XCTAssertTrue(all.contains("Blog/Two.textpack"))
        XCTAssertFalse(
            all.contains { $0.contains("text.md") },
            "package internals must not be listed as documents")

        XCTAssertEqual(try store.list(under: "Blog"), ["Blog/Two.textpack"])
    }

    func testSectionEditThroughTheStoreIsSurgical() throws {
        let original = """
            # Post

            ## Pricing

            Ten dollars.

            ## Availability

            Today.
            """
        try makeTextpack(named: "Sectioned", markdown: original)
        let url = try store.resolve("Sectioned")

        let current = try store.readMarkdown(at: url)
        let section = try XCTUnwrap(DocumentSections.find("Pricing", in: current))
        try store.writeMarkdown(
            DocumentSections.replaceBody(of: section, in: current, with: "Twelve dollars."),
            to: url)

        let updated = try store.readMarkdown(at: url)
        XCTAssertTrue(updated.contains("Twelve dollars."))
        XCTAssertTrue(updated.contains("Today."), "the untouched section must survive")
    }

    func testCredentialsLoadFromAnOverridePath() throws {
        let path = root.appendingPathComponent("credentials.json")
        try Data("""
            {"token":"wsk_test","serverOrigin":"https://example.com",
             "tokenName":"n","linkedAt":0}
            """.utf8).write(to: path)

        let credentials = DeviceCredentials.load(
            environment: ["WRITE_CREDENTIALS_PATH": path.path])

        XCTAssertEqual(credentials?.token, "wsk_test")
        XCTAssertEqual(credentials?.serverOrigin, "https://example.com")
    }

    func testPresenceFailureNeverBlocksTheEdit() {
        // Presence is decoration. With no credential it must be a no-op, not a
        // reason the content change fails.
        let publisher = PresencePublisher(credentials: nil)
        XCTAssertFalse(publisher.isConfigured)

        var ran = false
        publisher.around(
            document: "Doc",
            actor: AgentActor(name: "codex", activity: .edit)
        ) { ran = true }
        XCTAssertTrue(ran)
    }
}
