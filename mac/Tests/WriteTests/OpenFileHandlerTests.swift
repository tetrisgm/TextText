import Foundation
import XCTest
import WriteWorkspaceCore
import WriteFileProviderKit
@testable import Write

final class OpenFileHandlerTests: XCTestCase {
    func testWorkspaceMarkdownIsMetadataAware() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        let file = root.appendingPathComponent("Notes/Item.MD")
        XCTAssertEqual(OpenFileHandler.kind(for: file, syncRoot: root), .workspace)
    }

    func testExternalTextFormatsOpenLiterally() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        for name in ["note.md", "note.markdown", "note.txt", "NOTE.TXT"] {
            let file = URL(fileURLWithPath: "/tmp/outside/\(name)")
            XCTAssertEqual(
                OpenFileHandler.kind(for: file, syncRoot: root),
                .external,
                name
            )
        }
    }

    func testUnsupportedFilesAreRejected() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        let file = URL(fileURLWithPath: "/tmp/outside/image.png")
        XCTAssertEqual(OpenFileHandler.kind(for: file, syncRoot: root), .unsupported)
    }

    func testInternalWorkspaceMetadataIsNotOpenedAsContent() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        let file = root.appendingPathComponent(".write-local.nosync/state/index.md")
        XCTAssertEqual(OpenFileHandler.kind(for: file, syncRoot: root), .unsupported)
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
