import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextEditor

final class EditorDocumentTests: XCTestCase {
    func testStandaloneMarkdownKeepsFrontMatterVisibleAndLiteral() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("outside.md")
        let source = """
        ---
        title: Not TextText metadata
        custom: keep this visible
        ---

        Original body
        """ + "\n"
        try write(Data(source.utf8), to: url)

        let document = try EditorDocument(standaloneFileURL: url)
        XCTAssertEqual(document.mode, .standalone)
        XCTAssertFalse(document.allowsTitleEditing)
        XCTAssertEqual(document.title, "outside")
        XCTAssertEqual(document.body, source)

        document.setBody(source.replacingOccurrences(of: "Original", with: "Edited"))
        try document.save()
        XCTAssertEqual(
            try String(contentsOf: url, encoding: .utf8),
            source.replacingOccurrences(of: "Original", with: "Edited")
        )
    }

    func testStandaloneTextNeverInjectsTextTextMetadata() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("plain.txt")
        try write(Data("Literal text\n".utf8), to: url)

        let document = try EditorDocument(standaloneFileURL: url)
        document.setTitle("Attempted metadata title")
        document.setBody("Changed text\n")
        try document.save()

        XCTAssertEqual(document.title, "plain")
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "Changed text\n")
        XCTAssertFalse(try String(contentsOf: url, encoding: .utf8).contains("---"))
    }

    func testStandaloneConflictCopyPreservesOriginalExtension() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("plain.txt")
        try write(Data("Text\n".utf8), to: url)

        let document = try EditorDocument(standaloneFileURL: url)
        XCTAssertEqual(document.conflictedCopyURL(for: url).pathExtension, "txt")
    }

    func testFrontMatterRoundTripPreservesHeaderBytesWhenBodyChanges() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/round-trip.md")
        let frontMatter = Data("""
        ---
        title: "Original"
        status: "draft"
        custom: "keep me"
        ---

        """.utf8)
        try write(frontMatter + Data("Old body\n".utf8), to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        document.setBody("New body\n")
        try document.save()

        let saved = try read(url, root: root)
        XCTAssertEqual(saved.prefix(frontMatter.count), frontMatter)
        XCTAssertEqual(String(data: saved.dropFirst(frontMatter.count), encoding: .utf8), "New body\n")
    }

    func testTitleEditRewritesOnlyTitleLineAndPreservesQuotingStyle() throws {
        try assertTitleRewrite(
            originalTitleLine: #"title: "Old title""#,
            newTitle: #"New "quoted" title"#,
            expectedTitleLine: #"title: "New \"quoted\" title""#
        )
        try assertTitleRewrite(
            originalTitleLine: "title: 'Old title'",
            newTitle: "Writer's title",
            expectedTitleLine: "title: 'Writer''s title'"
        )
        try assertTitleRewrite(
            originalTitleLine: "title: Old title",
            newTitle: "Plain title",
            expectedTitleLine: "title: Plain title"
        )
    }

    func testDirtyDocumentExternalChangeCreatesConflictedCopyWithoutLosingEitherVersion() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/conflict.md")
        let original = markdown(title: "Conflict", body: "Original\n")
        let external = markdown(title: "Conflict", body: "External\n")
        try write(Data(original.utf8), to: url)

        let coordinator = WorkspaceFileCoordinator(rootURL: root)
        let document = try EditorDocument(
            fileURL: url,
            workspaceRootURL: root,
            coordinator: coordinator,
            dateProvider: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
        document.setBody("Local dirty\n")
        try coordinator.writeData(Data(external.utf8), to: url)

        let result = try document.handleExternalChange()
        guard case .conflictedCopy(let conflictURL) = result else {
            return XCTFail("expected conflicted copy, got \(result)")
        }

        XCTAssertEqual(document.body, "Local dirty\n")
        XCTAssertEqual(try readText(conflictURL, root: root), external)

        try document.save()
        XCTAssertEqual(
            try readText(url, root: root),
            """
            ---
            title: "Conflict"
            status: "draft"
            ---
            Local dirty

            """
        )
        XCTAssertEqual(try readText(conflictURL, root: root), external)
    }

    func testMarkdownBodyRoundTripsByteIdenticalWithoutEdits() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/code.md")
        let source = """
        ---
        title: "Code"
        status: "draft"
        ---

        Prose before.

        ```yaml
        title: not front matter
        ---
        value: keep
        ```

        Inline `code: value` and [link](/local/path).

        slug: yaml-looking prose
        """
        let data = Data((source + "\n").utf8)
        try write(data, to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        try document.save()

        XCTAssertEqual(try read(url, root: root), data)
    }

    func testCanonicalDoubleQuotedTitleDecodesWithoutQuotes() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/quoted.md")
        try write(Data(markdown(title: "Untitled", body: "Body\n").utf8), to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        XCTAssertEqual(document.title, "Untitled")

        document.setTitle("Untitled 2")
        try document.save()
        let saved = try readText(url, root: root)
        XCTAssertTrue(saved.contains("title: \"Untitled 2\"\n"), saved)
        XCTAssertFalse(saved.contains("\\\""), "title must not double-encode: \(saved)")

        let reopened = try EditorDocument(fileURL: url, workspaceRootURL: root)
        XCTAssertEqual(reopened.title, "Untitled 2")
    }

    func testEscapedTitleDecodesAndRoundTrips() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/escaped.md")
        try write(Data("---\ntitle: \"A \\\"q\\\" B\"\nstatus: \"draft\"\n---\n\nBody\n".utf8), to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        XCTAssertEqual(document.title, "A \"q\" B")
    }

    func testSaveWithUnseenExternalWritePreservesItAsConflictedCopy() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/cas.md")
        let original = markdown(title: "CAS", body: "Original\n")
        let external = markdown(title: "CAS", body: "External\n")
        try write(Data(original.utf8), to: url)

        let coordinator = WorkspaceFileCoordinator(rootURL: root)
        let document = try EditorDocument(
            fileURL: url,
            workspaceRootURL: root,
            coordinator: coordinator,
            dateProvider: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
        document.setBody("Local dirty\n")
        // External write lands and the presenter callback never runs before
        // the autosave; save must still preserve it.
        try coordinator.writeData(Data(external.utf8), to: url)
        try document.save()

        XCTAssertTrue(try readText(url, root: root).contains("Local dirty\n"))
        let conflicts = try FileManager.default
            .contentsOfDirectory(atPath: url.deletingLastPathComponent().path)
            .filter { $0.contains("conflicted copy") }
        XCTAssertEqual(conflicts.count, 1, "the unseen external write must survive")
        let conflictURL = url.deletingLastPathComponent().appendingPathComponent(conflicts[0])
        XCTAssertEqual(try readText(conflictURL, root: root), external)
    }

    func testSaveOrRecoverPreservesBufferWhenSaveFails() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/failing.md")
        try write(Data(markdown(title: "Failing", body: "Body\n").utf8), to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        document.setBody("Unsaved buffer\n")
        let notesDirectory = url.deletingLastPathComponent()
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o555], ofItemAtPath: notesDirectory.path)
        defer {
            try? FileManager.default.setAttributes(
                [.posixPermissions: 0o755], ofItemAtPath: notesDirectory.path)
        }

        let recoveryURL = try XCTUnwrap(document.saveOrRecover())
        let recovered = try XCTUnwrap(String(data: Data(contentsOf: recoveryURL), encoding: .utf8))
        XCTAssertTrue(recovered.contains("Unsaved buffer\n"))
        XCTAssertTrue(recoveryURL.path.contains(WorkspaceLayout.localMetadataDirectoryName))
    }

    func testEditorFollowsExternalRename() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/original-name.md")
        let identified = """
        ---
        textTextId: "11111111-2222-3333-4444-555555555555"
        textTextFolderId: "notes"
        textTextKind: "note"
        title: "Renamed"
        status: "draft"
        ---

        Body
        """
        try write(Data((identified + "\n").utf8), to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        let newURL = root.appendingPathComponent("Notes/server-name.md")
        try FileManager.default.moveItem(at: url, to: newURL)

        document.setBody("Edited after rename\n")
        try document.save()

        XCTAssertFalse(
            FileManager.default.fileExists(atPath: url.path),
            "the dead path must not be resurrected"
        )
        XCTAssertEqual(document.fileURL, newURL)
        XCTAssertTrue(try readText(newURL, root: root).contains("Edited after rename\n"))
    }

    func testUntitledNotesGetDistinctTitles() throws {
        let root = try temporaryDirectory()
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        let first = try EditorNoteCreator.createUntitledNote(in: root)
        let second = try EditorNoteCreator.createUntitledNote(in: root)
        let third = try EditorNoteCreator.createUntitledNote(in: root)

        let titles = try [first, second, third].map {
            try EditorDocument(fileURL: $0, workspaceRootURL: root).title
        }
        XCTAssertEqual(Set(titles).count, 3, "titles must be distinct: \(titles)")
        XCTAssertEqual(titles[0], "Untitled")
        XCTAssertEqual(titles[1], "Untitled 2")
    }

    func testIdentityInjectionWhileDirtyMergesInsteadOfConflicting() throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/identity.md")
        let originalBody = "\nShared body\n"
        let original = "---\ntitle: \"Identity\"\nstatus: \"draft\"\n---\n" + originalBody
        try write(Data(original.utf8), to: url)

        let coordinator = WorkspaceFileCoordinator(rootURL: root)
        let document = try EditorDocument(
            fileURL: url, workspaceRootURL: root, coordinator: coordinator)
        document.setBody("User edit\n")

        // The sync engine injects identity: front matter changes, body stays
        // byte-identical (note the explicit newline after the delimiter).
        let injected = "---\n"
            + "textTextId: \"99999999-8888-7777-6666-555555555555\"\n"
            + "textTextFolderId: \"notes\"\n"
            + "textTextKind: \"note\"\n"
            + "title: \"Identity\"\n"
            + "status: \"draft\"\n"
            + "---\n"
            + originalBody
        try coordinator.writeData(Data(injected.utf8), to: url)

        let result = try document.handleExternalChange()
        XCTAssertEqual(result, .mergedIdentity)
        XCTAssertEqual(document.body, "User edit\n")

        try document.save()
        let saved = try readText(url, root: root)
        XCTAssertTrue(saved.contains("textTextId: \"99999999-8888-7777-6666-555555555555\""))
        XCTAssertTrue(saved.contains("User edit\n"))
        let conflicts = try FileManager.default
            .contentsOfDirectory(atPath: url.deletingLastPathComponent().path)
            .filter { $0.contains("conflicted copy") }
        XCTAssertEqual(conflicts, [], "identity injection must not create conflict litter")
    }

    private func assertTitleRewrite(
        originalTitleLine: String,
        newTitle: String,
        expectedTitleLine: String
    ) throws {
        let root = try temporaryDirectory()
        let url = root.appendingPathComponent("Notes/title.md")
        let source = """
        ---
        schema: "texttext.markdown-file.v1"
        \(originalTitleLine)
        status: "draft"
        ---

        Body stays.
        """
        try write(Data((source + "\n").utf8), to: url)

        let document = try EditorDocument(fileURL: url, workspaceRootURL: root)
        document.setTitle(newTitle)
        try document.save()

        let expected = """
        ---
        schema: "texttext.markdown-file.v1"
        \(expectedTitleLine)
        status: "draft"
        ---

        Body stays.
        """
        XCTAssertEqual(try readText(url, root: root), expected + "\n")
    }

    private func markdown(title: String, body: String) -> String {
        """
        ---
        title: "\(title)"
        status: "draft"
        ---

        \(body)
        """
    }

    private func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
    }

    private func read(_ url: URL, root: URL) throws -> Data {
        try WorkspaceFileCoordinator(rootURL: root).readData(at: url)
    }

    private func readText(_ url: URL, root: URL) throws -> String {
        let data = try read(url, root: root)
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("TextTextEditorTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
