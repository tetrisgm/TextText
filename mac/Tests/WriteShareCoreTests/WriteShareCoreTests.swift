import Foundation
import XCTest
@testable import Write
import WriteFileProviderKit
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

    func testPrepareRendersEachKindForServerCreation() throws {
        let filer = InboxFiler(root: try temporaryDirectory(), now: fixedDate)

        // Note -> create in the notes folder; server assigns the id, so none is
        // injected into the body.
        guard case let .create(noteMode, noteBody, noteRep, noteKey) =
            try filer.prepare(record(InboxItem(kind: .note, title: "Meeting Notes", text: "Body")))
        else { return XCTFail("note should prepare as .create") }
        XCTAssertEqual(noteMode, "notes")
        XCTAssertEqual(noteRep, .textpack)
        XCTAssertTrue(noteBody.contains("title: \"Meeting Notes\""))
        XCTAssertTrue(noteBody.contains("kind: \"note\""))
        XCTAssertFalse(noteBody.contains("writeId"), "the server assigns the id; none is injected")
        XCTAssertFalse(noteKey.isEmpty)

        // Bookmark -> create in bookmarks with the links: list rendered verbatim
        // so the server round-trip hash agrees; no bare url: key.
        guard case let .create(bookmarkMode, bookmarkBody, _, _) =
            try filer.prepare(record(InboxItem(
                kind: .bookmark, title: "Example Link", text: "Selected quote",
                urlString: "https://example.invalid/article")))
        else { return XCTFail("bookmark should prepare as .create") }
        XCTAssertEqual(bookmarkMode, "bookmarks")
        XCTAssertTrue(bookmarkBody.contains("type: \"bookmark\""))
        XCTAssertTrue(
            bookmarkBody.contains("links: [{\"label\":\"Example Link\",\"href\":\"https://example.invalid/article\"}]"),
            bookmarkBody
        )
        XCTAssertFalse(bookmarkBody.contains("\nurl: "), "bare url: is dropped by the server")
        XCTAssertTrue(bookmarkBody.contains("created_at: \"2026-07-11T12:34:56Z\""))
        XCTAssertTrue(bookmarkBody.contains("Selected quote"))
        XCTAssertFalse(bookmarkBody.contains("writeId"))

        // Draft -> create in the blog folder as an article.
        guard case let .create(draftMode, draftBody, _, _) =
            try filer.prepare(record(InboxItem(kind: .draft, title: "Draft Title", text: "Draft body")))
        else { return XCTFail("draft should prepare as .create") }
        XCTAssertEqual(draftMode, "blog")
        XCTAssertTrue(draftBody.contains("kind: \"article\""))
        XCTAssertTrue(draftBody.contains("Draft body"))

        // File -> unsupported (no server home post-cutover).
        guard case .unsupported =
            try filer.prepare(record(InboxItem(kind: .file, title: "Photo", payloadFilename: "photo.png")))
        else { return XCTFail("file should prepare as .unsupported") }
    }

    func testPrepareAppendCarriesTargetAndText() throws {
        let filer = InboxFiler(root: try temporaryDirectory(), now: fixedDate)
        guard case let .append(targetWriteId, text) =
            try filer.prepare(record(InboxItem(
                kind: .append, text: "Appended body", targetWriteId: "target-id")))
        else { return XCTFail("append should prepare as .append") }
        XCTAssertEqual(targetWriteId, "target-id")
        XCTAssertEqual(text, "Appended body\n")
    }

    func testPrepareUsesRecordIdForIdempotency() throws {
        let filer = InboxFiler(root: try temporaryDirectory(), now: fixedDate)
        let item = InboxItem(kind: .note, title: "Same", text: "New")
        let keyA = createKey(try filer.prepare(record(item, id: "rec-1")))
        let keyB = createKey(try filer.prepare(record(item, id: "rec-1")))
        let keyC = createKey(try filer.prepare(record(item, id: "rec-2")))
        XCTAssertEqual(keyA, keyB, "the same record must produce a stable idempotency key")
        XCTAssertNotEqual(keyA, keyC, "different records must produce different keys")
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

    private func record(_ item: InboxItem, id: String = "rec-1") -> InboxRecord {
        InboxRecord(
            id: id, item: item,
            directoryURL: URL(fileURLWithPath: "/tmp/write-share-\(id)", isDirectory: true),
            payloadURL: nil)
    }

    private func createKey(_ prepared: PreparedInboxItem) -> String? {
        if case let .create(_, _, _, key) = prepared { return key }
        return nil
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
