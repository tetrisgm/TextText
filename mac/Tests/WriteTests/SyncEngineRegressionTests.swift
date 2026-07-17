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

    func testCopyWithSameWriteIdIsNotPostedAsDuplicateNorRenamesOriginal() throws {
        // A Finder copy carries the source's injected item id. That id is already
        // in the index, so the copy must NOT be POSTed as a new post (which would
        // duplicate p1 on the server), and the original must not be renamed. The
        // stray copy is left for move reconciliation, never published as new.
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

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: [
                "p1": IndexEntry(hash: hash, relativePath: originalRel, folderId: "blog", kind: "article")
            ]))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.puts.map(\.postId), [])
        XCTAssertEqual(fake.posts, [], "a file carrying a known item id must never be POSTed as new")
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

    func testPausedEngineWritesNothingAndSettlesIdle() throws {
        // Sole-writer cutover: when isPaused() is true the engine must do a
        // no-op pass, create no ~/Write directory, make no client call, and
        // leave status at .idle.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        // Point the engine at a child path that does NOT exist yet, so we can
        // prove the pass never creates it.
        let mirror = root.appendingPathComponent("Write", isDirectory: true)
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "a", status: "draft",
                 hash: MarkdownIdentityCodec.syncHash(for: markdown(title: "A", body: "server")))
        ], etag: nil)

        var engineRef: SyncEngine?
        let (_, summary) = try runEngine(root: mirror, state: state, client: fake) { engine in
            engine.isPaused = { true }
            engineRef = engine
        }

        XCTAssertEqual(summary.pulled, 0)
        XCTAssertEqual(summary.pushed, 0)
        XCTAssertEqual(summary.conflicts, 0)
        XCTAssertEqual(summary.errors, 0)
        XCTAssertEqual(engineRef?.status, .idle)
        XCTAssertFalse(engineRef?.isSyncing ?? true)
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: mirror.path),
            "a paused pass must not create the mirror directory")
        XCTAssertEqual(fake.workspaceCallCount, 0, "a paused pass must not call the server")
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

    func testSingleMissingFileStillDeletesOnServerAfterTwoScans() throws {
        // The two-strike rule must not swallow ordinary deletions: one file
        // removed out of a healthy workspace does not delete on first sight
        // (it could be a transient read), but the SECOND consecutive scan that
        // still finds it gone propagates the delete, carrying the indexed hash
        // as If-Match for stale-delete protection.
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

        let (_, first) = try runEngine(root: root, state: state, client: fake) {
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
        XCTAssertEqual(first.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [], "a first missing sighting must not delete")

        // Second scan (no re-seed): the file is still gone, so it deletes now.
        let (_, second) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(second.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, ["gone"])
        XCTAssertEqual(fake.deleteIfMatches, ["h-gone"], "delete must carry the indexed hash as If-Match")
    }

    func testSingleWorkspaceMissingFileDoesNotDeleteOnFirstScan() throws {
        // A one-post workspace whose only file transiently vanishes must NOT
        // wipe the server on the first scan (the 1/1 gap the old breaker left).
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        try write("marker\nmirror-id: era-1\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        let (_, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "only": IndexEntry(hash: "h-only", relativePath: "Notes/only.md",
                                       folderId: "notes", kind: "note"),
                ],
                mirrorId: "era-1"
            ))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [], "a 1/1 transient disappearance must not delete on the first scan")
    }

    func testTwoOfThreeMissingDoesNotDeleteOnFirstScan() throws {
        // Two of three files missing is under the mass-loss backstop, so the
        // two-strike rule (not the breaker) governs: nothing deletes on the
        // first scan.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        let keptText = MarkdownIdentityCodec.inject(
            into: markdown(title: "Kept", body: "kept"),
            itemId: "keep", folderId: "notes", kind: "note")
        try write(keptText, to: root.appendingPathComponent("Notes/kept.md"))
        try write("marker\nmirror-id: era-3\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        let (_, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "keep": IndexEntry(
                        hash: MarkdownIdentityCodec.syncHash(for: keptText),
                        relativePath: "Notes/kept.md", folderId: "notes", kind: "note"),
                    "gone1": IndexEntry(hash: "h1", relativePath: "Notes/gone1.md",
                                        folderId: "notes", kind: "note"),
                    "gone2": IndexEntry(hash: "h2", relativePath: "Notes/gone2.md",
                                        folderId: "notes", kind: "note"),
                ],
                mirrorId: "era-3"
            ))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [], "2 of 3 missing must not delete on the first scan")
    }

    func testFileReappearingOnSecondScanIsNotDeleted() throws {
        // A file gone on scan one (a first strike) but restored before scan two
        // must NOT be deleted: the second strike never lands.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        try write("marker\nmirror-id: era-r\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        let backText = MarkdownIdentityCodec.inject(
            into: markdown(title: "Back", body: "restored"),
            itemId: "flap", folderId: "notes", kind: "note")

        let (_, first) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "flap": IndexEntry(hash: MarkdownIdentityCodec.syncHash(for: backText),
                                       relativePath: "Notes/flap.md", folderId: "notes", kind: "note"),
                ],
                mirrorId: "era-r"
            ))
        }
        XCTAssertEqual(first.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [])

        // The file comes back before the second scan.
        try write(backText, to: root.appendingPathComponent("Notes/flap.md"))
        let (_, second) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(second.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [], "a file restored before the second scan must not be deleted")
    }

    func testDetectedFolderMovePatchesServerToPreventSnapBack() throws {
        // A file moved between folders keeps its bytes (and hash), so the PUT
        // path never fires. Without a PATCH the server keeps the old folder and
        // the next pull snaps the file back. The engine must PATCH the new
        // folder when it detects the move.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified
        // The file physically lives in the Blog mirror now, but its injected
        // identity still records the old notes folder (a move does not rewrite
        // the frontmatter).
        let movedText = MarkdownIdentityCodec.inject(
            into: markdown(title: "Moved", slug: "moved", body: "body"),
            itemId: "m1", folderId: "notes", kind: "note")
        try write(movedText, to: root.appendingPathComponent("Blogs/demo/Posts/moved.md"))
        try write("marker\nmirror-id: era-mv\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        fake.patchHandler = { postId, folderId, slug in
            .saved(self.item(id: postId, kind: "article", slug: slug ?? "moved", status: "draft",
                             hash: MarkdownIdentityCodec.syncHash(for: movedText)))
        }

        let (_, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "m1": IndexEntry(hash: MarkdownIdentityCodec.syncHash(for: movedText),
                                     relativePath: "Notes/moved.md", folderId: "notes", kind: "note"),
                ],
                mirrorId: "era-mv"
            ))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.deletedIds, [], "a move must never look like a delete")
        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertEqual(fake.patches.first?.postId, "m1")
        XCTAssertEqual(fake.patches.first?.folderId, "blog", "the server must learn the new folder")
        XCTAssertEqual(fake.patches.first?.ifMatch, MarkdownIdentityCodec.syncHash(for: movedText),
                       "the move PATCH must carry the base hash as If-Match")
    }

    func testFailedMovePatchIsNotAdoptedAndRetriesNextScan() throws {
        // If the move PATCH is rejected (the row changed underneath us), the
        // engine must NOT count it as pushed and must NOT adopt the new
        // folder/path into the index: neither the reconcile step nor the push
        // pass may settle the file at its new location. The file must not be
        // re-POSTed as new either. The move is retried on the next scan.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified
        let movedText = MarkdownIdentityCodec.inject(
            into: markdown(title: "Moved", slug: "moved", body: "body"),
            itemId: "m1", folderId: "notes", kind: "note")
        try write(movedText, to: root.appendingPathComponent("Blogs/demo/Posts/moved.md"))
        try write("marker\nmirror-id: era-mvf\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        let baseHash = MarkdownIdentityCodec.syncHash(for: movedText)
        fake.patchHandler = { _, _, _ in .conflict } // the server keeps rejecting the stale move

        let (store, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: [
                    "m1": IndexEntry(hash: baseHash, relativePath: "Notes/moved.md",
                                     folderId: "notes", kind: "note"),
                ],
                mirrorId: "era-mvf"
            ))
        }

        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertEqual(fake.patches.first?.ifMatch, baseHash, "the PATCH must be guarded by the base hash")
        XCTAssertEqual(summary.pushed, 0, "a rejected move must not count as pushed")
        XCTAssertEqual(summary.conflicts, 1)
        XCTAssertEqual(store.loadIndex().entries["m1"]?.folderId, "notes",
                       "a rejected move must not adopt the new folder")
        XCTAssertEqual(store.loadIndex().entries["m1"]?.relativePath, "Notes/moved.md",
                       "a rejected move must not adopt the new path")
        XCTAssertEqual(fake.deletedIds, [], "a rejected move must never look like a delete")
        XCTAssertEqual(fake.posts, [], "a moved file with an indexed id must not be re-POSTed as new")

        // Next scan: the file is still at the new path, so the move is retried
        // (a second PATCH), not silently settled.
        let (_, second) = try runEngine(root: root, state: state, client: fake)
        XCTAssertEqual(fake.patches.count, 2, "the failed move must be retried on the next scan")
        XCTAssertEqual(second.pushed, 0)
        XCTAssertEqual(fake.posts, [], "still no false new-file POST on retry")
    }

    func testSuccessfulMoveRenameConvergesIndexHashSoNextPushHasNoFalseConflict() throws {
        // A successful move+rename changes the server slug and thus the rendered
        // hash. The index must record the server's NEW render hash (converging on
        // it), not the stale pre-move hash: otherwise the next push sees a
        // phantom diff and PUTs with a now-invalid If-Match, a false 412.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified

        // Pre-move state: a note in Notes with slug "old".
        let preMove = markdown(title: "Renamed", slug: "old", body: "body")
        let preMoveHash = MarkdownIdentityCodec.syncHash(for: preMove)
        // The user moved AND renamed it: it now sits in the Blog mirror as
        // new.md, still carrying its old injected identity and slug.
        let localMoved = MarkdownIdentityCodec.inject(into: preMove, itemId: "m1", folderId: "notes", kind: "note")
        try write(localMoved, to: root.appendingPathComponent("Blogs/demo/Posts/new.md"))
        try write("marker\nmirror-id: era-mr\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        // The server renders the renamed post canonically (a different hash than
        // the local file), so the engine must converge by downloading it.
        let serverRender = "---\n"
            + "title: \"Renamed\"\n"
            + "status: \"draft\"\n"
            + "slug: \"new\"\n"
            + "canonical: \"https://example.com/@demo/new\"\n"
            + "---\n\nbody\n"
        let serverHash = MarkdownIdentityCodec.syncHash(for: serverRender)
        fake.fileTexts["m1"] = serverRender
        fake.patchHandler = { postId, _, slug in
            .saved(self.item(id: postId, kind: "article", slug: slug ?? "new", status: "draft", hash: serverHash))
        }

        let (store, first) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: ["m1": IndexEntry(hash: preMoveHash, relativePath: "Notes/old.md",
                                           folderId: "notes", kind: "note")],
                mirrorId: "era-mr"
            ))
        }

        XCTAssertEqual(first.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertEqual(fake.patches.first?.folderId, "blog")
        XCTAssertEqual(fake.patches.first?.ifMatch, preMoveHash, "the move must be guarded by the pre-move base hash")
        XCTAssertEqual(store.loadIndex().entries["m1"]?.hash, serverHash,
                       "the index must record the server's post-rename render hash, not the stale pre-move hash")
        XCTAssertTrue(fake.puts.isEmpty, "a successful move+rename must not itself PUT")

        // The next push pass must NOT emit a PUT or a conflict for the file.
        let (_, second) = try runEngine(root: root, state: state, client: fake)
        XCTAssertEqual(second.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(second.conflicts, 0, "no false 412 after a successful move+rename")
        XCTAssertEqual(fake.puts.map(\.postId), [], "no PUT for a file already converged with the server")
    }

    func testMoveWithLocalContentEditPushesBeforeCanonicalizing() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified

        let serverBefore = markdown(
            title: "Moved", slug: "old", status: "published",
            body: "server body")
        let serverBeforeHash = MarkdownIdentityCodec.syncHash(for: serverBefore)
        let locallyEdited = MarkdownIdentityCodec.inject(
            into: markdown(
                title: "Moved", slug: "old", status: "published",
                body: "newer local body"),
            itemId: "m1", folderId: "notes", kind: "note")
        let movedURL = root.appendingPathComponent(
            "Blogs/demo/Posts/new.md")
        try write(locallyEdited, to: movedURL)
        try write(
            "marker\nmirror-id: move-edit\n",
            to: root.appendingPathComponent(
                ".write-local.nosync/state/sync-marker.txt"))

        let serverAfterMove = markdown(
            title: "Moved", slug: "new", status: "published",
            body: "server body")
        let serverAfterMoveHash = MarkdownIdentityCodec.syncHash(
            for: serverAfterMove)
        fake.patchHandler = { postId, _, slug in
            .saved(self.item(
                id: postId, kind: "article", slug: slug ?? "new",
                status: "published", hash: serverAfterMoveHash))
        }
        fake.fileTextHandler = { _ in
            XCTFail("a move with unsynced content must not download over it")
            return .failure(.badResponse("unexpected canonical download"))
        }
        fake.putHandler = { postId, body, ifMatch in
            XCTAssertEqual(postId, "m1")
            XCTAssertEqual(ifMatch, serverAfterMoveHash)
            XCTAssertTrue(body.contains("newer local body"))
            XCTAssertTrue(body.contains("slug: \"new\""))
            return .saved(self.item(
                id: postId, kind: "article", slug: "new",
                status: "published",
                hash: MarkdownIdentityCodec.syncHash(for: body)))
        }

        let (store, summary) = try runEngine(
            root: root, state: state, client: fake,
            seed: {
                $0.saveIndex(SyncIndex(
                    entries: [
                        "m1": IndexEntry(
                            hash: serverBeforeHash,
                            relativePath: "Notes/old.md",
                            folderId: "notes", kind: "note")
                    ],
                    mirrorId: "move-edit"))
            })

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertEqual(fake.puts.count, 1)
        XCTAssertTrue(try String(contentsOf: movedURL).contains(
            "newer local body"))
        XCTAssertEqual(
            store.loadIndex().entries["m1"]?.hash,
            MarkdownIdentityCodec.syncHash(for: fake.puts[0].body))
    }

    func testMovedFileWithRestoredOldPathIsNotPostedAsDuplicate() throws {
        // The GENERAL invariant, beyond the per-pass failed-move set: after a
        // move-PATCH 412, a later full pull can restore the OLD indexed path.
        // Now the moved copy sits at a NEW path while the old path exists again,
        // so reconcileIndexedMoves no longer sees the id as missing and the
        // per-pass failed set is empty. The moved copy must STILL never be POSTed
        // as a new file (which would duplicate the post on the server).
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        let text = markdown(title: "Note", slug: "note", body: "body")
        let hash = MarkdownIdentityCodec.syncHash(for: text)
        let localText = MarkdownIdentityCodec.inject(into: text, itemId: "p1", folderId: "notes", kind: "note")
        // Old indexed path (restored by a prior pull) and the user's moved copy.
        try write(localText, to: root.appendingPathComponent("Notes/note.md"))
        try write(localText, to: root.appendingPathComponent("Blogs/demo/Posts/note.md"))
        try write("marker\nmirror-id: era-rp\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        // The server still lists it in notes (the earlier move never landed).
        fake.manifestReplies["notes"] = .manifest([
            item(id: "p1", kind: "note", slug: "note", status: "draft", hash: hash)
        ], etag: nil)
        fake.fileTexts["p1"] = text

        let (_, summary) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: ["p1": IndexEntry(hash: hash, relativePath: "Notes/note.md", folderId: "notes", kind: "note")],
                mirrorId: "era-rp"
            ))
        }

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.posts, [], "a moved copy carrying a known item id must not be POSTed as a duplicate")
        XCTAssertEqual(fake.deletedIds, [])
    }

    func testFailedConvergenceGetAfterMoveDoesNotCauseRedundantPut() throws {
        // #2: when the post-move canonical GET fails, the engine must record the
        // local file's ACTUAL hash, not the server's item.hash, so the next push
        // does not see a phantom diff against known-different local bytes and PUT
        // redundantly.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified
        let preMove = markdown(title: "R", slug: "old", body: "body")
        let preMoveHash = MarkdownIdentityCodec.syncHash(for: preMove)
        let localMoved = MarkdownIdentityCodec.inject(into: preMove, itemId: "m1", folderId: "notes", kind: "note")
        try write(localMoved, to: root.appendingPathComponent("Blogs/demo/Posts/new.md"))
        try write("marker\nmirror-id: era-mg\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        // The server render hash differs from the local file, but its canonical
        // GET is unavailable (no fileText), so the convergence download fails.
        fake.patchHandler = { postId, _, slug in
            .saved(self.item(id: postId, kind: "article", slug: slug ?? "new", status: "draft", hash: "server-render-hash"))
        }

        let (_, first) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: ["m1": IndexEntry(hash: preMoveHash, relativePath: "Notes/old.md", folderId: "notes", kind: "note")],
                mirrorId: "era-mg"
            ))
        }
        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertTrue(fake.puts.isEmpty, "a failed convergence GET must not leave a phantom diff to PUT")
        _ = first

        // A subsequent pass must also not emit a redundant PUT.
        let (_, _) = try runEngine(root: root, state: state, client: fake)
        XCTAssertEqual(fake.puts.map(\.postId), [], "no redundant PUT after a failed convergence GET")
    }

    func testPushNewFileRefusesKnownIdEvenWhenOuterGuardDidNotPreSkip() throws {
        // #1 (no TOCTOU): the known-id guard must also hold INSIDE pushNewFile,
        // on its own single read, so a duplicate is impossible even if the outer
        // step-4 scan did not pre-skip the file. Two files carry the SAME
        // injected id with an EMPTY starting index, so the outer indexedIds
        // snapshot (taken before this pass POSTs the first one and learns the id)
        // cannot pre-skip the second: only pushNewFile's live check stops it.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        let body = MarkdownIdentityCodec.inject(
            into: markdown(title: "Dup", slug: "dup", body: "body"),
            itemId: "dup", folderId: "notes", kind: "note")
        try write(body, to: root.appendingPathComponent("Notes/one.md"))
        try write(body, to: root.appendingPathComponent("Notes/two.md"))
        try writeLocalMarker(root: root)
        fake.postHandler = { _ in
            .saved(self.item(id: "dup", kind: "note", slug: "dup", status: "draft",
                             hash: MarkdownIdentityCodec.syncHash(for: body)))
        }

        let (store, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.posts.count, 1, "two files sharing a known id must yield at most one POST")
        XCTAssertNotNil(store.loadIndex().entries["dup"])
    }

    func testConvergenceGetFailureNeverLeavesStaleHashForAPush() throws {
        // #2: a failed post-move convergence GET must never leave the stale
        // PRE-MOVE hash in the index. Otherwise a later pass whose pull does not
        // re-list the item (a cached .notModified manifest, or a push-only pass)
        // would PUT with a now-invalid If-Match and hit a false 412. The recorded
        // hash must be a valid basis for a future push.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified
        let preMove = markdown(title: "R", slug: "old", body: "body")
        let preMoveHash = MarkdownIdentityCodec.syncHash(for: preMove)
        let localMoved = MarkdownIdentityCodec.inject(into: preMove, itemId: "m1", folderId: "notes", kind: "note")
        try write(localMoved, to: root.appendingPathComponent("Blogs/demo/Posts/new.md"))
        try write("marker\nmirror-id: era-cg\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        // The convergence GET is unavailable (no fileText), so the download fails.
        fake.patchHandler = { postId, _, slug in
            .saved(self.item(id: postId, kind: "article", slug: slug ?? "new", status: "draft", hash: "server-render-hash"))
        }

        let (store, _) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(
                entries: ["m1": IndexEntry(hash: preMoveHash, relativePath: "Notes/old.md", folderId: "notes", kind: "note")],
                mirrorId: "era-cg"
            ))
        }
        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertNotEqual(store.loadIndex().entries["m1"]?.hash, preMoveHash,
                          "the stale pre-move hash must not survive a failed convergence GET")

        // A later pass whose pull does not re-list the item must not PUT with the
        // stale pre-move If-Match.
        let (_, _) = try runEngine(root: root, state: state, client: fake)
        XCTAssertFalse(fake.puts.contains { $0.ifMatch == preMoveHash },
                       "no push may carry the stale pre-move If-Match after a failed convergence")
    }

    func testUnreadableConvergenceMarksNeedsPullThenNextPassPullsTheRender() throws {
        // The unreadable branch: a move+rename PATCH succeeds but the convergence
        // read fails (local file unreadable at that moment) AND the GET is
        // unavailable, so neither hash may be trusted. The entry is marked "needs
        // pull": no push emits stale/old-slug bytes (which would revert the
        // rename), and the NEXT full pass's pull re-downloads the server render
        // and converges authoritatively.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()

        // Pre-move: a published post with slug "old"; the moved file carries it.
        // Published (not draft) so it stays in the Posts area, not routed to Drafts.
        let preMove = markdown(title: "R", slug: "old", status: "published", body: "body")
        let preMoveHash = MarkdownIdentityCodec.syncHash(for: preMove)
        let localMoved = MarkdownIdentityCodec.inject(into: preMove, itemId: "m1", folderId: "notes", kind: "note")
        try write(localMoved, to: root.appendingPathComponent("Blogs/demo/Posts/new.md"))
        try write("marker\nmirror-id: era-un\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        // The server's post-rename render (slug "new").
        let serverRender = "---\ntitle: \"R\"\nstatus: \"published\"\nslug: \"new\"\n---\n\nbody\n"
        let serverHash = MarkdownIdentityCodec.syncHash(for: serverRender)
        fake.patchHandler = { postId, _, slug in
            .saved(self.item(id: postId, kind: "article", slug: slug ?? "new", status: "published", hash: serverHash))
        }

        // Pass 1: force the convergence read to fail (unreadable branch); the GET
        // is unavailable (no fileText) so the download fails too; the pull cannot
        // converge yet (blog manifest .notModified), so the sentinel persists.
        fake.manifestReplies["notes"] = .notModified
        fake.manifestReplies["blog"] = .notModified
        let (store, first) = try runEngine(
            root: root, state: state, client: fake,
            configure: { $0.convergenceReadShouldFail = { rel in rel == "Blogs/demo/Posts/new.md" } },
            seed: {
                $0.saveIndex(SyncIndex(
                    entries: ["m1": IndexEntry(hash: preMoveHash, relativePath: "Notes/old.md", folderId: "notes", kind: "note")],
                    mirrorId: "era-un"
                ))
            })
        _ = first
        XCTAssertEqual(fake.patches.count, 1)
        XCTAssertEqual(fake.patches.first?.folderId, "blog")
        XCTAssertTrue(fake.puts.isEmpty, "no push may emit stale/old-slug bytes for a not-yet-converged move")
        XCTAssertEqual(store.loadIndex().entries["m1"]?.hash, SyncEngine.needsPullHash,
                       "the entry must be marked needs-pull (sentinel)")

        // Pass 2: the GET is available and the server lists the moved post, so the
        // pull re-downloads the server render and converges. No stale PUT ever.
        fake.fileTexts["m1"] = serverRender
        fake.manifestReplies["blog"] = .manifest([
            item(id: "m1", kind: "article", slug: "new", status: "published", hash: serverHash)
        ], etag: nil)
        let (store2, _) = try runEngine(root: root, state: state, client: fake)
        XCTAssertTrue(fake.puts.isEmpty, "the move converged by PULL, never a stale-If-Match PUT")
        XCTAssertEqual(store2.loadIndex().entries["m1"]?.hash, serverHash,
                       "the next pull converged the server render")
        let converged = try readWorkspaceText(root: root, relativePath: "Blogs/demo/Posts/new.md")
        XCTAssertTrue(converged.contains("slug: \"new\""), "the server's renamed render landed on disk")
    }

    func testSustainedLargeDeletionSyncsOnSecondScan() throws {
        // A legitimate large (>=10) bulk deletion must not be paused forever: the
        // first high-fraction scan pauses and warns, but if the SAME set is still
        // gone on the next scan (two consecutive confirmations), it propagates.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        try write("marker\nmirror-id: era-big\n", to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))

        var entries: [String: IndexEntry] = [:]
        for i in 1...10 {
            entries["p\(i)"] = IndexEntry(
                hash: "h\(i)", relativePath: "Notes/gone-\(i).md",
                folderId: "notes", kind: "note")
        }
        let (_, first) = try runEngine(root: root, state: state, client: fake) {
            $0.saveIndex(SyncIndex(entries: entries, mirrorId: "era-big"))
        }
        XCTAssertEqual(fake.deletedIds, [], "the first high-fraction scan must pause")
        XCTAssertTrue(
            fake.activities.contains { $0.contains("paused server deletes") },
            fake.activities.joined(separator: " | "))
        _ = first

        // The same large set is still gone on the second scan: it now propagates.
        let (_, second) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(second.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(Set(fake.deletedIds), Set(entries.keys),
                       "a sustained large deletion must sync on the second scan")
    }

    func testNewFileCreateSendsStableIdempotencyKey() throws {
        // A new local file must POST with a stable Idempotency-Key so a lost
        // response plus retry does not publish the post twice.
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        try write(markdown(title: "Fresh", body: "brand new"), to: root.appendingPathComponent("Notes/fresh.md"))
        try writeLocalMarker(root: root)

        let (_, summary) = try runEngine(root: root, state: state, client: fake)

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(fake.posts.count, 1)
        XCTAssertEqual(fake.postIdempotencyKeys, ["post:Notes/fresh.md"],
                       "a new create must carry a stable idempotency key")
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

    func testPullNeverOverwritesAnEditSavedWhileDownloadIsInFlight() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let relativePath = "Notes/a.md"
        let url = root.appendingPathComponent(relativePath)
        let baseline = markdown(title: "A", body: "baseline")
        let remote = markdown(title: "A", body: "remote edit")
        let initialLocal = MarkdownIdentityCodec.inject(
            into: baseline, itemId: "p1", folderId: "notes", kind: "note")
        let newerLocal = MarkdownIdentityCodec.inject(
            into: markdown(title: "A", body: "newer local edit"),
            itemId: "p1", folderId: "notes", kind: "note")
        try write(initialLocal, to: url)
        try write(
            "marker\nmirror-id: pull-race\n",
            to: root.appendingPathComponent(
                ".write-local.nosync/state/sync-marker.txt"))

        let baselineHash = MarkdownIdentityCodec.syncHash(for: baseline)
        let remoteHash = MarkdownIdentityCodec.syncHash(for: remote)
        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .manifest([
            item(
                id: "p1", kind: "note", slug: "a", status: "draft",
                hash: remoteHash)
        ], etag: nil)
        var downloadCount = 0
        fake.fileTextHandler = { postId in
            XCTAssertEqual(postId, "p1")
            downloadCount += 1
            if downloadCount == 1 {
                try! self.write(newerLocal, to: url)
            }
            return .success((remote, remoteHash))
        }
        fake.putHandler = { _, _, _ in .conflict }

        let (store, summary) = try runEngine(
            root: root, state: state, client: fake,
            seed: {
                $0.saveIndex(SyncIndex(
                    entries: [
                        "p1": IndexEntry(
                            hash: baselineHash, relativePath: relativePath,
                            folderId: "notes", kind: "note")
                    ],
                    mirrorId: "pull-race"))
            })

        XCTAssertGreaterThan(summary.errors, 0)
        XCTAssertEqual(summary.conflicts, 1)
        XCTAssertEqual(store.loadIndex().entries["p1"]?.hash, remoteHash)
        let files = try FileManager.default.contentsOfDirectory(
            at: url.deletingLastPathComponent(),
            includingPropertiesForKeys: nil)
        let conflict = try XCTUnwrap(files.first {
            $0.lastPathComponent.contains("conflicted copy")
        })
        XCTAssertTrue(try String(contentsOf: conflict).contains("newer local edit"))
        XCTAssertTrue(try String(contentsOf: url).contains("remote edit"))
    }

    func testPutCanonicalizationNeverOverwritesANewerLocalSave() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let relativePath = "Notes/a.md"
        let url = root.appendingPathComponent(relativePath)
        let baseline = markdown(title: "A", body: "baseline")
        let edited = MarkdownIdentityCodec.inject(
            into: markdown(title: "A", body: "first local edit"),
            itemId: "p1", folderId: "notes", kind: "note")
        let newer = MarkdownIdentityCodec.inject(
            into: markdown(title: "A", body: "newer local edit"),
            itemId: "p1", folderId: "notes", kind: "note")
        let canonical = markdown(title: "A", body: "canonical first edit")
        let baselineHash = MarkdownIdentityCodec.syncHash(for: baseline)
        let canonicalHash = MarkdownIdentityCodec.syncHash(for: canonical)
        try write(edited, to: url)
        try write(
            "marker\nmirror-id: put-race\n",
            to: root.appendingPathComponent(
                ".write-local.nosync/state/sync-marker.txt"))

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.fileTexts["p1"] = canonical
        fake.putHandler = { postId, body, ifMatch in
            XCTAssertEqual(postId, "p1")
            XCTAssertEqual(ifMatch, baselineHash)
            XCTAssertTrue(body.contains("first local edit"))
            try! self.write(newer, to: url)
            return .saved(self.item(
                id: "p1", kind: "note", slug: "a", status: "draft",
                hash: canonicalHash))
        }

        let (store, summary) = try runEngine(
            root: root, state: state, client: fake,
            seed: {
                $0.saveIndex(SyncIndex(
                    entries: [
                        "p1": IndexEntry(
                            hash: baselineHash, relativePath: relativePath,
                            folderId: "notes", kind: "note")
                    ],
                    mirrorId: "put-race"))
            })

        XCTAssertEqual(summary.errors, 0, fake.activities.joined(separator: " | "))
        XCTAssertEqual(summary.pushed, 1)
        XCTAssertEqual(fake.puts.count, 1)
        XCTAssertEqual(store.loadIndex().entries["p1"]?.hash, canonicalHash)
        XCTAssertTrue(try String(contentsOf: url).contains("newer local edit"))
        XCTAssertFalse(try String(contentsOf: url).contains("canonical first edit"))
        XCTAssertTrue(fake.activities.contains {
            $0.contains("newer local edit remains")
        })
    }

    func testRejectedUnchangedContentStaysInErrorWithoutRepeatedPut() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let relativePath = "Notes/rejected.md"
        let baseline = markdown(title: "Rejected", body: "server body")
        let baselineHash = MarkdownIdentityCodec.syncHash(for: baseline)
        let local = MarkdownIdentityCodec.inject(
            into: markdown(title: "Rejected", body: "invalid local body"),
            itemId: "p1", folderId: "notes", kind: "note")
        try write(local, to: root.appendingPathComponent(relativePath))
        try write(
            "marker\nmirror-id: rejected-content\n",
            to: root.appendingPathComponent(
                ".write-local.nosync/state/sync-marker.txt"))

        let fake = FakeSyncClient()
        fake.workspaceValue = fixtureWorkspace()
        fake.manifestReplies["notes"] = .notModified
        fake.putHandler = { _, _, _ in .rejected("invalid") }

        setenv("WRITE_STATE_DIR", state.path, 1)
        defer { unsetenv("WRITE_STATE_DIR") }
        let store = StateStore()
        store.saveIndex(SyncIndex(
            entries: [
                "p1": IndexEntry(
                    hash: baselineHash, relativePath: relativePath,
                    folderId: "notes", kind: "note")
            ],
            mirrorId: "rejected-content"))
        let engine = SyncEngine(store: store)
        engine.callbackQueue = nil
        engine.makeClient = { fake }
        engine.syncRootProvider = { root }
        engine.workspaceLocationProvider = {
            WorkspaceLocation(
                url: root, kind: .injected, iCloudAvailable: false,
                statusMessage: "test")
        }

        let first = engine.runOnePassBlocking()
        let second = engine.runOnePassBlocking()

        XCTAssertEqual(first.errors, 1)
        XCTAssertEqual(second.errors, 1)
        XCTAssertEqual(fake.puts.count, 1,
                       "unchanged rejected bytes must not be PUT again")
        XCTAssertEqual(
            engine.status,
            .error(errorCount: 1, retryScheduled: false))
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
        try runEngine(
            root: root, state: state, client: client,
            configure: { _ in }, seed: seed)
    }

    private func runEngine(
        root: URL,
        state: URL,
        client: FakeSyncClient,
        configure: (SyncEngine) -> Void,
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
        configure(engine)
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
    var fileTextHandler:
        ((String) -> Result<(text: String, hash: String?), ClientFailure>)?
    var postHandler: ((String) -> SaveReply)?
    var putHandler: ((String, String, String) -> SaveReply)?
    var patchHandler: ((String, String?, String?) -> SaveReply)?
    var deletedIds: [String] = []
    var deleteIfMatches: [String?] = []
    var posts: [String] = []
    var postFolderIds: [String?] = []
    var postIdempotencyKeys: [String?] = []
    var folderIdempotencyKeys: [String?] = []
    var puts: [(postId: String, body: String, ifMatch: String)] = []
    var patches: [(postId: String, folderId: String?, slug: String?, ifMatch: String?)] = []
    var activities: [String] = []
    var unreachable = false
    var workspaceCallCount = 0

    func workspace() -> Result<(Workspace, Data), ClientFailure> {
        workspaceCallCount += 1
        if unreachable { return .failure(.network("offline")) }
        let data = (try? JSONEncoder().encode(workspaceValue)) ?? Data()
        return .success((workspaceValue, data))
    }

    func manifest(folderId: String, etag: String?) -> Result<ManifestReply, ClientFailure> {
        .success(manifestReplies[folderId] ?? .manifest([], etag: nil))
    }

    func createFolder(parentPath: String, name: String, idempotencyKey: String?) -> Result<WorkspaceFolder, ClientFailure> {
        folderIdempotencyKeys.append(idempotencyKey)
        return .success(WorkspaceFolder(id: "\(parentPath)/\(name)", name: name, path: "\(parentPath)/\(name)", mode: "notes", parentId: nil))
    }

    func fileText(postId: String) -> Result<(text: String, hash: String?), ClientFailure> {
        if let fileTextHandler { return fileTextHandler(postId) }
        guard let text = fileTexts[postId] else {
            return .failure(.badResponse("missing file text \(postId)"))
        }
        return .success((text, MarkdownIdentityCodec.syncHash(for: text)))
    }

    func putFile(postId: String, body: String, ifMatch hash: String) -> Result<SaveReply, ClientFailure> {
        puts.append((postId, body, hash))
        return .success(putHandler?(postId, body, hash) ?? .saved(defaultItem(id: postId, body: body)))
    }

    func patchFile(postId: String, folderId: String?, slug: String?, ifMatch hash: String?) -> Result<SaveReply, ClientFailure> {
        patches.append((postId, folderId, slug, hash))
        return .success(patchHandler?(postId, folderId, slug) ?? .saved(defaultItem(id: postId, body: "")))
    }

    func postFile(body: String, folderId: String?, idempotencyKey: String?) -> Result<SaveReply, ClientFailure> {
        posts.append(body)
        postFolderIds.append(folderId)
        postIdempotencyKeys.append(idempotencyKey)
        let reply = postHandler?(body)
            ?? .saved(defaultItem(id: "new-\(posts.count)", body: body))
        if case .saved(let item) = reply, let id = item.id,
           fileTexts[id] == nil {
            // A successful create is immediately readable from the real API.
            // Preserve that contract so canonicalization failures in tests are
            // intentional rather than an incomplete fake.
            fileTexts[id] = body
        }
        return .success(reply)
    }

    func deleteFile(postId: String, ifMatch hash: String?) -> Result<Void, ClientFailure> {
        deletedIds.append(postId)
        deleteIfMatches.append(hash)
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
