import Foundation
import XCTest
import WriteWorkspaceCore
import WriteFileProviderKit
@testable import Write

final class OpenFileHandlerTests: XCTestCase {
    func testLegacyItemLinkPreservesExistingOpenBehavior() {
        let link = TexttextItemLink(
            url: URL(string: "write-app://item/item-123")!
        )

        XCTAssertEqual(link?.itemId, "item-123")
        XCTAssertNil(link?.workspaceHandle)
        XCTAssertNil(link?.mode)
    }

    func testAgentItemLinkTargetsExactWorkspaceAndEditMode() {
        let link = TexttextItemLink(
            url: URL(
                string: "write-app://item/item-123?workspace=shoku-space&mode=edit"
            )!
        )

        XCTAssertEqual(link?.itemId, "item-123")
        XCTAssertEqual(link?.workspaceHandle, "shoku-space")
        XCTAssertEqual(link?.mode, .edit)
    }

    func testItemLinkRejectsUnsafeOrAmbiguousTargets() {
        XCTAssertNil(TexttextItemLink(
            url: URL(string: "write-app://item/item%2Fother?workspace=shoku-space")!
        ))
        XCTAssertNil(TexttextItemLink(
            url: URL(string: "write-app://item/item-123?workspace=shoku%2Fspace")!
        ))
        XCTAssertNil(TexttextItemLink(
            url: URL(
                string: "write-app://item/item-123?workspace=one&workspace=two"
            )!
        ))
        XCTAssertNil(TexttextItemLink(
            url: URL(string: "write-app://item/item-123?mode=compose")!
        ))
    }

    func testExplicitModeOverridesTheDefaultKindBehavior() {
        let note = WriteItemOpenTarget(
            handle: "workspace",
            itemId: "note-id",
            slug: "note",
            kind: "note"
        )
        let article = WriteItemOpenTarget(
            handle: "workspace",
            itemId: "article-id",
            slug: "article",
            kind: "article"
        )

        XCTAssertEqual(note.appPath(mode: .read), "/t/workspace/note")
        XCTAssertEqual(
            article.appPath(mode: .edit),
            "/t/workspace/article?edit=1&id=article-id"
        )
    }

    func testPendingItemLinksKeepTheLatestModeForOneExactTarget() {
        var pending = PendingTexttextItemLinks()
        pending.enqueue(TexttextItemLink(
            url: URL(
                string: "write-app://item/item-123?workspace=shoku-space&mode=read"
            )!
        )!)
        pending.enqueue(TexttextItemLink(
            url: URL(
                string: "write-app://item/item-123?workspace=shoku-space&mode=edit"
            )!
        )!)

        let links = pending.drain()

        XCTAssertEqual(links.count, 1)
        XCTAssertEqual(links.first?.mode, .edit)
        XCTAssertEqual(pending.count, 0)
    }

    func testPendingItemLinksStayBoundedDuringColdLaunch() {
        var pending = PendingTexttextItemLinks()
        for index in 0..<12 {
            pending.enqueue(TexttextItemLink(
                url: URL(
                    string: "write-app://item/item-\(index)?workspace=shoku-space"
                )!
            )!)
        }

        let links = pending.drain()

        XCTAssertEqual(links.count, 8)
        XCTAssertEqual(links.first?.itemId, "item-4")
        XCTAssertEqual(links.last?.itemId, "item-11")
    }

    func testOnlyWriteFileProviderFileIdentifiersAreManaged() {
        XCTAssertTrue(OpenFileHandler.isWriteFileProviderItem("file:workspace:item-id"))
        XCTAssertFalse(OpenFileHandler.isWriteFileProviderItem("folder:workspace:folder-id"))
        XCTAssertFalse(OpenFileHandler.isWriteFileProviderItem("unrelated-provider-id"))
        XCTAssertFalse(OpenFileHandler.isWriteFileProviderItem(nil))
    }

    func testFileProviderNoteOpensInTheRegularNoteEditor() throws {
        let itemId = "b327ab80-cadf-439e-a589-975b7a610d67"
        let file = try temporaryFile(
            named: "for codex.md",
            contents: """
            ---
            slug: "for-codex"
            title: "for codex"
            kind: "note"
            status: "draft"
            ---

            A normal Write note.
            """
        )

        let target = OpenFileHandler.managedTarget(
            for: file,
            fallbackHandle: nil,
            fileProviderIdentifier: "file:bright-blue-journal:\(itemId)"
        )

        XCTAssertEqual(target?.handle, "bright-blue-journal")
        XCTAssertEqual(target?.itemId, itemId)
        XCTAssertEqual(target?.kind, "note")
        XCTAssertEqual(
            target?.appPath,
            "/t/bright-blue-journal/for-codex?edit=1&id=\(itemId)"
        )
    }

    func testWorkspaceIdentityOpensNoteWhenNoFileProviderIdentifierExists() throws {
        let serverText = """
        ---
        slug: local-note
        title: Local note
        kind: note
        ---

        Local body.
        """
        let text = MarkdownIdentityCodec.inject(
            into: serverText,
            itemId: "local-note-id",
            folderId: "notes-folder-id",
            kind: "note"
        )
        let file = try temporaryFile(named: "Local note.md", contents: text)

        let target = OpenFileHandler.managedTarget(
            for: file,
            fallbackHandle: "workspace-handle"
        )

        XCTAssertEqual(
            target?.appPath,
            "/t/workspace-handle/local-note?edit=1&id=local-note-id"
        )
    }

    func testManagedNoteCanFallBackToSlugWhenProviderOmitsItemId() throws {
        let file = try temporaryFile(
            named: "Provider note.md",
            contents: """
            ---
            slug: provider-note
            title: Provider note
            kind: note
            ---

            Body.
            """
        )

        let target = OpenFileHandler.managedTarget(
            for: file,
            fallbackHandle: "workspace-handle"
        )

        XCTAssertNil(target?.itemId)
        XCTAssertEqual(target?.appPath, "/t/workspace-handle/provider-note?edit=1")
    }

    func testManagedArticleOpensInItsNormalItemView() throws {
        let file = try temporaryFile(
            named: "Article.md",
            contents: """
            ---
            slug: article-slug
            title: Article
            kind: article
            ---

            Article body.
            """
        )

        let target = OpenFileHandler.managedTarget(
            for: file,
            fallbackHandle: nil,
            fileProviderIdentifier: "file:workspace-handle:article-id"
        )

        XCTAssertEqual(target?.appPath, "/t/workspace-handle/article-slug")
    }

    func testFilenameAndTitleCharactersDoNotControlManagedIdentity() throws {
        let file = try temporaryFile(
            named: "Why question question.md",
            contents: """
            ---
            slug: why-question-question
            title: "Why?? / really: yes"
            kind: note
            ---

            Body.
            """
        )

        let target = OpenFileHandler.managedTarget(
            for: file,
            fallbackHandle: nil,
            fileProviderIdentifier: "file:workspace-handle:stable-item-id"
        )

        XCTAssertEqual(target?.itemId, "stable-item-id")
        XCTAssertEqual(
            target?.appPath,
            "/t/workspace-handle/why-question-question?edit=1&id=stable-item-id"
        )
    }

    func testExternalTextFileBecomesANormalNote() throws {
        let file = try temporaryFile(
            named: "Outside note.txt",
            contents: "Plain text stays intact."
        )

        let item = try OpenFileHandler.externalNoteImport(for: file)

        XCTAssertEqual(item.title, "Outside note")
        XCTAssertEqual(item.body, "Plain text stays intact.")
        XCTAssertTrue(item.markdown.contains("title: \"Outside note\""))
        XCTAssertTrue(item.markdown.contains("kind: note"))
        XCTAssertTrue(item.markdown.hasSuffix("Plain text stays intact."))
    }

    func testExternalMarkdownFrontmatterIsUsedWithoutDuplicatingIt() throws {
        let file = try temporaryFile(
            named: "filename.md",
            contents: """
            ---
            title: "Why??"
            custom: value
            ---

            Markdown body.
            """
        )

        let item = try OpenFileHandler.externalNoteImport(for: file)

        XCTAssertEqual(item.title, "Why??")
        XCTAssertEqual(item.body, "\nMarkdown body.")
        XCTAssertFalse(item.body.contains("custom: value"))
        XCTAssertTrue(item.markdown.contains("title: \"Why??\""))
    }

    func testExternalImportIsIdempotentForUnchangedFile() throws {
        let file = try temporaryFile(named: "Repeat.md", contents: "First body")
        let first = try OpenFileHandler.externalNoteImport(for: file)
        let second = try OpenFileHandler.externalNoteImport(for: file)
        try "Second body".write(to: file, atomically: true, encoding: .utf8)
        let changed = try OpenFileHandler.externalNoteImport(for: file)

        XCTAssertEqual(first.idempotencyKey, second.idempotencyKey)
        XCTAssertNotEqual(first.idempotencyKey, changed.idempotencyKey)
    }

    func testTextPackWorkspaceFileOpensAsManagedTarget() throws {
        // A double-clicked `.textpack` (zipped textbundle) must resolve to its
        // post, not garble as raw bytes: text(at:) routes it through the package
        // reader, and managedTarget then parses the text.md frontmatter.
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let markdown = """
        ---
        slug: "hello-textpack"
        title: "Hello TextPack"
        kind: "article"
        status: "draft"
        ---

        Body inside a zipped textbundle.
        """
        let bundle = try WriteTextBundlePackage.materialize(
            canonicalMarkdown: markdown, assets: [], sourceURL: nil, in: root)
        let zipped = try WriteTextBundlePackage.zipToTextPack(
            packageURL: bundle.url, in: root)
        let named = root.appendingPathComponent("Hello TextPack.textpack")
        try FileManager.default.moveItem(at: zipped, to: named)

        let target = OpenFileHandler.managedTarget(
            for: named,
            fallbackHandle: "demo",
            fileProviderIdentifier: "file:demo:item-99")
        XCTAssertEqual(target?.handle, "demo")
        XCTAssertEqual(target?.itemId, "item-99")
        XCTAssertEqual(target?.slug, "hello-textpack")
        XCTAssertEqual(target?.kind, "article")
    }

    private func temporaryFile(named name: String, contents: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent(name)
        try contents.write(to: file, atomically: true, encoding: .utf8)
        return file
    }
}
