import Foundation
import XCTest
@testable import WriteWorkspaceCore

final class WriteWorkspaceCoreTests: XCTestCase {
    func testLayoutCreatesCanonicalWorkspaceShape() throws {
        let root = try temporaryDirectory()
        let workspace = fixtureWorkspace()
        let location = WorkspaceLocation(
            url: root,
            kind: .injected,
            iCloudAvailable: false,
            statusMessage: "test"
        )

        try WorkspaceLayout.ensureSkeleton(at: root, workspace: workspace, location: location)

        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Blogs/demo/Posts").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Blogs/demo/Media").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Bookmarks").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Drafts").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Media").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".write/workspace.yaml").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Blogs/demo/blog.yaml").path))

        let blogFolder = workspace.folders.first { $0.path == "blog" }!
        let notesFolder = workspace.folders.first { $0.path == "notes" }!
        let bookmarksFolder = workspace.folders.first { $0.path == "bookmarks" }!

        XCTAssertEqual(
            WorkspaceLayout.relativePath(
                for: WorkspaceItemDescriptor(id: "1", kind: "article", slug: "hello", status: "published"),
                in: blogFolder,
                workspace: workspace
            ),
            "Blogs/demo/Posts/hello.md"
        )
        XCTAssertEqual(
            WorkspaceLayout.relativePath(
                for: WorkspaceItemDescriptor(id: "2", kind: "article", slug: "draft", status: "draft"),
                in: blogFolder,
                workspace: workspace
            ),
            "Drafts/draft.md"
        )
        XCTAssertEqual(
            WorkspaceLayout.relativePath(
                for: WorkspaceItemDescriptor(id: "3", kind: "note", slug: "note", status: "draft"),
                in: notesFolder,
                workspace: workspace
            ),
            "Notes/note.md"
        )
        XCTAssertEqual(
            WorkspaceLayout.relativePath(
                for: WorkspaceItemDescriptor(
                    id: "4",
                    kind: "bookmark",
                    slug: "example",
                    status: "draft",
                    createdAt: "2026-04-01T00:00:00Z"
                ),
                in: bookmarksFolder,
                workspace: workspace
            ),
            "Bookmarks/2026/example.md"
        )
    }

    func testMarkdownIdentityRoundTripAndCanonicalHash() throws {
        let serverText = """
        ---
        schema: "write.markdown-file.v1"
        title: "Known"
        ---

        Body
        """

        let withIdentity = MarkdownIdentityCodec.inject(
            into: serverText,
            itemId: "post-1",
            folderId: "folder-1",
            kind: "note"
        )

        XCTAssertEqual(
            MarkdownIdentityCodec.extract(from: withIdentity),
            MarkdownIdentity(itemId: "post-1", folderId: "folder-1", kind: "note")
        )
        XCTAssertEqual(MarkdownIdentityCodec.strip(from: withIdentity), serverText)
        XCTAssertEqual(
            MarkdownIdentityCodec.syncHash(for: withIdentity),
            MarkdownIdentityCodec.syncHash(for: serverText)
        )
    }

    func testIndexRebuildFromMarkdownIdentity() throws {
        let root = try temporaryDirectory()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        let note = root.appendingPathComponent("Notes/alpha.md")
        try Data(MarkdownIdentityCodec.inject(
            into: "---\ntitle: Alpha\n---\n\nBody\n",
            itemId: "post-alpha",
            folderId: "notes",
            kind: "note"
        ).utf8).write(to: note)

        let rebuilt = WorkspaceIndexStore.rebuild(root: root)
        XCTAssertEqual(Set(rebuilt.entries.keys), ["post-alpha"])
        XCTAssertEqual(rebuilt.entries["post-alpha"]?.relativePath, "Notes/alpha.md")
        XCTAssertEqual(rebuilt.entries["post-alpha"]?.folderId, "notes")
        XCTAssertEqual(rebuilt.entries["post-alpha"]?.kind, "note")

        try WorkspaceIndexStore.save(rebuilt, root: root)
        let loaded = try XCTUnwrap(WorkspaceIndexStore.load(root: root))
        XCTAssertEqual(loaded.entries, rebuilt.entries)
    }

    func testExternalEditsRenameMoveDeleteAreDetected() throws {
        let root = try temporaryDirectory()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Drafts"), withIntermediateDirectories: true)
        try writeMarkdown(root.appendingPathComponent("Notes/a.md"), id: "a", body: "A")
        try writeMarkdown(root.appendingPathComponent("Notes/b.md"), id: "b", body: "B")
        try writeMarkdown(root.appendingPathComponent("Notes/remove.md"), id: "remove", body: "Remove")
        try writeMarkdown(root.appendingPathComponent("Notes/move.md"), id: "move", body: "Move")

        let before = WorkspaceChangeScanner.snapshot(root: root)
        try writeMarkdown(root.appendingPathComponent("Notes/a.md"), id: "a", body: "A edited")
        try FileManager.default.moveItem(
            at: root.appendingPathComponent("Notes/b.md"),
            to: root.appendingPathComponent("Notes/renamed.md")
        )
        try FileManager.default.moveItem(
            at: root.appendingPathComponent("Notes/move.md"),
            to: root.appendingPathComponent("Drafts/move.md")
        )
        try FileManager.default.removeItem(at: root.appendingPathComponent("Notes/remove.md"))
        try writeMarkdown(root.appendingPathComponent("Notes/new.md"), id: "new", body: "New")

        let changes = WorkspaceChangeScanner.diff(from: before, to: WorkspaceChangeScanner.snapshot(root: root))
        XCTAssertTrue(changes.contains(.modified("Notes/a.md")))
        XCTAssertTrue(changes.contains(.renamed(from: "Notes/b.md", to: "Notes/renamed.md")))
        XCTAssertTrue(changes.contains(.moved(from: "Notes/move.md", to: "Drafts/move.md")))
        XCTAssertTrue(changes.contains(.deleted("Notes/remove.md")))
        XCTAssertTrue(changes.contains(.created("Notes/new.md")))
    }

    func testFolderWatcherReceivesTempDirectoryFileEventWithoutCrashing() throws {
        let root = try fseventsTemporaryDirectory()
        let queue = DispatchQueue(label: "WriteWorkspaceCoreTests.folder-watcher")
        let fired = DispatchSemaphore(value: 0)
        let watcher = try XCTUnwrap(WorkspaceFolderWatcher(
            path: root.path,
            queue: queue,
            includeUbiquitousItems: false
        ) {
            fired.signal()
        })
        defer { watcher.stop() }
        guard watcher.fseventsStarted else {
            throw XCTSkip("FSEvents stream did not start in this test runner")
        }

        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        try Data("hello\n".utf8).write(to: root.appendingPathComponent("event.md"))
        watcher.flush()

        let deadline = Date().addingTimeInterval(5)
        var received = false
        while Date() < deadline {
            if fired.wait(timeout: .now()) == .success {
                received = true
                break
            }
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        XCTAssertTrue(received)
    }

    func testMetadataQueryStartsWithWatcherPredicateWithoutCrashing() throws {
        let root = try temporaryDirectory()
        let query = NSMetadataQuery()
        query.searchScopes = [root.path]
        query.predicate = WorkspaceFolderWatcher.metadataPredicate()

        _ = query.start()
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        query.stop()
    }

    func testFolderWatcherFiltersCFEventPathsWithoutCrashing() throws {
        let root = try temporaryDirectory()
        let watcher = try XCTUnwrap(WorkspaceFolderWatcher(
            path: root.path,
            queue: DispatchQueue(label: "WriteWorkspaceCoreTests.cf-event-paths"),
            includeUbiquitousItems: false
        ) {})
        defer { watcher.stop() }

        XCTAssertTrue(watcher.shouldHandleEventPathsForTesting([
            root.appendingPathComponent("Notes/a.md").path
        ]))
        XCTAssertFalse(watcher.shouldHandleEventPathsForTesting([
            root.appendingPathComponent(".write/state/index.json").path
        ]))
    }

    func testLegacyMigrationRemapsOldLayoutAndPreservesConflictingUserFiles() throws {
        let legacy = try temporaryDirectory()
        let workspace = try temporaryDirectory()
        let descriptor = fixtureWorkspace()
        try FileManager.default.createDirectory(at: legacy.appendingPathComponent("blog"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: legacy.appendingPathComponent("notes"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: legacy.appendingPathComponent("bookmarks"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: workspace.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try Data("blog edit".utf8).write(to: legacy.appendingPathComponent("blog/post.md"))
        try Data("---\nstatus: draft\n---\n\nDraft\n".utf8)
            .write(to: legacy.appendingPathComponent("blog/draft.md"))
        try Data("---\ncreatedAt: \"2024-02-01T00:00:00Z\"\n---\n\nBookmark\n".utf8)
            .write(to: legacy.appendingPathComponent("bookmarks/link.md"))
        try Data("same".utf8).write(to: legacy.appendingPathComponent("notes/same.md"))
        try Data("same".utf8).write(to: workspace.appendingPathComponent("Notes/same.md"))
        try Data("legacy".utf8).write(to: legacy.appendingPathComponent("notes/conflict.md"))
        try Data("workspace".utf8).write(to: workspace.appendingPathComponent("Notes/conflict.md"))
        try Data("new".utf8).write(to: legacy.appendingPathComponent("notes/new.md"))
        try Data("marker".utf8).write(to: legacy.appendingPathComponent(".write-sync"))

        let summary = WorkspaceMigrator.migrateLegacyMirror(from: legacy, to: workspace, workspace: descriptor)

        XCTAssertEqual(summary.errors, [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("Notes/new.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("Blogs/demo/Posts/post.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("Drafts/draft.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("Bookmarks/2024/link.md").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: workspace.appendingPathComponent("blog/post.md").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: workspace.appendingPathComponent(".write-sync").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: workspace.appendingPathComponent(".write-local.nosync/state/sync-marker.txt").path))
        XCTAssertEqual(
            try String(contentsOf: workspace.appendingPathComponent("Notes/conflict.md")),
            "workspace"
        )
        let notes = try FileManager.default.contentsOfDirectory(atPath: workspace.appendingPathComponent("Notes").path)
        XCTAssertTrue(notes.contains { $0.contains("conflicted copy migration") })
        XCTAssertGreaterThanOrEqual(summary.conflicts, 1)
    }

    func testSkeletonAndIndexWritesAreStableWhenBytesDoNotChange() throws {
        let root = try temporaryDirectory()
        let workspace = fixtureWorkspace()
        try WorkspaceLayout.ensureSkeleton(at: root, workspace: workspace)
        let workspaceYAML = root.appendingPathComponent(".write/workspace.yaml")
        let blogYAML = root.appendingPathComponent("Blogs/demo/blog.yaml")
        let oldDate = Date(timeIntervalSince1970: 1_000)
        try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: workspaceYAML.path)
        try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: blogYAML.path)

        try WorkspaceLayout.ensureSkeleton(at: root, workspace: workspace)

        XCTAssertEqual(modificationDate(workspaceYAML), oldDate)
        XCTAssertEqual(modificationDate(blogYAML), oldDate)

        let index = SyncIndex(entries: [
            "a": IndexEntry(hash: "h", relativePath: "Notes/a.md", folderId: "notes", kind: "note")
        ])
        try WorkspaceIndexStore.save(index, root: root)
        let indexURL = WorkspaceIndexStore.indexURL(root: root)
        try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: indexURL.path)
        try WorkspaceIndexStore.save(index, root: root)
        XCTAssertEqual(modificationDate(indexURL), oldDate)
    }

    func testIndexRebuildPrefersExistingPathWhenDuplicateWriteIdExists() throws {
        let root = try temporaryDirectory()
        try writeMarkdown(root.appendingPathComponent("Notes/foo.md"), id: "p1", body: "Original")
        try writeMarkdown(root.appendingPathComponent("Notes/template.md"), id: "p1", body: "Copy")

        let rebuilt = WorkspaceIndexStore.rebuild(
            root: root,
            preferredPaths: ["p1": "Notes/foo.md"]
        )

        XCTAssertEqual(rebuilt.entries["p1"]?.relativePath, "Notes/foo.md")
    }

    func testIdentitySweepCanSeeSkippedMediaAndDotFolders() throws {
        let root = try temporaryDirectory()
        try writeMarkdown(root.appendingPathComponent("Notes/media/research.md"), id: "media-id", body: "Media")
        try writeMarkdown(root.appendingPathComponent("Notes/.hidden/hidden.md"), id: "hidden-id", body: "Hidden")

        XCTAssertNil(WorkspaceIndexStore.rebuild(root: root).entries["media-id"])
        let swept = WorkspaceIndexStore.rebuild(root: root, includeSkippedDirectories: true)
        XCTAssertEqual(swept.entries["media-id"]?.relativePath, "Notes/media/research.md")
        XCTAssertEqual(swept.entries["hidden-id"]?.relativePath, "Notes/.hidden/hidden.md")
    }

    func testFallbackRootAvoidsTCCGatedDocumentsFolder() throws {
        let fallback = WorkspaceRootResolver.documentsFallbackWriteRoot()
        XCTAssertEqual(fallback, FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Write Local", isDirectory: true))
    }

    private func fixtureWorkspace() -> WorkspaceDescriptor {
        WorkspaceDescriptor(
            blog: WorkspaceBlogDescriptor(handle: "demo", name: "Demo"),
            folders: [
                WorkspaceFolderDescriptor(id: "blog", name: "Blog", path: "blog", mode: "blog"),
                WorkspaceFolderDescriptor(id: "notes", name: "Notes", path: "notes", mode: "notes"),
                WorkspaceFolderDescriptor(id: "bookmarks", name: "Bookmarks", path: "bookmarks", mode: "bookmarks"),
            ]
        )
    }

    private func writeMarkdown(_ url: URL, id: String, body: String) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let text = MarkdownIdentityCodec.inject(into: "---\ntitle: \(id)\n---\n\n\(body)\n", itemId: id, folderId: "folder", kind: "note")
        try Data(text.utf8).write(to: url)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("WriteWorkspaceCoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func fseventsTemporaryDirectory() throws -> URL {
        let url = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("WriteWorkspaceCoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func modificationDate(_ url: URL) -> Date? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attrs?[.modificationDate] as? Date
    }
}
