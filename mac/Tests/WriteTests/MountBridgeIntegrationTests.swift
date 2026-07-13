import FileProvider
import Foundation
import WriteFileProviderKit
import XCTest
@testable import Write

final class MountBridgeIntegrationTests: XCTestCase {
    private var temporaryDirectories: [URL] = []

    override func tearDownWithError() throws {
        for directory in temporaryDirectories {
            try? FileManager.default.removeItem(at: directory)
        }
        temporaryDirectories.removeAll()
    }

    func testEvictionRechecksLocalFileAfterServerFetchInterleaving() throws {
        let fixture = try makeFixture()
        let api = MountBridgeAPI(text: fixture.initialText)
        let provider = MountBridgeProvider()
        let bridge = makeBridge(api: api)
        defer { bridge.stop() }
        waitForPass(bridge) { bridge.start(mountRoot: fixture.root, provider: provider.operations) }

        api.setText(markdown(body: "remote edit", revision: 2), hash: "h2")
        let gate = MountBridgeGate()
        api.setFileTextGate(gate)
        let pass = passExpectation(bridge)
        bridge.nudge()
        XCTAssertTrue(gate.waitUntilEntered(), "reconcile never reached the gated server fetch")
        try markdown(body: "newer local edit", revision: 1).write(
            to: fixture.file, atomically: true, encoding: .utf8)
        gate.release()
        wait(for: [pass], timeout: 2)

        XCTAssertEqual(provider.evictedIdentifiers(), [])
        XCTAssertEqual(try String(contentsOf: fixture.file, encoding: .utf8),
                       markdown(body: "newer local edit", revision: 1))
    }

    func testRemoteFolderRenameIsNotPushedBackFromStaleMountedName() throws {
        let fixture = try makeFixture()
        let api = MountBridgeAPI(text: fixture.initialText)
        let provider = MountBridgeProvider()
        let bridge = makeBridge(api: api)
        defer { bridge.stop() }
        waitForPass(bridge) { bridge.start(mountRoot: fixture.root, provider: provider.operations) }

        api.setFolderName("Remote Folder")
        waitForPass(bridge) { bridge.nudge() }

        XCTAssertEqual(api.renamedFolders(), [])
        XCTAssertFalse(provider.signalledIdentifiers().isEmpty)
    }

    func testProvenLocalFolderRenameIsPushed() throws {
        let fixture = try makeFixture()
        let api = MountBridgeAPI(text: fixture.initialText)
        let provider = MountBridgeProvider()
        let bridge = makeBridge(api: api)
        defer { bridge.stop() }
        waitForPass(bridge) { bridge.start(mountRoot: fixture.root, provider: provider.operations) }

        let renamed = fixture.root.appendingPathComponent("Local Folder", isDirectory: true)
        try FileManager.default.moveItem(at: fixture.folder, to: renamed)
        waitForPass(bridge) { bridge.nudge() }

        XCTAssertEqual(api.renamedFolders(), ["Local Folder"])
    }

    func testWorkspaceSwitchCancelsBlockedOldGenerationBeforeMutation() throws {
        let fixture = try makeFixture()
        let firstAPI = MountBridgeAPI(handle: "first", text: fixture.initialText)
        let secondAPI = MountBridgeAPI(handle: "second", text: fixture.initialText)
        let provider = MountBridgeProvider()
        let bridge = makeBridge(api: firstAPI, handle: "first")
        defer { bridge.stop() }
        waitForPass(bridge) { bridge.start(mountRoot: fixture.root, provider: provider.operations) }
        let originalGeneration = bridge.testingState().generation

        let renamed = fixture.folder.appendingPathComponent("Local Title.md")
        try FileManager.default.moveItem(at: fixture.file, to: renamed)
        let gate = MountBridgeGate()
        firstAPI.setFileTextGate(gate)
        bridge.nudge()
        XCTAssertTrue(gate.waitUntilEntered())

        bridge.makeContext = {
            MountBridge.Context(api: secondAPI, handle: "second", workspaceName: "Second")
        }
        let switched = passExpectation(bridge)
        bridge.nudge()
        XCTAssertTrue(waitUntil { bridge.testingState().generation > originalGeneration })
        gate.release()
        wait(for: [switched], timeout: 2)

        XCTAssertEqual(firstAPI.patchTitles(), [])
        XCTAssertEqual(firstAPI.putBodies(), [])
        XCTAssertEqual(firstAPI.renamedFolders(), [])
        XCTAssertEqual(provider.evictedIdentifiers(), [])
    }

    func testStopAndRestartCancelBlockedGenerationBeforeMutation() throws {
        let fixture = try makeFixture()
        let firstAPI = MountBridgeAPI(text: fixture.initialText)
        let secondAPI = MountBridgeAPI(text: fixture.initialText)
        let provider = MountBridgeProvider()
        let bridge = makeBridge(api: firstAPI)
        defer { bridge.stop() }
        waitForPass(bridge) { bridge.start(mountRoot: fixture.root, provider: provider.operations) }
        let originalGeneration = bridge.testingState().generation

        let renamed = fixture.folder.appendingPathComponent("Local Title.md")
        try FileManager.default.moveItem(at: fixture.file, to: renamed)
        let gate = MountBridgeGate()
        firstAPI.setFileTextGate(gate)
        bridge.nudge()
        XCTAssertTrue(gate.waitUntilEntered())

        bridge.stop()
        XCTAssertTrue(waitUntil { bridge.testingState().generation > originalGeneration })
        bridge.makeContext = {
            MountBridge.Context(api: secondAPI, handle: "demo", workspaceName: "Demo")
        }
        let restarted = passExpectation(bridge)
        bridge.start(mountRoot: fixture.root, provider: provider.operations)
        gate.release()
        wait(for: [restarted], timeout: 2)

        XCTAssertEqual(firstAPI.patchTitles(), [])
        XCTAssertEqual(firstAPI.putBodies(), [])
        XCTAssertEqual(firstAPI.renamedFolders(), [])
        XCTAssertEqual(provider.evictedIdentifiers(), [])
    }

    func testLocalEditEscapesPendingPullAfterRetryExhaustion() throws {
        let fixture = try makeFixture()
        let api = MountBridgeAPI(text: fixture.initialText)
        let provider = MountBridgeProvider()
        let bridge = makeBridge(api: api)
        defer { bridge.stop() }
        waitForPass(bridge) { bridge.start(mountRoot: fixture.root, provider: provider.operations) }

        api.setText(markdown(body: "remote edit", revision: 2), hash: "h2")
        waitForPass(bridge) { bridge.nudge() }
        XCTAssertEqual(provider.evictedIdentifiers().count, 1)
        XCTAssertEqual(bridge.testingState().pendingPullCount, 1)

        waitForPass(bridge) { bridge.nudge() }
        XCTAssertEqual(bridge.testingState().pendingPullCount, 1)

        let local = markdown(body: "local edit after failed pull", revision: 1)
        try local.write(to: fixture.file, atomically: true, encoding: .utf8)
        waitForPass(bridge) { bridge.nudge() }

        XCTAssertEqual(bridge.testingState().pendingPullCount, 0)
        XCTAssertEqual(provider.evictedIdentifiers().count, 1)
        XCTAssertEqual(api.putBodies(), [])
        XCTAssertEqual(try String(contentsOf: fixture.file, encoding: .utf8), local)
    }

    private struct Fixture {
        let root: URL
        let folder: URL
        let file: URL
        let initialText: String
    }

    private func makeFixture() throws -> Fixture {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("MountBridgeTests-\(UUID().uuidString)", isDirectory: true)
        let folder = root.appendingPathComponent("Folder", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("Title.md")
        let text = markdown(body: "base body", revision: 1)
        try text.write(to: file, atomically: true, encoding: .utf8)
        temporaryDirectories.append(root)
        return Fixture(root: root, folder: folder, file: file, initialText: text)
    }

    private func makeBridge(
        api: MountBridgeAPI, handle: String = "demo"
    ) -> MountBridge {
        let bridge = MountBridge()
        bridge.watchesFileSystem = false
        bridge.debounceDelay = 0
        bridge.retryLimit = 0
        bridge.retryBaseDelay = 0
        bridge.providerIdentifierResolver = { _ in nil }
        bridge.makeContext = {
            MountBridge.Context(api: api, handle: handle, workspaceName: "Demo")
        }
        return bridge
    }

    private func passExpectation(_ bridge: MountBridge) -> XCTestExpectation {
        let expectation = expectation(description: "MountBridge pass")
        bridge.onPassFinished = { [weak bridge] _ in
            bridge?.onPassFinished = nil
            expectation.fulfill()
        }
        return expectation
    }

    private func waitForPass(
        _ bridge: MountBridge, timeout: TimeInterval = 2, _ action: () -> Void
    ) {
        let pass = passExpectation(bridge)
        action()
        wait(for: [pass], timeout: timeout)
    }

    private func waitUntil(
        timeout: TimeInterval = 2, condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        return condition()
    }
}

private func markdown(title: String = "Title", body: String, revision: Int) -> String {
    """
    ---
    title: "\(title)"
    slug: "post"
    syncRevision: \(revision)
    ---

    \(body)
    """
}

private final class MountBridgeGate: @unchecked Sendable {
    private let entered = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?
    private var wasReleased = false

    func pause() async {
        entered.signal()
        await withCheckedContinuation { continuation in
            lock.lock()
            if wasReleased {
                lock.unlock()
                continuation.resume()
            } else {
                self.continuation = continuation
                lock.unlock()
            }
        }
    }

    func waitUntilEntered(timeout: TimeInterval = 2) -> Bool {
        entered.wait(timeout: .now() + timeout) == .success
    }

    func release() {
        lock.lock()
        wasReleased = true
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume()
    }
}

private final class MountBridgeProvider: @unchecked Sendable {
    private let lock = NSLock()
    private var evictions: [NSFileProviderItemIdentifier] = []
    private var signals: [NSFileProviderItemIdentifier] = []

    lazy var operations = MountBridge.ProviderOperations(
        evictItem: { [weak self] identifier, completion in
            self?.withLock { self?.evictions.append(identifier) }
            completion(nil)
        },
        signalEnumerator: { [weak self] identifier, completion in
            self?.withLock { self?.signals.append(identifier) }
            completion(nil)
        })

    func evictedIdentifiers() -> [NSFileProviderItemIdentifier] {
        withLock { evictions }
    }

    func signalledIdentifiers() -> [NSFileProviderItemIdentifier] {
        withLock { signals }
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}

private final class MountBridgeAPI: WriteSyncAPI, @unchecked Sendable {
    private let lock = NSLock()
    private let handle: String
    private var folderName = "Folder"
    private var title = "Title"
    private var text: String
    private var hash = "h1"
    private var gate: MountBridgeGate?
    private var patchTitleCalls: [String] = []
    private var putBodyCalls: [String] = []
    private var renameFolderCalls: [String] = []

    init(handle: String = "demo", text: String) {
        self.handle = handle
        self.text = text
    }

    func setText(_ text: String, hash: String) {
        withLock {
            self.text = text
            self.hash = hash
        }
    }

    func setFolderName(_ name: String) {
        withLock { folderName = name }
    }

    func setFileTextGate(_ gate: MountBridgeGate?) {
        withLock { self.gate = gate }
    }

    func patchTitles() -> [String] { withLock { patchTitleCalls } }
    func putBodies() -> [String] { withLock { putBodyCalls } }
    func renamedFolders() -> [String] { withLock { renameFolderCalls } }

    func workspace() async -> Result<WriteWorkspace, WriteSyncError> {
        .success(withLock {
            WriteWorkspace(
                blog: WriteWorkspaceBlog(handle: handle, name: "Demo", username: handle),
                folders: [WriteWorkspaceFolder(
                    id: "folder", name: folderName, path: folderName,
                    mode: "blog", parentId: nil)])
        })
    }

    func manifest(folderId: String) async -> Result<[WriteManifestItem], WriteSyncError> {
        .success([withLock { item() }])
    }

    func fileText(postId: String) async -> Result<WriteFileContent, WriteSyncError> {
        let currentGate = withLock { gate }
        if let currentGate { await currentGate.pause() }
        return .success(withLock { WriteFileContent(text: text, hash: hash) })
    }

    func changes(
        since cursor: String?, wait: Int
    ) async -> Result<WriteChangeReply, WriteSyncError> {
        .success(WriteChangeReply(cursor: "cursor", changed: false))
    }

    func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .failure(.rejected("unused"))
    }

    func putFile(
        postId: String, body: String, ifMatch: String
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .success(withLock {
            putBodyCalls.append(body)
            text = body
            hash += "p"
            return item()
        })
    }

    func patchFile(
        postId: String, folderId: String?, slug: String?, title: String?, ifMatch: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .success(withLock {
            if let title {
                patchTitleCalls.append(title)
                self.title = title
                text = MountFrontmatter.setTitle(text, title)
            }
            hash += "m"
            return item()
        })
    }

    func deleteFile(
        postId: String, ifMatch: String?
    ) async -> Result<Void, WriteSyncError> {
        .success(())
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        .failure(.rejected("unused"))
    }

    func renameFolder(
        folderId: String, name: String
    ) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        .success(withLock {
            renameFolderCalls.append(name)
            folderName = name
            return WriteWorkspaceFolder(
                id: "folder", name: name, path: name, mode: "blog", parentId: nil)
        })
    }

    func renameWorkspace(name: String) async -> Result<WriteWorkspaceBlog, WriteSyncError> {
        .failure(.rejected("unused"))
    }

    private func item() -> WriteManifestItem {
        WriteManifestItem(
            file: "post.md", kind: "article", slug: "post", title: title,
            status: "draft", hash: hash, id: "post-id", date: nil,
            createdAt: "2026-07-01T00:00:00Z",
            updatedAt: "2026-07-13T00:00:00Z", url: nil)
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}
