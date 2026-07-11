import Foundation
import XCTest
@testable import Write
import WriteQuickLookCore
import WriteShareCore
import WriteShareExtensionCore
import WriteWorkspaceCore

final class WriteShareCoreTests: XCTestCase {
    func testInboxRoundTripAndConsume() throws {
        let container = try temporaryDirectory()
        let writer = InboxWriter(containerURL: container)
        let item = InboxItem(kind: .note, title: "Shared Note", text: "Body")
        let payload = InboxPayload(filename: "clip.txt", data: Data("payload".utf8))

        let written = try writer.write(item, payload: payload)
        let reader = InboxReader(containerURL: container)
        let records = try reader.completeItems()

        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?.item.kind, .note)
        XCTAssertEqual(records.first?.item.title, "Shared Note")
        XCTAssertEqual(records.first?.item.payloadFilename, "clip.txt")
        XCTAssertEqual(try records.first?.payloadURL.map { try Data(contentsOf: $0) }, payload.data)

        try reader.deleteConsumed(written)
        XCTAssertEqual(try reader.completeItems(), [])
    }

    func testIncompleteInboxItemWithoutJSONIsInvisible() throws {
        let container = try temporaryDirectory()
        let inbox = InboxReader.inboxURL(containerURL: container)
        let directory = inbox.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("payload".utf8).write(to: directory.appendingPathComponent("payload.bin"))

        XCTAssertEqual(try InboxReader(containerURL: container).completeItems(), [])
    }

    func testFilingEachKindCreatesExpectedWorkspaceFiles() throws {
        let root = try temporaryDirectory()
        let payload = try temporaryDirectory().appendingPathComponent("photo.png")
        try Data([0, 1, 2, 3]).write(to: payload)
        let filer = InboxFiler(root: root, now: fixedDate)

        let note = try filer.file(InboxItem(kind: .note, title: "Meeting Notes", text: "Body"))
        XCTAssertEqual(relative(note, root: root), "Notes/meeting-notes.md")
        let noteText = try String(contentsOf: note)
        XCTAssertTrue(noteText.contains("title: \"Meeting Notes\""))
        XCTAssertTrue(noteText.contains("writeKind: \"note\""))

        let bookmark = try filer.file(InboxItem(
            kind: .bookmark,
            title: "Example Link",
            text: "Selected quote",
            urlString: "https://example.invalid/article"
        ))
        XCTAssertEqual(relative(bookmark, root: root), "Bookmarks/2026/example-link.md")
        let bookmarkText = try String(contentsOf: bookmark)
        XCTAssertTrue(bookmarkText.contains("type: \"bookmark\""))
        // The URL must ride in the links list the server round-trips, not a
        // bare url: key it would drop.
        XCTAssertTrue(
            bookmarkText.contains("links: [{\"label\":\"Example Link\",\"href\":\"https://example.invalid/article\"}]"),
            bookmarkText
        )
        XCTAssertFalse(bookmarkText.contains("\nurl: "), "bare url: is dropped by the server")
        XCTAssertTrue(bookmarkText.contains("created_at: \"2026-07-11T12:34:56Z\""))
        XCTAssertTrue(bookmarkText.contains("Selected quote"))

        let draft = try filer.file(InboxItem(kind: .draft, title: "Draft Title", text: "Draft body"))
        XCTAssertEqual(relative(draft, root: root), "Drafts/draft-title.md")
        let draftText = try String(contentsOf: draft)
        XCTAssertTrue(draftText.contains("kind: \"article\""))
        XCTAssertTrue(draftText.contains("Draft body"))

        let savedFile = try filer.file(
            InboxItem(kind: .file, title: "Photo", payloadFilename: "photo.png"),
            payloadURL: payload
        )
        XCTAssertEqual(relative(savedFile, root: root), "Media/photo.png")
        XCTAssertEqual(try Data(contentsOf: savedFile), Data([0, 1, 2, 3]))
    }

    func testAppendPreservesExistingBody() throws {
        let root = try temporaryDirectory()
        let target = root.appendingPathComponent("Notes/target.md")
        let markdown = MarkdownIdentityCodec.inject(
            into: "---\ntitle: \"Target\"\n---\n\nOriginal body\n",
            itemId: "target-id",
            folderId: "notes",
            kind: "note"
        )
        try write(markdown, to: target)
        try WorkspaceIndexStore.save(SyncIndex(entries: [
            "target-id": IndexEntry(
                hash: MarkdownIdentityCodec.syncHash(for: markdown),
                relativePath: "Notes/target.md",
                folderId: "notes",
                kind: "note"
            )
        ]), root: root)

        let filed = try InboxFiler(root: root, now: fixedDate).file(InboxItem(
            kind: .append,
            text: "Appended body",
            targetWriteId: "target-id"
        ))

        XCTAssertEqual(filed.path, target.path)
        let result = try String(contentsOf: target)
        XCTAssertTrue(result.contains("Original body\nAppended body\n"))
        XCTAssertTrue(result.contains("updated_at: \"2026-07-11T12:34:56Z\""))
    }

    func testFilenameCollisionsGetUniqueSuffixes() throws {
        let root = try temporaryDirectory()
        let filer = InboxFiler(root: root, now: fixedDate)
        try write("existing", to: root.appendingPathComponent("Notes/same.md"))
        let note = try filer.file(InboxItem(kind: .note, title: "Same", text: "New"))
        XCTAssertEqual(relative(note, root: root), "Notes/same-2.md")

        let payload = try temporaryDirectory().appendingPathComponent("report.pdf")
        try Data("pdf".utf8).write(to: payload)
        try write("existing", to: root.appendingPathComponent("Media/report.pdf"))
        let saved = try filer.file(
            InboxItem(kind: .file, payloadFilename: "report.pdf"),
            payloadURL: payload
        )
        XCTAssertEqual(relative(saved, root: root), "Media/report-2.pdf")
    }

    func testShareInboxPosterWritesHeadlessInboxItems() throws {
        let container = try temporaryDirectory()
        let content = ShareExtractedContent(
            title: "Saved Image",
            text: "Caption",
            payloads: [InboxPayload(filename: "image.png", data: Data([9, 8, 7]))]
        )

        let written = try ShareInboxPoster.write(
            action: .saveFile,
            title: "Saved Image",
            content: content,
            containerURL: container
        )

        XCTAssertEqual(written.count, 1)
        XCTAssertEqual(written[0].item.kind, .file)
        XCTAssertEqual(written[0].item.payloadFilename, "image.png")
        let records = try InboxReader(containerURL: container).completeItems()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(try records[0].payloadURL.map { try Data(contentsOf: $0) }, Data([9, 8, 7]))
    }

    func testSharingMultipleFilesWritesOneItemEach() throws {
        let container = try temporaryDirectory()
        let content = ShareExtractedContent(
            title: "Batch",
            payloads: [
                InboxPayload(filename: "a.png", data: Data([1])),
                InboxPayload(filename: "b.png", data: Data([2])),
                InboxPayload(filename: "c.png", data: Data([3])),
            ]
        )

        let written = try ShareInboxPoster.write(
            action: .saveFile, title: "Batch", content: content, containerURL: container)

        XCTAssertEqual(written.count, 3, "every shared file must be written, not just the first")
        let records = try InboxReader(containerURL: container).completeItems()
        XCTAssertEqual(Set(records.compactMap(\.item.payloadFilename)), ["a.png", "b.png", "c.png"])
    }

    func testOneCorruptSidecarDoesNotWedgeTheInbox() throws {
        let container = try temporaryDirectory()
        let writer = InboxWriter(containerURL: container)
        _ = try writer.write(InboxItem(kind: .note, title: "Good", text: "keep"))
        // A corrupt sidecar directory next to it must not hide the good item.
        let inbox = InboxReader.inboxURL(containerURL: container)
        let corrupt = inbox.appendingPathComponent("corrupt-item", isDirectory: true)
        try FileManager.default.createDirectory(at: corrupt, withIntermediateDirectories: true)
        try Data("{ not valid json".utf8).write(to: corrupt.appendingPathComponent(InboxWriter.itemSidecarName))

        let records = try InboxReader(containerURL: container).completeItems()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records[0].item.title, "Good")
    }

    func testShareFactoryCreatesBookmarkAndAppendItems() throws {
        let bookmark = try ShareInboxItemFactory.makeItem(
            action: .newBookmark,
            title: "Bookmark",
            content: ShareExtractedContent(text: "Quote", urlString: "https://example.invalid/a")
        )
        XCTAssertEqual(bookmark.kind, .bookmark)
        XCTAssertEqual(bookmark.urlString, "https://example.invalid/a")

        let append = try ShareInboxItemFactory.makeItem(
            action: .appendToDocument,
            title: "Append",
            content: ShareExtractedContent(text: "More"),
            targetWriteId: "write-123"
        )
        XCTAssertEqual(append.kind, .append)
        XCTAssertEqual(append.targetWriteId, "write-123")
    }

    func testMarkdownPreviewRendersConstructsAndHidesFrontMatter() throws {
        let root = try temporaryDirectory()
        try write("image", to: root.appendingPathComponent("Media/pic.png"))
        let file = root.appendingPathComponent("Notes/preview.md")
        let markdown = """
        ---
        schema: "write.markdown-file.v1"
        title: "Preview Title"
        status: "draft"
        date: "2026-07-11"
        writeId: "hidden"
        writeFolderId: "notes"
        writeKind: "note"
        ---

        ## Section

        Paragraph with [local link](Notes/other.md) and `inline code`.

        - One
        - Two

        1. First
        2. Second

        > Quoted text

        ```swift
        let value = "<escaped>"
        ```

        ![Picture](Media/pic.png)
        """

        let html = QuickLookMarkdownPreview.html(for: markdown, fileURL: file)

        XCTAssertTrue(html.contains("<h1>Preview Title</h1>"))
        XCTAssertTrue(html.contains("<p class=\"byline\">draft | 2026-07-11</p>"))
        XCTAssertTrue(html.contains("<h2>Section</h2>"))
        XCTAssertTrue(html.contains("<a href=\"Notes/other.md\">local link</a>"))
        XCTAssertTrue(html.contains("<code>inline code</code>"))
        XCTAssertTrue(html.contains("<ul>"))
        XCTAssertTrue(html.contains("<ol>"))
        XCTAssertTrue(html.contains("<blockquote>"))
        XCTAssertTrue(html.contains("let value = \"&lt;escaped&gt;\""))
        // Local images render as a labeled placeholder, never a file:// src a
        // sandboxed Quick Look preview could not read.
        XCTAssertTrue(html.contains("<span class=\"image-placeholder\">Picture</span>"))
        XCTAssertFalse(html.contains("file://"))
        XCTAssertFalse(html.contains("Media/pic.png\""))
        XCTAssertFalse(html.contains("writeId"))
        XCTAssertFalse(html.contains("writeFolderId"))
        XCTAssertFalse(html.contains("writeKind"))
        XCTAssertFalse(html.contains("write.markdown-file.v1"))
    }

    func testMarkdownPreviewEscapesHTMLAndDropsRemoteResources() throws {
        let markdown = """
        <script>alert("x")</script>

        [Remote](https://example.invalid/a)

        ![Remote image](https://example.invalid/p.png)

        [Bad](javascript:alert(1))
        """

        let html = WriteMarkdownPreviewRenderer.renderHTML(markdown: markdown, workspaceRootURL: try temporaryDirectory())

        XCTAssertTrue(html.contains("&lt;script&gt;alert(\"x\")&lt;/script&gt;"))
        XCTAssertFalse(html.contains("<script>"))
        XCTAssertFalse(html.contains("https://example.invalid"))
        XCTAssertFalse(html.contains("javascript:"))
        XCTAssertTrue(html.contains("<span>Remote</span>"))
        XCTAssertTrue(html.contains("<span class=\"image-placeholder\">Remote image</span>"))
    }

    private func fixedDate() -> Date {
        ISO8601DateFormatter().date(from: "2026-07-11T12:34:56Z")!
    }

    private func temporaryDirectory() throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("WriteShareCoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
    }

    private func relative(_ url: URL, root: URL) -> String {
        WorkspaceLayout.relativePath(for: url, under: root) ?? url.path
    }
}
