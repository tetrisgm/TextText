import XCTest
import FileProvider
import UniformTypeIdentifiers
@testable import WriteFileProviderExtensionCore
@testable import WriteFileProviderKit
@testable import WriteFileProviderBridge

final class FileProviderExtensionTests: XCTestCase {

    private func ext(_ api: WriteSyncAPI?) -> FileProviderExtension {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "workspace-test"),
            displayName: "Write")
        return FileProviderExtension(domain: domain, apiFactory: { api })
    }

    private func fileItem(id: String, file: String, folder: String) -> WriteFileProviderItem {
        WriteFileProviderItem(
            WriteItemMapper.item(for: Fixtures.item(id: id, file: file, kind: "note"),
                                 inFolder: folder, readOnly: false)!)
    }

    private func tempFile(_ body: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? Data(body.utf8).write(to: url)
        return url
    }

    private func version(_ hash: String) -> NSFileProviderItemVersion {
        NSFileProviderItemVersion(contentVersion: Data(hash.utf8), metadataVersion: Data("m".utf8))
    }

    // MARK: not authenticated

    func testItemWithoutAuthIsNotAuthenticated() {
        let exp = expectation(description: "item")
        var err: NSError?
        _ = ext(nil).item(
            for: NSFileProviderItemIdentifier(rawValue: "file:p1"),
            request: NSFileProviderRequest()
        ) { _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFileProviderError.notAuthenticated.rawValue)
    }

    func testEnumeratorWithoutAuthThrows() {
        XCTAssertThrowsError(
            try ext(nil).enumerator(for: .rootContainer, request: NSFileProviderRequest()))
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
        XCTAssertEqual(api.createFileCalls.first?.idempotencyKey, "file:tmp")
    }

    func testCreateFolderCallsCreateFolderWithParentPath() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        // A folder template parented under "blog".
        let folder = WriteWorkspaceFolder(id: "tmp", name: "Ideas", path: "Blog/Ideas", mode: "blog", parentId: "blog")
        let template = WriteFileProviderItem(WriteItemMapper.item(for: folder, readOnly: false))
        let exp = expectation(description: "createFolder")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFolderCalls.first?.parentPath, "Blog")
        XCTAssertEqual(api.createFolderCalls.first?.name, "Ideas")
        XCTAssertEqual(api.createFolderCalls.first?.idempotencyKey, "folder:tmp")
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
        XCTAssertEqual(api.patchCalls.first?.slug, "renamed")
    }

    func testRenameFileCallsPatchWithSlug() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "Renamed Title.md", folder: "notes")
        let exp = expectation(description: "rename")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.patchCalls.first?.postId, "p1")
        XCTAssertEqual(api.patchCalls.first?.slug, "renamed-title")
        XCTAssertNil(api.patchCalls.first?.folderId)
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
        let folder = WriteWorkspaceFolder(id: "blog", name: "Writing", path: "Writing", mode: "blog", parentId: nil)
        let item = WriteFileProviderItem(WriteItemMapper.item(for: folder, readOnly: false))
        let exp = expectation(description: "renameFolder")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.renameFolderCalls.first?.folderId, "blog")
        XCTAssertEqual(api.renameFolderCalls.first?.name, "Writing")
    }

    // MARK: delete

    func testDeleteFileCallsDelete() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let exp = expectation(description: "delete")
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:p1"),
            baseVersion: version("h"), options: [], request: NSFileProviderRequest()
        ) { _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.deleteCalls, ["p1"])
        // The base version's content hash rides along as If-Match for
        // stale-delete protection.
        XCTAssertEqual(api.deleteIfMatchCalls, ["h"])
    }

    func testDeleteFolderIsRejected() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let exp = expectation(description: "delete-folder")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "folder:blog"),
            baseVersion: version("h"), options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
        XCTAssertTrue(api.deleteCalls.isEmpty)
    }

    // MARK: slug helper

    func testSlugFromFilename() {
        XCTAssertEqual(FileProviderExtension.slug(fromFilename: "My Note.md"), "my-note")
        XCTAssertEqual(FileProviderExtension.slug(fromFilename: "Hello, World!.md"), "hello-world")
        XCTAssertEqual(FileProviderExtension.slug(fromFilename: "already-slug"), "already-slug")
    }
}
