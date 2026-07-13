import XCTest
import FileProvider
import UniformTypeIdentifiers
@testable import WriteFileProviderExtensionCore
@testable import WriteFileProviderKit
@testable import WriteFileProviderBridge

final class FileProviderExtensionTests: XCTestCase {

    private func ext(
        _ api: WriteSyncAPI?,
        descriptors: [FileProviderWorkspace]? = nil,
        temporaryDirectory: URL? = nil
    ) -> FileProviderExtension {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "write"),
            displayName: "Write")
        // Every handle resolves to the same injected API in these tests.
        let workspaces = descriptors ?? [FileProviderWorkspace(
            name: "Demo", handle: "demo", origin: "https://example.test", token: "token")]
        return FileProviderExtension(
            domain: domain, apiFactory: { _ in api },
            descriptorsProvider: { workspaces },
            temporaryDirectoryProvider: temporaryDirectory.map { directory in { directory } })
    }

    private func fileItem(id: String, file: String, folder: String) -> WriteFileProviderItem {
        // `file` is the literal Finder filename the framework hands us (e.g. after
        // a rename), so set it verbatim rather than re-deriving it from a title.
        let base = WriteItemMapper.item(for: Fixtures.item(id: id, file: file, kind: "note"),
                                        inFolder: folder, handle: "demo", readOnly: false)!
        return WriteFileProviderItem(base.withFilename(file))
    }

    private func tempFile(_ body: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? Data(body.utf8).write(to: url)
        return url
    }

    private func tempDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
        return url
    }

    private func version(_ hash: String) -> NSFileProviderItemVersion {
        let current = WriteItemMapper.item(
            for: Fixtures.item(
                id: "p1", file: "a.md", kind: "note", title: "a", hash: hash),
            inFolder: "notes", handle: "demo", readOnly: false)!
        return NSFileProviderItemVersion(
            contentVersion: Data(hash.utf8),
            metadataVersion: WriteFileProviderItem(current).itemVersion.metadataVersion)
    }

    private func version(_ item: WriteItem) -> NSFileProviderItemVersion {
        WriteFileProviderItem(item).itemVersion
    }

    private func version(
        contentHash: String, metadataFor item: WriteItem
    ) -> NSFileProviderItemVersion {
        NSFileProviderItemVersion(
            contentVersion: Data(contentHash.utf8),
            metadataVersion: WriteFileProviderItem(item).itemVersion.metadataVersion)
    }

    // MARK: not authenticated

    func testItemWithoutAuthIsNotAuthenticated() {
        let exp = expectation(description: "item")
        var err: NSError?
        _ = ext(nil).item(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            request: NSFileProviderRequest()
        ) { _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFileProviderError.notAuthenticated.rawValue)
    }

    func testFolderEnumeratorWithoutAuthThrows() {
        // The root and working set list from the handoff (no API), so use a
        // workspace-scoped folder to exercise the not-authenticated path.
        XCTAssertThrowsError(
            try ext(nil).enumerator(
                for: NSFileProviderItemIdentifier(rawValue: "folder:demo:blog"),
            request: NSFileProviderRequest()))
    }

    // MARK: fetch

    func testFetchContentsRetriesUntilMetadataAndBytesShareOneRevision() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let old = Fixtures.item(
            id: "p1", file: "old.md", kind: "note", title: "Old", hash: "h1")
        let new = Fixtures.item(
            id: "p1", file: "new.md", kind: "note", title: "New", hash: "h2")
        api.manifestResults["notes"] = [
            .success([old]), .success([new]), .success([new]), .success([new]),
        ]
        api.fileTextResults = [
            .success(WriteFileContent(text: "old bytes", hash: "h1")),
            .success(WriteFileContent(text: "new bytes", hash: "h2")),
        ]
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let exp = expectation(description: "fetch-consistent")
        var fetchedURL: URL?
        var fetchedItem: NSFileProviderItem?
        var fetchedError: Error?
        _ = ext(api, temporaryDirectory: directory).fetchContents(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            version: nil, request: NSFileProviderRequest()
        ) { url, item, error in
            fetchedURL = url; fetchedItem = item; fetchedError = error; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(fetchedError)
        XCTAssertEqual(api.fileTextCalls, 2)
        XCTAssertEqual(try String(contentsOf: XCTUnwrap(fetchedURL), encoding: .utf8),
                       "new bytes")
        XCTAssertEqual(fetchedItem?.filename, "New.md")
        let fetchedVersion = try XCTUnwrap(try XCTUnwrap(fetchedItem).itemVersion)
        XCTAssertEqual(
            String(decoding: fetchedVersion.contentVersion, as: UTF8.self),
            "h2")
    }

    func testStrictFetchReportsRequestedRevisionNoLongerAvailable() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "new.md", kind: "note", title: "New", hash: "h2")]
        api.fileTextResults = [
            .success(WriteFileContent(text: "new bytes", hash: "h2")),
        ]
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let requested = NSFileProviderItemVersion(
            contentVersion: Data("h1".utf8),
            metadataVersion: NSFileProviderItemVersion.beforeFirstSyncComponent)
        let exp = expectation(description: "strict-fetch")
        var fetchedURL: URL?
        var err: NSError?

        _ = ext(api, temporaryDirectory: directory).fetchContents(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            version: requested, request: NSFileProviderRequest()
        ) { url, _, error in fetchedURL = url; err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(fetchedURL)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.versionNoLongerAvailable.rawValue)
    }

    // MARK: create

    func testCreateFileCallsCreateFileInParentFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(id: "n9", file: "my-note.md", kind: "note", slug: "my-note"))
        let template = fileItem(id: "tmp", file: "My Note.md", folder: "notes")
        let exp = expectation(description: "create")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile("hello"), options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFileCalls.count, 1)
        XCTAssertEqual(api.createFileCalls.first?.folderId, "notes")
        XCTAssertEqual(api.createFileCalls.first?.body, "hello")
        // The template's stable identifier is the idempotency key, so a retried
        // create returns the original item instead of a duplicate.
        XCTAssertEqual(api.createFileCalls.first?.idempotencyKey, "file:demo:tmp")
    }

    func testCreateFileTitlesTheNewPostFromTheFilename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(id: "n9", file: "untitled-x.md", kind: "note", slug: "untitled-x", title: ""))
        let template = fileItem(id: "tmp", file: "My Great Note.md", folder: "notes")
        let exp = expectation(description: "create")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile(""), options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        // A Finder-created "My Great Note.md" retitles the fresh post (not reslug).
        XCTAssertEqual(api.patchCalls.first?.title, "My Great Note")
        XCTAssertNil(api.patchCalls.first?.slug)
    }

    func testCreateFileWithUnreadableURLFailsWithoutUploadingEmptyText() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let template = fileItem(id: "tmp", file: "My Note.md", folder: "notes")
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let exp = expectation(description: "create-unreadable")
        var err: NSError?

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: missing, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.createFileCalls.isEmpty)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testCreateFolderCallsCreateFolderWithParentPath() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = WriteWorkspaceFolder(id: "tmp", name: "Ideas", path: "Blog/Ideas", mode: "blog", parentId: "blog")
        let template = WriteFileProviderItem(WriteItemMapper.item(for: folder, handle: "demo", readOnly: false))
        let exp = expectation(description: "createFolder")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFolderCalls.first?.parentPath, "Blog")
        XCTAssertEqual(api.createFolderCalls.first?.name, "Ideas")
        XCTAssertEqual(api.createFolderCalls.first?.idempotencyKey, "folder:demo:tmp")
    }

    func testCreateFolderDecodesPortableFinderComponent() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = WriteWorkspaceFolder(
            id: "tmp", name: "Why??", path: "Blog/Why??", mode: "blog", parentId: "blog")
        let template = WriteFileProviderItem(
            WriteItemMapper.item(for: folder, handle: "demo", readOnly: false))
        let exp = expectation(description: "createFolderEscaped")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFolderCalls.first?.name, "Why??")
    }

    // MARK: modify

    func testModifyContentsCallsPutWithBaseHash() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(Fixtures.item(id: "p1", file: "a.md", kind: "note"))
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let exp = expectation(description: "put")
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.putCalls.first?.postId, "p1")
        XCTAssertEqual(api.putCalls.first?.body, "new body")
        XCTAssertEqual(api.putCalls.first?.hash, "basehash")
    }

    func testModifyContentsWithoutReadableURLFailsWithoutUploadingEmptyText() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let exp = expectation(description: "missing-contents")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testModifyContentsWithUnreadableURLFailsWithoutUpload() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let exp = expectation(description: "unreadable-contents")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: missing, options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testBeforeFirstSyncContentSentinelNeverUploads() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(id: "p1", file: "remote.md", kind: "note", title: "Remote")
        ]
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let beforeFirst = NSFileProviderItemVersion(
            contentVersion: NSFileProviderItemVersion.beforeFirstSyncComponent,
            metadataVersion: Data("m".utf8))
        let exp = expectation(description: "before-first")
        var current: NSFileProviderItem?
        _ = ext(api).modifyItem(
            item, baseVersion: beforeFirst, changedFields: [.contents],
            contents: tempFile("local"), options: [], request: NSFileProviderRequest()
        ) { result, _, _, _ in current = result; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertEqual(current?.filename, "Remote.md")
    }

    func testInvalidDestinationParentFailsBeforeCompoundUpload() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let base = WriteItemMapper.item(
            for: Fixtures.item(id: "p1", file: "a.md", kind: "note"),
            inFolder: "notes", handle: "demo", readOnly: false)!
        let item = WriteFileProviderItem(
            base.withParentIdentifier(.workspace("demo")))
        let exp = expectation(description: "invalid-parent")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"),
            changedFields: [.contents, .parentItemIdentifier],
            contents: tempFile("local"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(err?.code, NSFileProviderError.noSuchItem.rawValue)
    }

    func testCompoundModifyPatchesWithPutReturnedHash() {
        // A content edit plus a rename must be atomic against a concurrent
        // metadata change: the rename PATCH must build on the hash the PUT just
        // returned, not the original base version, so a change slipping in
        // between conflicts (412) instead of being silently overwritten.
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(WriteManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "a", status: "draft",
            hash: "puthash", id: "p1", date: nil, createdAt: nil, updatedAt: nil, url: nil))
        let item = fileItem(id: "p1", file: "Renamed.md", folder: "notes")
        let exp = expectation(description: "compound")
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents, .filename],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.putCalls.first?.hash, "basehash", "the PUT still uses the base version")
        XCTAssertEqual(api.patchCalls.first?.ifMatch, "puthash",
                       "the PATCH must guard on the bytes the PUT just wrote")
        // A Finder rename retitles the post (the filename is the title, not the slug).
        XCTAssertEqual(api.patchCalls.first?.title, "Renamed")
        XCTAssertNil(api.patchCalls.first?.slug)
    }

    func testCompoundModifyDoesNotPatchWhenPutReturnsNoHash() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(WriteManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "a", status: "draft",
            hash: "", id: "p1", date: nil, createdAt: nil, updatedAt: nil, url: nil))
        let item = fileItem(id: "p1", file: "Renamed.md", folder: "notes")
        let exp = expectation(description: "compound-no-hash")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents, .filename],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testRenameFileCallsPatchWithTitle() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "Renamed Title.md", folder: "notes")
        let exp = expectation(description: "rename")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.patchCalls.first?.postId, "p1")
        XCTAssertEqual(api.patchCalls.first?.title, "Renamed Title")
        XCTAssertNil(api.patchCalls.first?.slug)
        XCTAssertNil(api.patchCalls.first?.folderId)
    }

    func testRenameFileDecodesPortableNameAndRemovesItsCollisionSuffix() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let suffix = WriteFilename.collisionSuffix("p1")
        let item = fileItem(id: "p1", file: "Why~3F~3F\(suffix).md", folder: "notes")
        let exp = expectation(description: "rename-portable")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.first?.title, "Why??")
    }

    func testRenameConflictReturnsCurrentRemoteItemWithoutReplayingIntent() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.patchResult = .failure(.conflict)
        let remoteEntry = Fixtures.item(
            id: "p1", file: "remote.md", kind: "note", title: "Remote Title")
        api.manifests["notes"] = [remoteEntry]
        let remote = WriteItemMapper.item(
            for: remoteEntry, inFolder: "notes", handle: "demo", readOnly: false)!
        let item = fileItem(id: "p1", file: "Stale Rename.md", folder: "notes")
        let exp = expectation(description: "rename-conflict")
        var err: NSError?
        var current: NSFileProviderItem?
        var shouldFetch = false
        _ = ext(api).modifyItem(
            item,
            baseVersion: version(contentHash: "stale-hash", metadataFor: remote),
            changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { result, _, fetch, error in
            current = result; shouldFetch = fetch; err = error as NSError?; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.count, 1,
                       "a 412 must not resend a stale rename against a new server snapshot")
        XCTAssertEqual(api.patchCalls.first?.ifMatch, "stale-hash")
        XCTAssertNil(err)
        XCTAssertEqual(current?.filename, "Remote Title.md")
        XCTAssertTrue(shouldFetch)
    }

    func testStaleFileMetadataBaseReturnsCurrentItemWithoutPatch() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let original = WriteItemMapper.item(
            for: Fixtures.item(
                id: "p1", file: "a.md", kind: "note", title: "a"),
            inFolder: "notes", handle: "demo", readOnly: false)!
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "remote.md", kind: "note", title: "Remote", hash: "h")]
        let local = fileItem(id: "p1", file: "Local.md", folder: "notes")
        let exp = expectation(description: "stale-file-metadata")
        var result: NSFileProviderItem?

        _ = ext(api).modifyItem(
            local, baseVersion: version(original), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Remote.md")
    }

    func testBoundedCanonicalFilenameDoesNotRetitleStoredFullTitle() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let fullTitle = String(repeating: "Why? ", count: 80)
        let entry = Fixtures.item(
            id: "p1", file: "post.md", kind: "note", slug: "post",
            title: fullTitle, hash: "h")
        api.manifests["notes"] = [entry]
        let current = WriteItemMapper.item(
            for: entry, inFolder: "notes", handle: "demo", readOnly: false)!
        XCTAssertLessThanOrEqual(
            current.filename.utf8.count, WriteFilename.maximumComponentUTF8Length)
        let exp = expectation(description: "bounded-no-op")
        var result: NSFileProviderItem?

        _ = ext(api).modifyItem(
            WriteFileProviderItem(current), baseVersion: version(current),
            changedFields: [.filename], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(result?.filename, current.filename)
    }

    @available(macOS 26.0, *)
    func testExplicitFailOnConflictReturnsLocalVersionConflictError() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.patchResult = .failure(.conflict)
        let item = fileItem(id: "p1", file: "Stale Rename.md", folder: "notes")
        let exp = expectation(description: "fail-on-conflict")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("stale-hash"), changedFields: [.filename],
            contents: nil, options: [.failOnConflict], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.count, 1)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(
            err?.code,
            NSFileProviderError.localVersionConflictingWithServer.rawValue)
    }

    func testRenameWithoutBaseHashReturnsCurrentItemWithoutUnguardedPatch() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(id: "p1", file: "remote.md", kind: "note", title: "Remote Title")
        ]
        let item = fileItem(id: "p1", file: "Rename.md", folder: "notes")
        let exp = expectation(description: "rename-without-version")
        var err: NSError?
        var current: NSFileProviderItem?
        _ = ext(api).modifyItem(
            item, baseVersion: version(""), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { result, _, _, error in current = result; err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertNil(err)
        XCTAssertEqual(current?.filename, "Remote Title.md")
    }

    func testMoveFileCallsPatchWithFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        // Item now parented under "blog" (moved out of notes).
        let item = fileItem(id: "p1", file: "a.md", folder: "blog")
        let exp = expectation(description: "move")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.parentItemIdentifier],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.patchCalls.first?.postId, "p1")
        XCTAssertEqual(api.patchCalls.first?.folderId, "blog")
    }

    func testRenameFolderCallsRenameFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let current = WriteItemMapper.item(for: folder, handle: "demo", readOnly: false)
        let item = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Writing")))
        let exp = expectation(description: "renameFolder")
        _ = ext(api).modifyItem(
            item, baseVersion: version(current), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.renameFolderCalls.first?.folderId, "blog")
        XCTAssertEqual(api.renameFolderCalls.first?.name, "Writing")
    }

    func testRenameFolderAndWorkspaceDecodePortableNames() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let currentFolder = WriteItemMapper.item(
            for: folder, handle: "demo", readOnly: false)
        let folderItem = WriteFileProviderItem(
            currentFolder.withFilename(WriteFilename.encodeComponent("Why??")))
        let folderExp = expectation(description: "renameFolderEscaped")
        _ = ext(api).modifyItem(
            folderItem, baseVersion: version(currentFolder), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in folderExp.fulfill() }

        let currentWorkspace = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let workspaceItem = WriteFileProviderItem(
            currentWorkspace.withFilename(
                "What~3F~3F\(WriteFilename.collisionSuffix("demo"))"))
        let workspaceExp = expectation(description: "renameWorkspaceEscaped")
        _ = ext(api).modifyItem(
            workspaceItem, baseVersion: version(currentWorkspace), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in workspaceExp.fulfill() }
        wait(for: [folderExp, workspaceExp], timeout: 5)

        XCTAssertEqual(api.renameFolderCalls.first?.name, "Why??")
        XCTAssertEqual(api.renameWorkspaceCalls.first?.name, "What??")
    }

    func testRenameWorkspaceCallsRenameWorkspace() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let current = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let item = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Studio")))
        let exp = expectation(description: "renameWorkspace")
        _ = ext(api).modifyItem(
            item, baseVersion: version(current), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.renameWorkspaceCalls.first?.name, "Studio")
    }

    func testStaleMountedFolderNameDoesNotOverwriteRemoteRename() {
        let original = Fixtures.workspace()
        let oldFolder = original.folders.first { $0.id == "blog" }!
        let renamedFolders = original.folders.map { folder in
            folder.id == "blog"
                ? WriteWorkspaceFolder(
                    id: folder.id, name: "Remote Folder", path: "Remote Folder",
                    mode: folder.mode, parentId: folder.parentId)
                : folder
        }
        let api = FakeExtensionAPI(workspace: WriteWorkspace(
            blog: original.blog, folders: renamedFolders))
        let old = WriteItemMapper.item(for: oldFolder, handle: "demo", readOnly: false)
        let local = WriteFileProviderItem(
            old.withFilename(WriteFilename.encodeComponent("Local Folder")))
        let exp = expectation(description: "stale-folder")
        var result: NSFileProviderItem?
        _ = ext(api).modifyItem(
            local, baseVersion: version(old), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.renameFolderCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Remote Folder")
    }

    func testStaleMountedWorkspaceNameDoesNotOverwriteRemoteRename() {
        let original = Fixtures.workspace()
        let remote = WriteWorkspace(
            blog: WriteWorkspaceBlog(
                handle: "demo", name: "Remote Workspace", username: "demo"),
            folders: original.folders)
        let api = FakeExtensionAPI(workspace: remote)
        let old = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let local = WriteFileProviderItem(
            old.withFilename(WriteFilename.encodeComponent("Local Workspace")))
        let descriptors = [FileProviderWorkspace(
            name: "Demo", handle: "demo", origin: "https://example.test", token: "token")]
        let exp = expectation(description: "stale-workspace")
        var result: NSFileProviderItem?
        _ = ext(api, descriptors: descriptors).modifyItem(
            local, baseVersion: version(old), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.renameWorkspaceCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Remote Workspace")
    }

    func testBeforeFirstSyncMetadataSentinelCannotRenameFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let current = WriteItemMapper.item(for: folder, handle: "demo", readOnly: false)
        let local = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Local Folder")))
        let beforeFirst = NSFileProviderItemVersion(
            contentVersion: Data("folder".utf8),
            metadataVersion: NSFileProviderItemVersion.beforeFirstSyncComponent)
        let exp = expectation(description: "folder-before-first")
        var result: NSFileProviderItem?
        _ = ext(api).modifyItem(
            local, baseVersion: beforeFirst, changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.renameFolderCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Blog")
    }

    // MARK: delete

    func testDeleteFileCallsDelete() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let exp = expectation(description: "delete")
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            baseVersion: version("h"), options: [], request: NSFileProviderRequest()
        ) { _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.deleteCalls, ["p1"])
        // The base version's content hash rides along as If-Match for
        // stale-delete protection.
        XCTAssertEqual(api.deleteIfMatchCalls, ["h"])
    }

    func testStaleDeleteIsRejectedWithCurrentRemoteItem() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.deleteResult = .failure(.conflict)
        let currentEntry = Fixtures.item(
            id: "p1", file: "current.md", kind: "note", title: "Current")
        api.manifests["notes"] = [currentEntry]
        let current = WriteItemMapper.item(
            for: currentEntry, inFolder: "notes", handle: "demo", readOnly: false)!
        let exp = expectation(description: "stale-delete")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            baseVersion: version(current), options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.deleteCalls, ["p1"])
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.deletionRejected.rawValue)
    }

    func testDeleteWithoutProviderBaseIsRejectedWithoutRequest() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(id: "p1", file: "current.md", kind: "note", title: "Current")
        ]
        let beforeFirst = NSFileProviderItemVersion(
            contentVersion: NSFileProviderItemVersion.beforeFirstSyncComponent,
            metadataVersion: NSFileProviderItemVersion.beforeFirstSyncComponent)
        let exp = expectation(description: "delete-before-first")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            baseVersion: beforeFirst, options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.deleteCalls.isEmpty)
        XCTAssertEqual(err?.code, NSFileProviderError.deletionRejected.rawValue)
    }

    func testDeleteFolderIsRejected() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let exp = expectation(description: "delete-folder")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "folder:demo:blog"),
            baseVersion: version("h"), options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
        XCTAssertTrue(api.deleteCalls.isEmpty)
    }
}
