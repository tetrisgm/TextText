import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultSyncTests: XCTestCase {
    private var root: URL!
    private let itemId = "e1111111-1111-4111-8111-111111111111"
    private let path = "Notes/Note.textpack"
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    private func pack(_ body: String) throws -> Data {
        let temporary = root.appendingPathComponent(".fixture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: \"Note\"\n---\n\n\(body)",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON,
            assets: [], sourceURL: nil, in: temporary)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: temporary))
    }
    private func putLocal(_ data: Data) throws {
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
    private func engine(_ transport: FakeVaultTransport) throws -> LocalVaultSync {
        try LocalVaultSync(root: root,
            binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace"),
            transport: transport)
    }

    func testUploadThenIdlePassDoesNotUploadOrDownloadAgain() async throws {
        let bytes = try pack("First")
        try putLocal(bytes)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        let first = try await sync.sync()
        XCTAssertEqual(first.uploaded, 1)
        XCTAssertTrue(first.errors.isEmpty)
        let second = try await sync.sync()
        XCTAssertEqual(second.uploaded, 0)
        XCTAssertEqual(second.downloaded, 0)
        let counts = await transport.counts()
        XCTAssertEqual(counts.upload, 1)
        XCTAssertEqual(counts.download, 0)
    }

    func testLostReplyReusesDurableOperationAfterRestart() async throws {
        try putLocal(pack("First"))
        let transport = FakeVaultTransport()
        await transport.loseNextReply()
        let first = try await engine(transport).sync()
        XCTAssertEqual(first.errors.count, 1)
        let second = try await engine(transport).sync()
        XCTAssertTrue(second.errors.isEmpty)
        let operations = await transport.operations()
        XCTAssertEqual(operations.count, 2)
        XCTAssertEqual(operations[0], operations[1])
        let state = try String(contentsOf: root.appendingPathComponent(".texttext/sync/state.json"), encoding: .utf8)
        XCTAssertFalse(state.contains("token"))
        XCTAssertFalse(state.contains("Bearer"))
    }

    func testRemoteOnlyChangeDownloadsAndPreservesPriorPack() async throws {
        let first = try pack("Remote first")
        let second = try pack("Remote second")
        let transport = FakeVaultTransport()
        await transport.set(itemId: itemId, path: path, data: first)
        let sync = try engine(transport)
        let initial = try await sync.sync()
        XCTAssertEqual(initial.downloaded, 1)
        await transport.set(itemId: itemId, path: path, data: second)
        let changed = try await sync.sync()
        XCTAssertEqual(changed.downloaded, 1)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), second)
        let history = root.appendingPathComponent(".texttext/history/\(TextTextStableDigest.sha256Hex(first)).textpack")
        XCTAssertEqual(try Data(contentsOf: history), first)
    }

    func testConflictKeepsBothPacksAndDoesNotRepeatUpload() async throws {
        let initial = try pack("Initial")
        let local = try pack("Local branch")
        let remote = try pack("Remote branch")
        try putLocal(initial)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(local)
        await transport.set(itemId: itemId, path: path, data: remote)
        let conflict = try await sync.sync()
        XCTAssertEqual(conflict.conflicts.count, 2)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), local)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(conflict.conflicts[0])), local)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(conflict.conflicts[1])), remote)
        let prior = await transport.counts()
        _ = try await sync.sync()
        let after = await transport.counts()
        XCTAssertEqual(prior.upload, after.upload)
    }

    func testServerMergeReplacesOnlyTheUploadedLocalRevision() async throws {
        try putLocal(pack("Original"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(pack("Local edit"))
        let merged = try pack("Local edit plus web edit")
        await transport.mergeNextUpload(with: merged)
        let report = try await sync.sync()
        XCTAssertEqual(report.uploaded, 1)
        XCTAssertTrue(report.errors.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), merged)
    }

    func testLocalRenameAndDeletionReachServer() async throws {
        try putLocal(pack("Initial"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        let renamed = "Notes/Renamed.textpack"
        try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(renamed))
        let renameReport = try await sync.sync()
        XCTAssertTrue(renameReport.errors.isEmpty)
        XCTAssertTrue(renameReport.conflicts.isEmpty)
        let moved = try await transport.download(itemId: itemId)
        XCTAssertEqual(moved.relativePath, renamed)
        try FileManager.default.removeItem(at: root.appendingPathComponent(renamed))
        let deleteReport = try await sync.sync()
        XCTAssertTrue(deleteReport.errors.isEmpty)
        let manifest = await transport.manifest()
        XCTAssertTrue(manifest.first?.isDeleted == true)
    }

    func testRemoteRenameAndDeletionPreserveHistory() async throws {
        let bytes = try pack("Initial")
        try putLocal(bytes)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        let renamed = "Moved/Note.textpack"
        let revision = TextTextStableDigest.sha256Hex(bytes)
        _ = try await transport.rename(itemId: itemId, from: path, to: renamed,
            baseRevision: revision, operationId: UUID().uuidString)
        let moved = try await sync.sync()
        XCTAssertTrue(moved.errors.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(renamed)), bytes)
        try await transport.delete(itemId: itemId, path: renamed, baseRevision: revision, operationId: UUID().uuidString)
        _ = try await sync.sync()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(renamed).path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(".texttext/history/" + revision + ".textpack")), bytes)
    }

    func testRemoteDeletionCannotEraseAnOfflineEdit() async throws {
        let original = try pack("Initial")
        let edited = try pack("Offline edit")
        try putLocal(original)
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try putLocal(edited)
        try await transport.delete(itemId: itemId, path: path,
            baseRevision: TextTextStableDigest.sha256Hex(original), operationId: UUID().uuidString)
        let conflict = try await sync.sync()
        XCTAssertTrue(conflict.errors.isEmpty)
        XCTAssertFalse(conflict.conflicts.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), edited)
    }

    func testLocalDeletionCannotEraseConcurrentWebEdit() async throws {
        try putLocal(pack("Initial"))
        let transport = FakeVaultTransport()
        let sync = try engine(transport)
        _ = try await sync.sync()
        try FileManager.default.removeItem(at: root.appendingPathComponent(path))
        let web = try pack("Web edit")
        await transport.set(itemId: itemId, path: path, data: web)
        let conflict = try await sync.sync()
        XCTAssertTrue(conflict.errors.isEmpty)
        XCTAssertFalse(conflict.conflicts.isEmpty)
        let retained = try await transport.download(itemId: itemId)
        XCTAssertEqual(retained.data, web)
    }

    func testBindingCannotSilentlyChangeWorkspace() async throws {
        _ = try engine(FakeVaultTransport())
        XCTAssertThrowsError(try LocalVaultSync(root: root,
            binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "other"),
            transport: FakeVaultTransport()))
    }
}

private actor FakeVaultTransport: LocalVaultSyncTransport {
    private var items: [String: LocalVaultRemotePack] = [:]
    private var receipts: [String: String] = [:]
    private var tombstones: [String: LocalVaultRemoteItem] = [:]
    private var uploadedOperations: [String] = []
    private var downloads = 0
    private var loseReply = false
    private var merged: Data?
    func set(itemId: String, path: String, data: Data) {
        items[itemId] = .init(data: data, relativePath: path, revision: TextTextStableDigest.sha256Hex(data))
    }
    func loseNextReply() { loseReply = true }
    func mergeNextUpload(with data: Data) { merged = data }
    func operations() -> [String] { uploadedOperations }
    func counts() -> (upload: Int, download: Int) { (uploadedOperations.count, downloads) }
    func manifest() -> [LocalVaultRemoteItem] {
        items.map { .init(itemId: $0.key, relativePath: $0.value.relativePath, revision: $0.value.revision) } + Array(tombstones.values)
    }
    func download(itemId: String) throws -> LocalVaultRemotePack {
        downloads += 1
        guard let item = items[itemId] else { throw LocalVaultSyncFailure.invalidResponse }
        return item
    }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String) throws -> String {
        uploadedOperations.append(operationId)
        if let receipt = receipts[operationId] { return receipt }
        if let merged {
            self.merged = nil
            set(itemId: itemId, path: path, data: merged)
        } else {
            guard tombstones[itemId] == nil, items[itemId]?.revision == baseRevision else { throw LocalVaultSyncFailure.conflict }
            set(itemId: itemId, path: path, data: data)
        }
        let revision = items[itemId]!.revision
        receipts[operationId] = revision
        if loseReply { loseReply = false; throw URLError(.networkConnectionLost) }
        return revision
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String {
        uploadedOperations.append(operationId)
        if let receipt = receipts[operationId] { return receipt }
        guard let item = items[itemId], item.revision == baseRevision, item.relativePath == from,
              !items.values.contains(where: { $0.relativePath == to }) else { throw LocalVaultSyncFailure.conflict }
        items[itemId] = .init(data: item.data, relativePath: to, revision: item.revision)
        receipts[operationId] = item.revision
        return item.revision
    }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) throws {
        uploadedOperations.append(operationId)
        if receipts[operationId] != nil { return }
        guard let item = items[itemId], item.revision == baseRevision, item.relativePath == path else { throw LocalVaultSyncFailure.conflict }
        items.removeValue(forKey: itemId)
        tombstones[itemId] = .init(itemId: itemId, relativePath: path, revision: baseRevision, deleted: true)
        receipts[operationId] = baseRevision
    }

}
