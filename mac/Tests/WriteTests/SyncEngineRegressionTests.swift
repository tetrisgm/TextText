import Foundation
import XCTest
import WriteWorkspaceCore
@testable import Write

final class SyncEngineRegressionTests: XCTestCase {
    func testFreshInstallIgnoresForeignRootIndexAndDoesNotDeleteMissingFiles() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let serverText = markdown(title: "A", body: "server")
        let hash = MarkdownIdentityCodec.syncHash(for: serverText)
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "a", status: "draft", hash: hash)
        ], etag: nil)
        fake.fileTexts["p1"] = serverText

        try FileManager.default.createDirectory(at: root.appendingPathComponent(".write/state"), withIntermediateDirectories: true)
        try WorkspaceIndexStore.save(
            SyncIndex(entries: [
                "p1": IndexEntry(hash: hash, relativePath: "Notes/a.md", folderId: "notes", kind: "note")
            ]),
            root: root
        )
        try Data("foreign marker".utf8).write(to: root.appendingPathComponent(".write/state/sync-marker.txt"))

        let (_, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/a.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt").path))
    }

    func testManifestItemsMaterializeAsMarkdownFilesNotOnlyIndexRows() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let noteText = markdown(title: "Note", body: "note")
        let postText = markdown(title: "Post", slug: "post", status: "published", body: "post")
        let bookmarkText = markdown(title: "Link", body: "bookmark")
        fake.manifestReplies["notes"] = .manifest([
            item(id: "n1", kind: "note", slug: "note", status: "draft", hash: MarkdownIdentityCodec.syncHash(for: noteText))
        ], etag: nil)
        fake.manifestReplies["blog"] = .manifest([
            item(id: "p1", kind: "article", slug: "post", status: "published", hash: MarkdownIdentityCodec.syncHash(for: postText))
        ], etag: nil)
        fake.manifestReplies["bookmarks"] = .manifest([
            item(
                id: "b1",
                kind: "bookmark",
                slug: "link",
                status: "draft",
                hash: MarkdownIdentityCodec.syncHash(for: bookmarkText),
                createdAt: "2025-01-01T00:00:00Z"
            )
        ], etag: nil)
        fake.fileTexts["n1"] = noteText
        fake.fileTexts["p1"] = postText
        fake.fileTexts["b1"] = bookmarkText

        let (store, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(Set(store.loadIndex().entries.keys), ["n1", "p1", "b1"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/note.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Blogs/demo/Posts/post.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Bookmarks/2025/link.md").path))
    }

    func testCopyWithSameWriteIdDoesNotRenameOriginalPost() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let originalRel = "Blogs/demo/Posts/foo.md"
        let copyRel = "Blogs/demo/Posts/foo2.md"
        let serverText = markdown(title: "Foo", slug: "foo", body: "body")
        let originalText = MarkdownIdentityCodec.inject(into: serverText, itemId: "p1", folderId: "blog", kind: "article")
        try write(originalText, to: root.appendingPathComponent(originalRel))
        try write(originalText, to: root.appendingPathComponent(copyRel))
        try writeLocalMarker(root: root)

        let hash = MarkdownIdentityCodec.syncHash(for: serverText)
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["blog"] = .manifest([
            item(id: "p1", kind: "article", slug: "foo", status: "published", hash: hash)
        ], etag: nil)
        fake.fileTexts["p2"] = markdown(title: "Foo Copy", slug: "foo2", body: "body")
        fake.postHandler = { _ in
            .saved(self.item(id: "p2", kind: "article", slug: "foo2", status: "published", hash: hash))
        }

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: [
                "p1": IndexEntry(hash: hash, relativePath: originalRel, folderId: "blog", kind: "article")
            ]))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.puts.map(\.postId), [])
        XCTAssertEqual(fake.posts.count, 1)
        XCTAssertEqual(store.loadIndex().entries["p1"]?.relativePath, originalRel)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(originalRel).path))
    }

    func testMoveIntoMediaFolderDoesNotDeleteServerPost() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let serverText = markdown(title: "Research", body: "body")
        let localText = MarkdownIdentityCodec.inject(into: serverText, itemId: "p1", folderId: "notes", kind: "note")
        let hash = MarkdownIdentityCodec.syncHash(for: serverText)
        try write(localText, to: root.appendingPathComponent("Notes/media/research.md"))
        try writeLocalMarker(root: root)

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "research", status: "draft", hash: hash)
        ], etag: nil)

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: [
                "p1": IndexEntry(hash: hash, relativePath: "Notes/research.md", folderId: "notes", kind: "note")
            ]))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [])
        XCTAssertEqual(store.loadIndex().entries["p1"]?.relativePath, "Notes/media/research.md")
    }

    func testLegacyMigrationThenEnginePassPutsUnpushedDraftAndNoteWithoutDeleteOrPost() throws {
        let legacy = try temporaryDirectory()
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let workspace = fixtureWorkspace()
        try write(markdown(title: "A", body: "local note edit"), to: legacy.appendingPathComponent("notes/a.md"))
        try write(
            markdown(title: "Draft", slug: "draft-post", status: "draft", body: "local draft edit"),
            to: legacy.appendingPathComponent("blog/draft-post.md")
        )

        let migration = WorkspaceMigrator.migrateLegacyMirror(
            from: legacy,
            to: root,
            workspace: descriptor(for: workspace)
        )
        XCTAssertEqual(migration.errors, [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/a.md").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Drafts/draft-post.md").path))

        let noteServer = markdown(title: "A", body: "server note")
        let draftServer = markdown(title: "Draft", slug: "draft-post", status: "draft", body: "server draft")
        let noteHash = MarkdownIdentityCodec.syncHash(for: noteServer)
        let draftHash = MarkdownIdentityCodec.syncHash(for: draftServer)
        let fake = FakeSyncClient()
        fake.workspaceValue = workspace
        fake.manifestReplies["notes"] = .manifest([
            item(id: "n1", kind: "note", slug: "a", status: "draft", hash: noteHash)
        ], etag: nil)
        fake.manifestReplies["blog"] = .manifest([
            item(id: "p1", kind: "article", slug: "draft-post", status: "draft", hash: draftHash)
        ], etag: nil)
        fake.putHandler = { postId, body, ifMatch in
            switch postId {
            case "n1":
                XCTAssertEqual(ifMatch, noteHash)
                XCTAssertTrue(body.contains("local note edit"))
                return .saved(self.item(id: "n1", kind: "note", slug: "a", status: "draft", hash: MarkdownIdentityCodec.syncHash(for: body)))
            case "p1":
                XCTAssertEqual(ifMatch, draftHash)
                XCTAssertTrue(body.contains("local draft edit"))
                return .saved(self.item(id: "p1", kind: "article", slug: "draft-post", status: "draft", hash: MarkdownIdentityCodec.syncHash(for: body)))
            default:
                XCTFail("unexpected PUT \(postId)")
                return .saved(self.item(id: postId, kind: "note", slug: postId, status: "draft", hash: MarkdownIdentityCodec.syncHash(for: body)))
            }
        }

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: [
                "n1": IndexEntry(hash: noteHash, relativePath: "notes/a.md", folderId: "notes", kind: "note"),
                "p1": IndexEntry(hash: draftHash, relativePath: "blog/draft-post.md", folderId: "blog", kind: "article"),
            ]))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [])
        XCTAssertEqual(fake.posts.count, 0)
        XCTAssertEqual(Set(fake.puts.map(\.postId)), ["n1", "p1"])
        XCTAssertEqual(store.loadIndex().entries["n1"]?.relativePath, "Notes/a.md")
        XCTAssertEqual(store.loadIndex().entries["p1"]?.relativePath, "Drafts/draft-post.md")
        let notes = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Notes").path)
        XCTAssertFalse(notes.contains { $0.contains("conflicted copy") })
    }

    func testCorruptRootIndexDoesNotBaselineAndOverwriteUnsyncedEdit() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let serverText = markdown(title: "A", body: "server")
        let localText = MarkdownIdentityCodec.inject(
            into: markdown(title: "A", body: "local edit"),
            itemId: "p1",
            folderId: "notes",
            kind: "note"
        )
        try write(localText, to: root.appendingPathComponent("Notes/a.md"))
        try write("{", to: root.appendingPathComponent(".write/index.json"))

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "a", status: "draft", hash: MarkdownIdentityCodec.syncHash(for: serverText))
        ], etag: nil)
        fake.fileTexts["p1"] = serverText

        let (_, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        let files = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Notes").path)
        let conflict = try XCTUnwrap(files.first { $0.contains("conflicted copy") })
        XCTAssertTrue(try String(contentsOf: root.appendingPathComponent("Notes").appendingPathComponent(conflict)).contains("local edit"))
        XCTAssertTrue(try String(contentsOf: root.appendingPathComponent("Notes/a.md")).contains("server"))
    }

    func testPushRelocationCreatesDraftSubdirectoryBeforeRecordingPath() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let rel = "Blogs/demo/Posts/tech/foo.md"
        let serverText = markdown(title: "Foo", slug: "foo", status: "published", body: "server")
        let localServerHash = MarkdownIdentityCodec.syncHash(for: serverText)
        let edited = MarkdownIdentityCodec.inject(
            into: markdown(title: "Foo", slug: "foo", status: "draft", body: "edited"),
            itemId: "p1",
            folderId: "blog-tech",
            kind: "article"
        )
        try write(edited, to: root.appendingPathComponent(rel))
        try writeLocalMarker(root: root)

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace(includeTechFolder: true)
        fake.manifestReplies["blog"] = .notModified
        fake.manifestReplies["blog-tech"] = .notModified
        fake.putHandler = { postId, body, _ in
            XCTAssertEqual(postId, "p1")
            let hash = MarkdownIdentityCodec.syncHash(for: body)
            return .saved(self.item(id: "p1", kind: "article", slug: "foo", status: "draft", hash: hash))
        }

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: [
                "p1": IndexEntry(hash: localServerHash, relativePath: rel, folderId: "blog-tech", kind: "article")
            ]))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Drafts/tech/foo.md").path))
        XCTAssertEqual(store.loadIndex().entries["p1"]?.relativePath, "Drafts/tech/foo.md")
    }

    func testMigrationConflictedCopyIsNotAutoPushed() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        try write(markdown(title: "Conflict", body: "keep"), to: root.appendingPathComponent("Notes/foo (conflicted copy migration 2026-07-10 1200).md"))

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .manifest([], etag: nil)

        let (_, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.posts.count, 0)
    }

    func testFinderRenameUpdatesSlugAndPushesExistingPost() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let serverText = markdown(title: "Original", slug: "original", body: "server")
        let hash = MarkdownIdentityCodec.syncHash(for: serverText)
        let localText = MarkdownIdentityCodec.inject(into: serverText, itemId: "p1", folderId: "notes", kind: "note")
        try write(localText, to: root.appendingPathComponent("Notes/original.md"))
        try writeLocalMarker(root: root)
        try FileManager.default.moveItem(
            at: root.appendingPathComponent("Notes/original.md"),
            to: root.appendingPathComponent("Notes/renamed.md")
        )

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.putHandler = { postId, body, ifMatch in
            XCTAssertEqual(postId, "p1")
            XCTAssertEqual(ifMatch, hash)
            XCTAssertTrue(body.contains("slug: \"renamed\""))
            return .saved(self.item(id: "p1", kind: "note", slug: "renamed", status: "draft", hash: MarkdownIdentityCodec.syncHash(for: body)))
        }

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: [
                "p1": IndexEntry(hash: hash, relativePath: "Notes/original.md", folderId: "notes", kind: "note")
            ]))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.puts.map(\.postId), ["p1"])
        XCTAssertEqual(store.loadIndex().entries["p1"]?.relativePath, "Notes/renamed.md")
    }

    func testSecondEnginePassDoesNotTouchWorkspaceFileModificationDates() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let serverText = markdown(title: "Stable", body: "server")
        let hash = MarkdownIdentityCodec.syncHash(for: serverText)
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "stable", status: "draft", hash: hash)
        ], etag: nil)
        fake.fileTexts["p1"] = serverText

        let (_, first) = try runEngine(root: root, state: state, client: fake)
        XCTAssertEqual(first.errors, 0, fake.activities.joined(separator: " | "))

        let oldDate = Date(timeIntervalSince1970: 1_000)
        for file in workspaceFiles(root: root) {
            try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: file.path)
        }
        let before = workspaceFileModificationDates(root: root)

        let (_, second) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(second.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(workspaceFileModificationDates(root: root), before)
    }

    func testMirrorIdMismatchReMirrorsInsteadOfDeleting() throws {
        // Root-flip scenario: the saved index describes mirror era A, but this
        // root's marker carries era B (for example a local fallback created
        // during an iCloud sign-out). The pass must drop the index and
        // re-mirror; it must never turn the missing files into server deletes.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let serverText = markdown(title: "Era A post", body: "server")
        let hash = MarkdownIdentityCodec.syncHash(for: serverText)
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "era-a-post", status: "draft", hash: hash)
        ], etag: nil)
        fake.fileTexts["p1"] = serverText

        try write(
            "marker\nmirror-id: era-b\n",
            to: root.appendingPathComponent("\(WorkspaceLayout.localMetadataDirectoryName)/state/sync-marker.txt")
        )

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "p1": IndexEntry(hash: hash, relativePath: "Notes/era-a-post.md", folderId: "notes", kind: "note")
                ],
                mirrorId: "era-a"
            ))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [], "a foreign-era index must never drive server deletes")
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/era-a-post.md").path),
            "the pass should re-mirror the server content"
        )
        XCTAssertEqual(store.loadIndex().mirrorId, "era-b")
    }

    func testUnenumerableDirectoryBlocksServerDeletes() throws {
        // A subdirectory that cannot be enumerated (permissions, I/O errors)
        // hides its files without them being deleted. The missing-file check
        // must not confirm deletion, so no server delete may be issued.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let text = markdown(title: "Hidden", body: "still here")
        let localText = MarkdownIdentityCodec.inject(into: text, itemId: "p9", folderId: "notes", kind: "note")
        let hash = MarkdownIdentityCodec.syncHash(for: text)
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p9", kind: "note", slug: "hidden", status: "draft", hash: hash)
        ], etag: nil)
        fake.fileTexts["p9"] = text

        let lockedDirectory = root.appendingPathComponent("Notes/locked", isDirectory: true)
        try write(localText, to: lockedDirectory.appendingPathComponent("hidden.md"))
        try write(
            "marker\nmirror-id: era-x\n",
            to: root.appendingPathComponent("\(WorkspaceLayout.localMetadataDirectoryName)/state/sync-marker.txt")
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: lockedDirectory.path)
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: lockedDirectory.path)
        }

        let (_, _) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "p9": IndexEntry(hash: hash, relativePath: "Notes/locked/hidden.md", folderId: "notes", kind: "note")
                ],
                mirrorId: "era-x"
            ))
        }

        XCTAssertEqual(fake.deletedIds, [], "inaccessible files must never become server deletes")
    }

    func testMassMissingFilesPauseServerDeletes() throws {
        // Losing most of the workspace at once (eviction, half-materialized
        // iCloud root, wrong mount) must trip the circuit breaker: no server
        // deletes, loud activity, everything else still syncs.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        try write("marker\nmirror-id: era-m\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        var entries: [String: IndexEntry] = [:]
        for i in 1...12 {
            entries["p\(i)"] = IndexEntry(
                hash: "h\(i)", relativePath: "Notes/missing-\(i).md",
                folderId: "notes", kind: "note")
        }
        let (_, _) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: entries, mirrorId: "era-m"))
        }

        XCTAssertEqual(fake.deletedIds, [], "mass disappearance must never become mass server deletes")
        XCTAssertTrue(
            fake.activities.contains { $0.contains("paused server deletes") },
            fake.activities.joined(separator: " | ")
        )
    }

    func testSingleMissingFileStillDeletesOnServer() throws {
        // The breaker must not swallow ordinary deletions: one file removed
        // out of a healthy workspace still propagates to the server.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        let keptText = MarkdownIdentityCodec.inject(
            into: markdown(title: "Kept", body: "kept"),
            itemId: "keep", folderId: "notes", kind: "note")
        try write(keptText, to: root.appendingPathComponent("Notes/kept.md"))
        try write("marker\nmirror-id: era-s\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        let (_, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "keep": IndexEntry(
                        hash: MarkdownIdentityCodec.syncHash(for: keptText),
                        relativePath: "Notes/kept.md", folderId: "notes", kind: "note"),
                    "gone": IndexEntry(
                        hash: "h-gone", relativePath: "Notes/gone.md",
                        folderId: "notes", kind: "note"),
                ],
                mirrorId: "era-s"
            ))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, ["gone"])
    }

    func testEvictedICloudPlaceholderBlocksServerDelete() throws {
        // iCloud eviction can replace foo.md with .foo.md.icloud; the item
        // still exists in the cloud and must not be deleted on the server.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        try write("evicted stand-in", to: root.appendingPathComponent("Notes/.evicted.md.icloud"))
        try write("marker\nmirror-id: era-e\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        let (_, _) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "p1": IndexEntry(
                        hash: "h1", relativePath: "Notes/evicted.md",
                        folderId: "notes", kind: "note")
                ],
                mirrorId: "era-e"
            ))
        }

        XCTAssertEqual(fake.deletedIds, [], "an .icloud placeholder means evicted, not deleted")
    }

    func testDownloadedFileCarriesThePublishedUrlFrontMatter() throws {
        // Phase 5, published URL tracking: the server renders the public URL
        // into the file as the canonical front matter line and the mirror
        // must land it on disk verbatim.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let serverText = "---\n"
            + "title: \"Live Post\"\n"
            + "status: \"published\"\n"
            + "slug: \"live-post\"\n"
            + "canonical: \"https://example.com/@demo/live-post\"\n"
            + "---\n\nPublished body\n"
        fake.manifestReplies["blog"] = .manifest([
            item(id: "p1", kind: "article", slug: "live-post", status: "published",
                 hash: MarkdownIdentityCodec.syncHash(for: serverText))
        ], etag: nil)
        fake.fileTexts["p1"] = serverText

        let (_, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        let saved = try readWorkspaceText(root: root, relativePath: "Blogs/demo/Posts/live-post.md")
        XCTAssertTrue(
            saved.contains("canonical: \"https://example.com/@demo/live-post\""),
            "the public URL must be tracked in the local file: \(saved)"
        )
        XCTAssertTrue(saved.contains("status: \"published\""))
    }

    func testUnreachableBackendLeavesLocalFilesUntouched() throws {
        // Phase 5, offline safety: a pass against an unreachable backend
        // reports the pause and mutates nothing on disk.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let localText = MarkdownIdentityCodec.inject(
            into: markdown(title: "Offline", body: "unsynced local edit\n"),
            itemId: "p1", folderId: "notes", kind: "note")
        try write(localText, to: root.appendingPathComponent("Notes/offline.md"))
        try write("marker\nmirror-id: era-o\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        let before = try readWorkspaceText(root: root, relativePath: "Notes/offline.md")

        let fake = FakeSyncClient()
        fake.unreachable = true
        let (_, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: ["p1": IndexEntry(hash: "stale", relativePath: "Notes/offline.md", folderId: "notes", kind: "note")],
                mirrorId: "era-o"
            ))
        }

        XCTAssertGreaterThan(summary.errors, 0)
        XCTAssertEqual(fake.deletedIds, [])
        XCTAssertEqual(fake.puts.count, 0)
        XCTAssertEqual(try readWorkspaceText(root: root, relativePath: "Notes/offline.md"), before)
    }

    private func readWorkspaceText(root: URL, relativePath: String) throws -> String {
        let url = root.appendingPathComponent(relativePath)
        return try XCTUnwrap(String(data: Data(contentsOf: url), encoding: .utf8))
    }

    private func runEngine(
        root: URL,
        state: URL,
        client: FakeSyncClient,
        seed: ((StateStore) -> Void)? = nil
    ) throws -> (StateStore, SyncSummary) {
        setenv("WRITE_STATE_DIR", state.path, 1)
        defer { unsetenv("WRITE_STATE_DIR") }
        let store = StateStore()
        seed?(store)
        let engine = SyncEngine(store: store)
        engine.callbackQueue = nil
        engine.makeClient = { client }
        engine.syncRootProvider = { root }
        engine.workspaceLocationProvider = {
            WorkspaceLocation(url: root, kind: .injected, iCloudAvailable: false, statusMessage: "test")
        }
        engine.onActivity = { client.activities.append($0) }
        return (store, engine.runOnePassBlocking())
    }

    private func fixtureWorkspace(includeTechFolder: Bool = false) -> Workspace {
        var folders = [
            WorkspaceFolder(id: "blog", name: "Blog", path: "blog", mode: "blog", parentId: nil),
            WorkspaceFolder(id: "notes", name: "Notes", path: "notes", mode: "notes", parentId: nil),
            WorkspaceFolder(id: "bookmarks", name: "Bookmarks", path: "bookmarks", mode: "bookmarks", parentId: nil),
        ]
        if includeTechFolder {
            folders.append(WorkspaceFolder(id: "blog-tech", name: "Tech", path: "blog/tech", mode: "blog", parentId: "blog"))
        }
        return Workspace(blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil), folders: folders)
    }

    private func descriptor(for workspace: Workspace) -> WorkspaceDescriptor {
        WorkspaceDescriptor(
            blog: WorkspaceBlogDescriptor(handle: workspace.blog.handle, name: workspace.blog.name),
            folders: workspace.folders.map {
                WorkspaceFolderDescriptor(id: $0.id, name: $0.name, path: $0.path, mode: $0.mode, parentId: $0.parentId)
            }
        )
    }

    private func item(
        id: String,
        kind: String,
        slug: String,
        status: String,
        hash: String,
        date: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) -> ManifestItem {
        ManifestItem(
            file: "\(slug).md",
            kind: kind,
            slug: slug,
            title: slug,
            status: status,
            hash: hash,
            id: id,
            date: date,
            createdAt: createdAt,
            updatedAt: updatedAt,
            url: nil
        )
    }

    private func markdown(
        title: String,
        slug: String? = nil,
        status: String = "draft",
        body: String
    ) -> String {
        var lines = [
            "---",
            "title: \"\(title)\"",
            "status: \"\(status)\"",
        ]
        if let slug {
            lines.append("slug: \"\(slug)\"")
        }
        lines += ["---", "", body, ""]
        return lines.joined(separator: "\n")
    }

    private func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
    }

    private func writeLocalMarker(root: URL) throws {
        try write("local marker", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("WriteTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func workspaceFiles(root: URL) -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
        ) else { return [] }
        var files: [URL] = []
        for case let url as URL in enumerator {
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue {
                files.append(url)
            }
        }
        return files.sorted { $0.path < $1.path }
    }

    private func workspaceFileModificationDates(root: URL) -> [String: Date] {
        Dictionary(uniqueKeysWithValues: workspaceFiles(root: root).compactMap { url in
            guard let rel = WorkspaceLayout.relativePath(for: url, under: root),
                  let date = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else {
                return nil
            }
            return (rel, date)
        })
    }
}

private final class FakeSyncClient: SyncClient {
    var workspaceValue = Workspace(blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil), folders: [])
    var manifestReplies: [String: ManifestReply] = [:]
    var fileTexts: [String: String] = [:]
    var postHandler: ((String) -> SaveReply)?
    var putHandler: ((String, String, String) -> SaveReply)?
    var deletedIds: [String] = []
    var posts: [String] = []
    var puts: [(postId: String, body: String, ifMatch: String)] = []
    var activities: [String] = []
    var unreachable = false

    func workspace() -> Result<(Workspace, Data), ClientFailure> {
        if unreachable { return .failure(.network("offline")) }
        let data = (try? JSONEncoder().encode(workspaceValue)) ?? Data()
        return .success((workspaceValue, data))
    }

    func manifest(folderId: String, etag: String?) -> Result<ManifestReply, ClientFailure> {
        .success(manifestReplies[folderId] ?? .manifest([], etag: nil))
    }

    func createFolder(parentPath: String, name: String) -> Result<WorkspaceFolder, ClientFailure> {
        .success(WorkspaceFolder(id: "\(parentPath)/\(name)", name: name, path: "\(parentPath)/\(name)", mode: "notes", parentId: nil))
    }

    func fileText(postId: String) -> Result<(text: String, hash: String?), ClientFailure> {
        guard let text = fileTexts[postId] else {
            return .failure(.badResponse("missing file text \(postId)"))
        }
        return .success((text, MarkdownIdentityCodec.syncHash(for: text)))
    }

    func putFile(postId: String, body: String, ifMatch hash: String) -> Result<SaveReply, ClientFailure> {
        puts.append((postId, body, hash))
        return .success(putHandler?(postId, body, hash) ?? .saved(defaultItem(id: postId, body: body)))
    }

    func postFile(body: String) -> Result<SaveReply, ClientFailure> {
        posts.append(body)
        return .success(postHandler?(body) ?? .saved(defaultItem(id: "new-\(posts.count)", body: body)))
    }

    func deleteFile(postId: String) -> Result<Void, ClientFailure> {
        deletedIds.append(postId)
        return .success(())
    }

    func advertisedAppVersion() -> String? { nil }

    private func defaultItem(id: String, body: String) -> ManifestItem {
        ManifestItem(
            file: "\(id).md",
            kind: "note",
            slug: id,
            title: id,
            status: "draft",
            hash: MarkdownIdentityCodec.syncHash(for: body),
            id: id,
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: nil
        )
    }
}
