import XCTest
import FileProvider
@testable import WriteFileProviderExtensionCore
@testable import WriteFileProviderKit
@testable import WriteFileProviderBridge

// MARK: In-memory fake API (self-contained; the kit's test fixtures are not visible here)

private final class FakeAPI: WriteSyncAPI, @unchecked Sendable {
    var workspaceValue: WriteWorkspace
    var manifests: [String: [WriteManifestItem]]
    var cursor: String
    var failManifest: WriteSyncError?

    init(workspace: WriteWorkspace, manifests: [String: [WriteManifestItem]], cursor: String = "c0") {
        self.workspaceValue = workspace
        self.manifests = manifests
        self.cursor = cursor
    }
    func workspace() async -> Result<WriteWorkspace, WriteSyncError> { .success(workspaceValue) }
    func manifest(folderId: String) async -> Result<[WriteManifestItem], WriteSyncError> {
        if let failManifest { return .failure(failManifest) }
        return .success(manifests[folderId] ?? [])
    }
    func fileText(postId: String) async -> Result<WriteFileContent, WriteSyncError> { .failure(.notFound) }
    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError> {
        .success(WriteChangeReply(cursor: self.cursor, changed: cursor != nil && cursor != self.cursor))
    }
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func putFile(postId: String, body: String, ifMatch hash: String) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func patchFile(postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, WriteSyncError> { .success(()) }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async -> Result<WriteWorkspaceFolder, WriteSyncError> { .failure(.conflict) }
    func renameFolder(folderId: String, name: String) async -> Result<WriteWorkspaceFolder, WriteSyncError> { .failure(.conflict) }
}

private func standardAPI() -> FakeAPI {
    let ws = WriteWorkspace(
        blog: WriteWorkspaceBlog(handle: "demo", name: "Demo", username: "demo"),
        folders: [
            WriteWorkspaceFolder(id: "blog", name: "Blog", path: "Blog", mode: "blog", parentId: nil),
            WriteWorkspaceFolder(id: "notes", name: "Notes", path: "Notes", mode: "notes", parentId: nil),
            WriteWorkspaceFolder(id: "drafts", name: "Drafts", path: "Blog/Drafts", mode: "blog", parentId: "blog"),
        ])
    let entry = { (id: String, file: String, kind: String) in
        WriteManifestItem(file: file, kind: kind, slug: file, title: file, status: "draft",
                          hash: "h", id: id, date: nil, createdAt: nil, updatedAt: nil, url: nil)
    }
    return FakeAPI(workspace: ws, manifests: [
        "blog": [entry("p1", "hello.md", "article"), entry("p2", "talk.md", "talk")],
        "drafts": [entry("p3", "wip.md", "article")],
        "notes": [entry("n1", "idea.md", "note")],
    ])
}

// MARK: Fake observers

private final class EnumObserver: NSObject, NSFileProviderEnumerationObserver {
    var items: [NSFileProviderItem] = []
    var finished = false
    var error: Error?
    let done: XCTestExpectation
    init(_ done: XCTestExpectation) { self.done = done }
    func didEnumerate(_ updatedItems: [any NSFileProviderItem]) { items.append(contentsOf: updatedItems) }
    func finishEnumerating(upTo nextPage: NSFileProviderPage?) { finished = true; done.fulfill() }
    func finishEnumeratingWithError(_ error: any Error) { self.error = error; done.fulfill() }
}

private final class ChangeObserver: NSObject, NSFileProviderChangeObserver {
    var updated: [NSFileProviderItem] = []
    var deleted: [NSFileProviderItemIdentifier] = []
    var anchor: NSFileProviderSyncAnchor?
    var error: Error?
    let done: XCTestExpectation
    init(_ done: XCTestExpectation) { self.done = done }
    func didUpdate(_ updatedItems: [any NSFileProviderItem]) { updated.append(contentsOf: updatedItems) }
    func didDeleteItems(withIdentifiers deletedItemIdentifiers: [NSFileProviderItemIdentifier]) {
        deleted.append(contentsOf: deletedItemIdentifiers)
    }
    func finishEnumeratingChanges(upTo anchor: NSFileProviderSyncAnchor, moreComing: Bool) {
        self.anchor = anchor; done.fulfill()
    }
    func finishEnumeratingWithError(_ error: any Error) { self.error = error; done.fulfill() }
}

final class EnumeratorAdapterTests: XCTestCase {

    private func adapter(_ container: WriteItemIdentifier, _ api: WriteSyncAPI) -> WriteEnumeratorAdapter {
        WriteEnumeratorAdapter(
            container: container,
            core: WorkspaceEnumerator(api: api, handle: "demo", workspaceName: "Demo", readOnly: true))
    }

    func testRootEnumeratesTheWorkspace() {
        let exp = expectation(description: "enumerate")
        let obs = EnumObserver(exp)
        adapter(.rootContainer, standardAPI()).enumerateItems(for: obs, startingAt: NSFileProviderPage(Data()))
        wait(for: [exp], timeout: 5)
        XCTAssertTrue(obs.finished)
        let ids = Set(obs.items.map { $0.itemIdentifier.rawValue })
        XCTAssertEqual(ids, ["workspace:demo"])
    }

    func testWorkspaceEnumeratesTopLevelFolders() {
        let exp = expectation(description: "enumerate")
        let obs = EnumObserver(exp)
        adapter(.workspace("demo"), standardAPI()).enumerateItems(for: obs, startingAt: NSFileProviderPage(Data()))
        wait(for: [exp], timeout: 5)
        let ids = Set(obs.items.map { $0.itemIdentifier.rawValue })
        XCTAssertEqual(ids, ["folder:demo:blog", "folder:demo:notes"])
    }

    func testFolderEnumeratesSubfoldersAndFiles() {
        let exp = expectation(description: "enumerate")
        let obs = EnumObserver(exp)
        adapter(.folder(handle: "demo", id: "blog"), standardAPI()).enumerateItems(for: obs, startingAt: NSFileProviderPage(Data()))
        wait(for: [exp], timeout: 5)
        let ids = Set(obs.items.map { $0.itemIdentifier.rawValue })
        XCTAssertEqual(ids, ["folder:demo:drafts", "file:demo:p1", "file:demo:p2"])
    }

    func testEnumerationErrorFinishesWithError() {
        let api = standardAPI()
        api.failManifest = .network("offline")
        let exp = expectation(description: "enumerate")
        let obs = EnumObserver(exp)
        adapter(.folder(handle: "demo", id: "blog"), api).enumerateItems(for: obs, startingAt: NSFileProviderPage(Data()))
        wait(for: [exp], timeout: 5)
        XCTAssertFalse(obs.finished)
        XCTAssertEqual((obs.error as NSError?)?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual((obs.error as NSError?)?.code, NSFileProviderError.serverUnreachable.rawValue)
    }

    func testSyncAnchorIsServerCursor() {
        let api = standardAPI(); api.cursor = "c42"
        let exp = expectation(description: "anchor")
        var anchor: NSFileProviderSyncAnchor?
        adapter(.rootContainer, api).currentSyncAnchor { anchor = $0; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(anchor.map { String(decoding: $0.rawValue, as: UTF8.self) }, "c42")
    }

    func testEnumerateChangesExpiresAnchorWhenCursorMoved() {
        // When the supplied anchor differs from the current cursor the workspace
        // HAS moved, but the /changes cursor cannot produce a precise per-anchor
        // delta, so re-listing survivors would never report deletions (a
        // web-deleted post would linger as a ghost). Expiring the anchor makes
        // the system throw its state away and call enumerateItems for a clean
        // full reconcile.
        let api = standardAPI(); api.cursor = "c7"
        let exp = expectation(description: "changes")
        let obs = ChangeObserver(exp)
        adapter(.folder(handle: "demo", id: "blog"), api).enumerateChanges(for: obs, from: NSFileProviderSyncAnchor(Data("old".utf8)))
        wait(for: [exp], timeout: 5)
        XCTAssertTrue(obs.updated.isEmpty, "must not emit stale survivor updates")
        XCTAssertNil(obs.anchor, "must not finish at a fresh anchor")
        XCTAssertEqual((obs.error as NSError?)?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual((obs.error as NSError?)?.code, NSFileProviderError.syncAnchorExpired.rawValue)
    }

    func testEnumerateChangesFinishesQuietlyWhenAnchorMatchesCursor() {
        // The system probes for changes on every idle tick. When the supplied
        // anchor already equals the current cursor, nothing moved, so the
        // enumerator must finish with no changes and no error rather than expire
        // the anchor and trigger a needless full re-enumeration.
        let api = standardAPI(); api.cursor = "c9"
        let exp = expectation(description: "changes")
        let obs = ChangeObserver(exp)
        adapter(.folder(handle: "demo", id: "blog"), api).enumerateChanges(for: obs, from: NSFileProviderSyncAnchor(Data("c9".utf8)))
        wait(for: [exp], timeout: 5)
        XCTAssertNil(obs.error, "a matching anchor must not error")
        XCTAssertTrue(obs.updated.isEmpty)
        XCTAssertTrue(obs.deleted.isEmpty)
        XCTAssertEqual(obs.anchor.map { String(decoding: $0.rawValue, as: UTF8.self) }, "c9",
                       "must finish at the same anchor")
    }

    // MARK: error bridging

    func testBridgeMapsErrors() {
        XCTAssertEqual(WriteEnumeratorAdapter.bridge(.notFound).code, NSFileProviderError.noSuchItem.rawValue)
        XCTAssertEqual(WriteEnumeratorAdapter.bridge(.http(401, "x")).code, NSFileProviderError.notAuthenticated.rawValue)
        XCTAssertEqual(WriteEnumeratorAdapter.bridge(.http(403, "x")).code, NSFileProviderError.notAuthenticated.rawValue)
        XCTAssertEqual(WriteEnumeratorAdapter.bridge(.network("x")).code, NSFileProviderError.serverUnreachable.rawValue)
        XCTAssertEqual(WriteEnumeratorAdapter.bridge(.http(500, "x")).code, NSFileProviderError.serverUnreachable.rawValue)
    }
}
