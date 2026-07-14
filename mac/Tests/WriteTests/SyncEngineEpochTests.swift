import Foundation
import XCTest
import WriteWorkspaceCore
@testable import Write

final class SyncEngineEpochTests: XCTestCase {
    func testSignOutInvalidatesBlockedWorkspaceBeforeCacheOrServerMutation() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let store = makeStore(at: state)
        store.saveCredentials(credentials())
        let client = EpochSyncClient()
        client.workspaceValue = workspace()
        let gate = SyncEngineGate()
        client.workspaceGate = gate

        let local = root.appendingPathComponent("Notes/local.md")
        try write("local draft\n", to: local)

        let linked = LockedValue(true)
        let engine = makeEngine(store: store, root: LockedValue(root), client: client) {
            linked.get()
        }
        let finished = expectation(description: "stale pass returned")
        DispatchQueue.global(qos: .userInitiated).async {
            _ = engine.runOnePassBlocking()
            finished.fulfill()
        }

        XCTAssertTrue(gate.waitUntilEntered())
        linked.set(false)
        engine.resetForSignOut()
        gate.release()

        wait(for: [finished], timeout: 5)
        _ = engine.runOnePassBlocking() // Drain the queued index reset.

        XCTAssertNil(store.cachedWorkspace())
        XCTAssertNil(store.loadCredentials())
        XCTAssertTrue(store.loadIndex().entries.isEmpty)
        XCTAssertEqual(client.postsSnapshot(), [])
        XCTAssertEqual(client.putCount(), 0)
    }

    func testSignOutDuringManifestPreventsStalePut() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let store = makeStore(at: state)
        let serverText = markdown(body: "server")
        let serverHash = MarkdownIdentityCodec.syncHash(for: serverText)
        let localText = MarkdownIdentityCodec.inject(
            into: markdown(body: "local edit"), itemId: "p1", folderId: "notes", kind: "note")
        try write(localText, to: root.appendingPathComponent("Notes/a.md"))
        try write(
            "marker\nmirror-id: manifest-race\n",
            to: root.appendingPathComponent(".write-local.nosync/state/sync-marker.txt"))
        store.saveIndex(SyncIndex(
            entries: [
                "p1": IndexEntry(
                    hash: serverHash, relativePath: "Notes/a.md",
                    folderId: "notes", kind: "note")
            ],
            mirrorId: "manifest-race"
        ))

        let client = EpochSyncClient()
        client.workspaceValue = workspace()
        client.manifestReplies["notes"] = .manifest([
            item(id: "p1", hash: serverHash)
        ], etag: nil)
        let gate = SyncEngineGate()
        client.manifestGate = gate
        let linked = LockedValue(true)
        let engine = makeEngine(store: store, root: LockedValue(root), client: client) {
            linked.get()
        }

        let finished = expectation(description: "manifest pass returned")
        DispatchQueue.global(qos: .userInitiated).async {
            _ = engine.runOnePassBlocking()
            finished.fulfill()
        }
        XCTAssertTrue(gate.waitUntilEntered())
        linked.set(false)
        engine.resetForSignOut()
        gate.release()

        wait(for: [finished], timeout: 5)
        _ = engine.runOnePassBlocking()

        XCTAssertEqual(client.putCount(), 0)
        XCTAssertTrue(store.loadIndex().entries.isEmpty)
    }

    func testRootResetDuringDownloadNeverWritesIntoOldRoot() throws {
        let oldRoot = try temporaryDirectory()
        let newRoot = try temporaryDirectory()
        let state = try temporaryDirectory()
        let store = makeStore(at: state)
        let serverText = markdown(body: "server")
        let serverHash = MarkdownIdentityCodec.syncHash(for: serverText)
        let client = EpochSyncClient()
        client.workspaceValue = workspace()
        client.manifestReplies["notes"] = .manifest([
            item(id: "p1", hash: serverHash)
        ], etag: nil)
        client.fileTexts["p1"] = serverText
        let gate = SyncEngineGate()
        client.fileTextGate = gate

        let root = LockedValue(oldRoot)
        let engine = makeEngine(store: store, root: root, client: client)
        let finished = expectation(description: "old-root pass returned")
        DispatchQueue.global(qos: .userInitiated).async {
            _ = engine.runOnePassBlocking()
            finished.fulfill()
        }

        XCTAssertTrue(gate.waitUntilEntered())
        root.set(newRoot)
        engine.resetForNewRoot()
        gate.release()

        wait(for: [finished], timeout: 5)
        let replacementSummary = engine.runOnePassBlocking()

        XCTAssertFalse(FileManager.default.fileExists(
            atPath: oldRoot.appendingPathComponent("Notes/a.md").path))
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: newRoot.appendingPathComponent("Notes/a.md").path))
        XCTAssertEqual(replacementSummary.errors, 0)
        XCTAssertEqual(store.loadIndex().entries["p1"]?.relativePath, "Notes/a.md")
    }

    func testRootResetPreservesCredentials() throws {
        let oldRoot = try temporaryDirectory()
        let newRoot = try temporaryDirectory()
        let state = try temporaryDirectory()
        let store = makeStore(at: state)
        store.saveCredentials(credentials())
        let client = EpochSyncClient()
        let root = LockedValue(oldRoot)
        let engine = makeEngine(
            store: store, root: root, client: client, isLinked: { false })

        root.set(newRoot)
        engine.resetForNewRoot()
        _ = engine.runOnePassBlocking()

        XCTAssertEqual(store.loadCredentials()?.token, "test-token")
    }

    func testLegacyRootInsideWriteFileProviderMountIsRejectedBeforeUse() throws {
        let parent = try temporaryDirectory()
        let root = parent.appendingPathComponent("uncreated-legacy-root", isDirectory: true)
        let state = try temporaryDirectory()
        let store = makeStore(at: state)
        let client = EpochSyncClient()
        client.workspaceValue = workspace()
        let engine = makeEngine(store: store, root: LockedValue(root), client: client)
        engine.isInsideWriteFileProviderMount = { $0.standardizedFileURL == root.standardizedFileURL }

        let summary = engine.runOnePassBlocking()

        XCTAssertEqual(summary.errors, 1)
        XCTAssertEqual(client.workspaceCallCount(), 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
        XCTAssertTrue(client.activitiesSnapshot().contains {
            $0.contains("cannot be inside the Write File Provider location")
        })
    }

    func testBurstSyncNowTriggersCoalesceBehindRunningPass() throws {
        let root = try temporaryDirectory()
        let state = try temporaryDirectory()
        let store = makeStore(at: state)
        let client = EpochSyncClient()
        client.workspaceFailure = .network("offline")
        let gate = SyncEngineGate()
        client.workspaceGate = gate
        let secondCall = expectation(description: "one coalesced follow-up")
        let extraCall = expectation(description: "no extra follow-up")
        extraCall.isInverted = true
        client.onWorkspaceCall = { count in
            if count == 2 { secondCall.fulfill() }
            if count > 2 { extraCall.fulfill() }
        }
        let engine = makeEngine(store: store, root: LockedValue(root), client: client)

        engine.syncNow()
        XCTAssertTrue(gate.waitUntilEntered())
        for _ in 0..<20 { engine.syncNow() }
        gate.release()

        wait(for: [secondCall], timeout: 5)
        wait(for: [extraCall], timeout: 0.4)
        XCTAssertEqual(client.workspaceCallCount(), 2)
    }

    private func makeEngine(
        store: StateStore,
        root: LockedValue<URL>,
        client: EpochSyncClient,
        isLinked: @escaping () -> Bool = { true }
    ) -> SyncEngine {
        let engine = SyncEngine(store: store)
        engine.callbackQueue = nil
        engine.makeClient = { isLinked() ? client : nil }
        engine.syncRootProvider = { root.get() }
        engine.workspaceLocationProvider = {
            let url = root.get()
            return WorkspaceLocation(
                url: url, kind: .injected, iCloudAvailable: false,
                statusMessage: "test")
        }
        engine.onActivity = { client.recordActivity($0) }
        return engine
    }

    private func makeStore(at state: URL) -> StateStore {
        let previous = ProcessInfo.processInfo.environment["WRITE_STATE_DIR"]
        setenv("WRITE_STATE_DIR", state.path, 1)
        let store = StateStore()
        if let previous {
            setenv("WRITE_STATE_DIR", previous, 1)
        } else {
            unsetenv("WRITE_STATE_DIR")
        }
        return store
    }

    private func workspace() -> Workspace {
        Workspace(
            blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil),
            folders: [
                WorkspaceFolder(
                    id: "notes", name: "Notes", path: "notes",
                    mode: "notes", parentId: nil)
            ])
    }

    private func credentials() -> Credentials {
        Credentials(
            token: "test-token", serverOrigin: "https://example.test",
            tokenName: "test", linkedAt: Date(timeIntervalSince1970: 0))
    }

    private func item(id: String, hash: String) -> ManifestItem {
        ManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "A",
            status: "draft", hash: hash, id: id, date: nil,
            createdAt: nil, updatedAt: nil, url: nil)
    }

    private func markdown(body: String) -> String {
        "---\ntitle: \"A\"\nstatus: \"draft\"\n---\n\n\(body)\n"
    }

    private func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("WriteEpochTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

private final class SyncEngineGate: @unchecked Sendable {
    private let lock = NSLock()
    private var unused = true
    private let entered = DispatchSemaphore(value: 0)
    private let proceed = DispatchSemaphore(value: 0)

    func pauseOnce() {
        lock.lock()
        let shouldPause = unused
        unused = false
        lock.unlock()
        guard shouldPause else { return }
        entered.signal()
        _ = proceed.wait(timeout: .now() + 5)
    }

    func waitUntilEntered() -> Bool {
        entered.wait(timeout: .now() + 2) == .success
    }

    func release() {
        proceed.signal()
    }
}

private final class LockedValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) {
        self.value = value
    }

    func get() -> Value {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func set(_ value: Value) {
        lock.lock()
        self.value = value
        lock.unlock()
    }
}

private final class EpochSyncClient: SyncClient, @unchecked Sendable {
    private let lock = NSLock()

    var workspaceValue = Workspace(
        blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil), folders: [])
    var workspaceFailure: ClientFailure?
    var manifestReplies: [String: ManifestReply] = [:]
    var fileTexts: [String: String] = [:]
    var workspaceGate: SyncEngineGate?
    var manifestGate: SyncEngineGate?
    var fileTextGate: SyncEngineGate?
    var onWorkspaceCall: ((Int) -> Void)?

    private var workspaceCalls = 0
    private var posts: [String] = []
    private var puts = 0
    private var activities: [String] = []

    func workspace() -> Result<(Workspace, Data), ClientFailure> {
        lock.lock()
        workspaceCalls += 1
        let call = workspaceCalls
        let callback = onWorkspaceCall
        lock.unlock()
        callback?(call)
        workspaceGate?.pauseOnce()
        if let workspaceFailure { return .failure(workspaceFailure) }
        let data = (try? JSONEncoder().encode(workspaceValue)) ?? Data()
        return .success((workspaceValue, data))
    }

    func manifest(folderId: String, etag: String?) -> Result<ManifestReply, ClientFailure> {
        manifestGate?.pauseOnce()
        return .success(manifestReplies[folderId] ?? .manifest([], etag: nil))
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) -> Result<WorkspaceFolder, ClientFailure> {
        .success(WorkspaceFolder(
            id: "new-folder", name: name, path: "\(parentPath)/\(name)",
            mode: "notes", parentId: nil))
    }

    func fileText(postId: String) -> Result<(text: String, hash: String?), ClientFailure> {
        fileTextGate?.pauseOnce()
        guard let text = fileTexts[postId] else {
            return .failure(.badResponse("missing file text \(postId)"))
        }
        return .success((text, MarkdownIdentityCodec.syncHash(for: text)))
    }

    func putFile(
        postId: String, body: String, ifMatch hash: String
    ) -> Result<SaveReply, ClientFailure> {
        lock.lock()
        puts += 1
        lock.unlock()
        return .success(.saved(defaultItem(id: postId, body: body)))
    }

    func patchFile(
        postId: String, folderId: String?, slug: String?, ifMatch hash: String?
    ) -> Result<SaveReply, ClientFailure> {
        .success(.saved(defaultItem(id: postId, body: "")))
    }

    func postFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        lock.lock()
        posts.append(body)
        let count = posts.count
        lock.unlock()
        return .success(.saved(defaultItem(id: "new-\(count)", body: body)))
    }

    func deleteFile(postId: String, ifMatch hash: String?) -> Result<Void, ClientFailure> {
        .success(())
    }

    func advertisedAppVersion() -> String? { nil }

    func workspaceCallCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return workspaceCalls
    }

    func postsSnapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return posts
    }

    func putCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return puts
    }

    func recordActivity(_ message: String) {
        lock.lock()
        activities.append(message)
        lock.unlock()
    }

    func activitiesSnapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return activities
    }

    private func defaultItem(id: String, body: String) -> ManifestItem {
        ManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "A",
            status: "draft", hash: MarkdownIdentityCodec.syncHash(for: body),
            id: id, date: nil, createdAt: nil, updatedAt: nil, url: nil)
    }
}
