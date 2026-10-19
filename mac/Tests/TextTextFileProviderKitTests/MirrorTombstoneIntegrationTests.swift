import TextTextSyncTestSupport
import XCTest
import ZIPFoundation
@testable import TextTextFileProviderKit

/// Real native engine/storage fixtures. The transport supplies controlled
/// remote observations; these tests do not claim authenticated physical sync.
final class MirrorTombstoneIntegrationTests: XCTestCase {
    func testSerializedTombstoneVectors() async throws {
        struct Vector: Decodable { let name: String, observed: LocalVaultMirrorTombstoneObservation, decision: LocalVaultMirrorTombstoneDecision }
        var root = URL(fileURLWithPath: #filePath); for _ in 0..<4 { root.deleteLastPathComponent() }
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: root.appendingPathComponent("sync/fixtures/mirror-tombstone.json")))
        for vector in vectors { let actual = try await makeTestMirrorPolicy(workspaceId: "tombstone-vectors").tombstone(vector.observed); XCTAssertEqual(actual, vector.decision, vector.name) }
    }
    func testTombstoneReplyRejectsFutureAndForgedFields() async throws {
        let scope = LocalVaultMirrorScope(accountId: "account", workspaceId: "workspace", lifecycle: "connection")
        let observed = LocalVaultMirrorTombstoneObservation(remotePresent: true, remoteDeleted: true, remoteAuthoritative: true, editorOwned: false, recoveryBlocked: false, localPresent: true, localUnique: true, localIdentityVerified: true, localHash: String(repeating: "a", count: 64), baselineHash: String(repeating: "a", count: 64), localPath: "a.textpack", baselinePath: "a.textpack", remotePath: "a.textpack", baselineRevision: "r", remoteRevision: "r", localLifecycle: "g", remoteLifecycle: "g")
        for altered in ["scope", "requestId", "unknown", "unknown-observed", "missing-lifecycle", "action"] {
            let policy = LocalVaultMirrorPolicy(digest: String(repeating: "f", count: 64), scope: scope) { script in
                let header: [String: Any] = ["version": 1, "digest": String(repeating: "f", count: 64), "pageId": "page", "generation": 1]
                if script.contains(".handshake(") { return String(decoding: try JSONSerialization.data(withJSONObject: header), as: UTF8.self) }
                if script.contains(".bind(") { return String(decoding: try JSONSerialization.data(withJSONObject: header.merging(["scope": ["accountId": "account", "workspaceId": "workspace", "lifecycle": "connection"]]) { _, next in next }), as: UTF8.self) }
                let start = try XCTUnwrap(script.firstIndex(of: "("))
                var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(script[script.index(after: start)..<script.index(before: script.endIndex)].utf8)) as? [String: Any])
                value["decision"] = ["action": "defer"]
                if altered == "scope" { value["scope"] = ["accountId": "foreign", "workspaceId": "workspace", "lifecycle": "connection"] }
                if altered == "requestId" { value["requestId"] = "foreign" }
                if altered == "unknown" { value["future"] = true }
                if altered == "action" { value["decision"] = ["action": "future"] }
                if altered == "unknown-observed" || altered == "missing-lifecycle" {
                    var observed = try XCTUnwrap(value["observed"] as? [String: Any])
                    if altered == "unknown-observed" { observed["future"] = true } else { observed.removeValue(forKey: "localLifecycle") }
                    value["observed"] = observed
                }
                return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
            }
            do { _ = try await policy.tombstone(observed); XCTFail("Accepted \(altered)") } catch { }
        }
    }
    private let id = "b1111111-1111-4111-8111-111111111111"
    private let path = "Notes/Tombstone.textpack"
    func testStaleTombstoneRevisionPreservesProjectionAcrossRestart() async throws { try await scenario("revision", expectedRemoval: false) }
    func testMovedTombstonePreservesProjectionAcrossRestart() async throws { try await scenario("path", expectedRemoval: false) }
    func testUnknownGenerationCannotRemoveProjection() async throws { try await scenario("unknown", expectedRemoval: false) }
    func testChangedGenerationCannotRemoveProjection() async throws { try await scenario("generation", expectedRemoval: false) }
    func testExactKnownGenerationTombstoneRemovesOnlyProjection() async throws { try await scenario("exact", expectedRemoval: true) }

    func testReachablePolicyAwaitChangesPreserveJournalAndDoNotRemove() async throws {
        for mode in ["hash", "duplicate", "restore", "authority", "editor", "checkpoint"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("tombstone-race-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let bytes = try pack(root: root, generation: "generation-a")
            let changed = try pack(root: root, generation: "generation-a", body: "Changed during policy await")
            let remote = TombstoneFixtureTransport(itemId: id, path: path, bytes: bytes, generation: "generation-a")
            let mutation = TombstoneAwaitMutation(root: root, path: path, id: id, original: bytes, changed: changed, remote: remote, mode: mode)
            let sync = try LocalVaultSync(root: root, binding: .init(origin: URL(string: "https://tombstone.test")!, workspaceId: "tombstone-fixture"), transport: remote,
                mirrorPolicy: makeTestMirrorPolicy(workspaceId: "tombstone-fixture", beforeRequest: { script in try await mutation.run(script) }))
            await mutation.attach(sync)
            _ = try await sync.sync()
            let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
            let before = try targetedState(stateURL)
            await remote.trash(path: path, revision: TextTextStableDigest.sha256Hex(bytes), generation: "generation-a")
            do { _ = try await sync.sync() } catch LocalVaultSyncFailure.httpStatus(403) { }
            let ran = await mutation.ran; XCTAssertTrue(ran, mode)
            XCTAssertEqual(try targetedState(stateURL), before, "Stale policy cannot clear baseline/outbox/conflict: \(mode)")
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), mode == "hash" ? changed : bytes, mode)
            let count = await remote.mutationCount; XCTAssertEqual(count, 0, mode)
            await mutation.close()
        }
    }
    func testReadOnlyProtectionRejectsUnknownRetainedCheckpointWithoutRewriting() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tombstone-invalid-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/" + id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("checkpoint.json")
        for bytes in [Data("{\"version\":99}".utf8), Data("not-json".utf8)] {
            try bytes.write(to: url)
            XCTAssertThrowsError(try LocalVaultSharedEditingStore(root: root).protectionSnapshot(itemId: id))
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
    }
    func testNoLocalAndBlockedTombstonesPreserveRetainedMetadata() async throws {
        for mode in ["baseline", "pending-intent", "conflict", "closed-checkpoint"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("tombstone-absent-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let original = try pack(root: root, generation: "generation-a")
            let remote = TombstoneFixtureTransport(itemId: id, path: path, bytes: original, generation: "generation-a")
            let sync = try makeTestSync(root: root, binding: .init(origin: URL(string: "https://tombstone.test")!, workspaceId: "tombstone-fixture"), transport: remote)
            _ = try await sync.sync()
            if mode == "pending-intent" {
                try pack(root: root, generation: "generation-a", body: "Actual pending bytes").write(to: root.appendingPathComponent(path))
                await remote.failOneUpload(); _ = try await sync.sync(); await remote.setWritable(false)
                let file = try LocalVaultDocumentStore(root: root).read(path: path)
                try LocalVaultDocumentStore(root: root).removeRetaining(path: path, expectedHash: file.hash, recordDeletion: true)
            } else if mode == "conflict" {
                try pack(root: root, generation: "generation-a", body: "Retained conflict bytes").write(to: root.appendingPathComponent(path))
                await remote.trash(path: path, revision: TextTextStableDigest.sha256Hex(original), generation: "generation-a")
                _ = try await sync.sync()
            } else if mode == "closed-checkpoint" {
                let file = try LocalVaultDocumentStore(root: root).read(path: path)
                let journal = String(decoding: try JSONSerialization.data(withJSONObject: ["version": 1, "epoch": 1, "seq": 0, "journalGeneration": 1, "revision": file.hash, "relativePath": path, "update": "AAA=", "pending": []]), as: UTF8.self)
                _ = try LocalVaultSharedEditingStore(root: root).materialize(checkpoint: .init(itemId: id, path: path, projectedHash: file.hash, acknowledgedRevision: file.hash, epoch: 1, seq: 0, journalGeneration: 1, journal: journal, pending: false), expectedHash: file.hash, markdown: file.contents.markdown, documentJSON: try XCTUnwrap(file.contents.documentJSON))
            }
            if FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path) { try FileManager.default.removeItem(at: root.appendingPathComponent(path)) }
            await remote.trash(path: path, revision: TextTextStableDigest.sha256Hex(original), generation: "generation-a")
            let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
            let before = try targetedState(stateURL)
            let intent = try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: id)
            let shared = LocalVaultSharedEditingStore(root: root), protection = try shared.protectionSnapshot(itemId: id)
            _ = try await sync.sync()
            XCTAssertEqual(try targetedState(stateURL), before, mode)
            XCTAssertEqual(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: id), intent, mode)
            XCTAssertEqual(try shared.protectionSnapshot(itemId: id), protection, mode)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path), mode)
        }
    }
    private func targetedState(_ file: URL) throws -> Data {
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        return try JSONSerialization.data(withJSONObject: Dictionary(uniqueKeysWithValues: ["baselines", "outbox", "conflicts", "lifecycles"].map { ($0, value[$0] ?? NSNull()) }), options: [.sortedKeys])
    }

    private func scenario(_ kind: String, expectedRemoval: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-tombstone-\(kind)-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let generation: String? = kind == "unknown" ? nil : "generation-a"
        let original = try pack(root: root, generation: generation)
        let remote = TombstoneFixtureTransport(itemId: id, path: path, bytes: original, generation: generation)
        func engine() throws -> LocalVaultSync {
            try makeTestSync(root: root, binding: .init(origin: URL(string: "https://tombstone.test")!, workspaceId: "tombstone-fixture"), transport: remote)
        }
        let first = try engine(); let seeded = try await first.sync()
        XCTAssertTrue(seeded.errors.isEmpty)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), original)
        let revision = TextTextStableDigest.sha256Hex(original)
        await remote.trash(path: kind == "path" ? "Moved/Tombstone.textpack" : path,
                           revision: kind == "revision" ? String(repeating: "b", count: 64) : revision,
                           generation: kind == "generation" ? "generation-b" : generation)
        _ = try await first.sync()
        let exists = FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path)
        XCTAssertEqual(exists, !expectedRemoval, "\(kind): portable tombstone disposition")
        if exists { XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), original) }
        XCTAssertTrue(try containsExactPack(root, original), "Exact original bytes remain in projection or native retained history")
        let mutations = await remote.mutationCount
        _ = try await engine().sync()
        XCTAssertEqual(FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path), !expectedRemoval, "Restart must preserve the same disposition")
        XCTAssertTrue(try containsExactPack(root, original))
        let after = await remote.mutationCount
        XCTAssertEqual(after, mutations, "Tombstone consumption must not upload or resurrect content")
    }
    private func containsExactPack(_ root: URL, _ bytes: Data) throws -> Bool {
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else { return false }
        for case let file as URL in files where file.pathExtension == "textpack" {
            if try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true,
               (try? Data(contentsOf: file)) == bytes { return true }
        }
        return false
    }
    private func pack(root: URL, generation: String?, body: String = "Exact original bytes") throws -> Data {
        let temporary = root.appendingPathComponent(".fixture")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let document = try BuiltinTextPackDocument.create(title: "Tombstone", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Tombstone\n---\n\n\(body)", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: temporary)
        let data = try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: temporary))
        guard let generation else { return data }
        let archive = try Archive(data: data, accessMode: .update)
        let marker = try JSONSerialization.data(withJSONObject: ["version": 1, "generation": generation])
        try archive.addEntry(with: "texttext-lifecycle.json", type: .file, uncompressedSize: Int64(marker.count)) { position, size in marker.subdata(in: Int(position)..<Int(position) + size) }
        return try XCTUnwrap(archive.data)
    }
}
private actor TombstoneFixtureTransport: LocalVaultSyncTransport {
    let itemId: String; var item: LocalVaultRemoteItem; let bytes: Data
    private(set) var mutationCount = 0
    private var denyManifest = false, writable = true, failUpload = false
    func setWritable(_ value: Bool) { writable = value }
    func canWrite(itemId: String, path: String, existing: Bool) -> Bool { writable }
    func failOneUpload() { failUpload = true }
    func denyAuthority() { denyManifest = true }
    func restore() { item = .init(itemId: itemId, relativePath: item.relativePath, revision: item.revision, lifecycle: "generation-b") }
    init(itemId: String, path: String, bytes: Data, generation: String?) {
        self.itemId = itemId; self.bytes = bytes
        item = .init(itemId: itemId, relativePath: path, revision: TextTextStableDigest.sha256Hex(bytes), lifecycle: generation)
    }
    func trash(path: String, revision: String, generation: String?) { item = .init(itemId: itemId, relativePath: path, revision: revision, deleted: true, lifecycle: generation) }
    func manifest() throws -> [LocalVaultRemoteItem] { if denyManifest { throw LocalVaultSyncFailure.httpStatus(403) }; return [item] }
    func download(itemId: String) throws -> LocalVaultRemotePack {
        guard itemId == self.itemId, !item.isDeleted else { throw LocalVaultSyncFailure.invalidResponse }
        return .init(data: bytes, relativePath: item.relativePath, revision: item.revision)
    }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) throws -> String { mutationCount += 1; if failUpload { failUpload = false; throw URLError(.notConnectedToInternet) }; throw LocalVaultSyncFailure.conflict }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String { mutationCount += 1; throw LocalVaultSyncFailure.conflict }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) throws { mutationCount += 1; throw LocalVaultSyncFailure.conflict }
}

private actor TombstoneAwaitMutation {
    let root: URL, path: String, id: String, original: Data, changed: Data, remote: TombstoneFixtureTransport, mode: String
    var sync: LocalVaultSync?, session: LocalVaultSharedSession?
    private(set) var ran = false
    init(root: URL, path: String, id: String, original: Data, changed: Data, remote: TombstoneFixtureTransport, mode: String) {
        self.root = root; self.path = path; self.id = id; self.original = original; self.changed = changed; self.remote = remote; self.mode = mode
    }
    func attach(_ value: LocalVaultSync) { sync = value }
    func run(_ script: String) async throws {
        guard script.contains(".tombstone("), !ran else { return }; ran = true
        if mode == "hash" { try changed.write(to: root.appendingPathComponent(path)) }
        if mode == "duplicate" { try original.write(to: root.appendingPathComponent("Duplicate.textpack")) }
        if mode == "restore" { await remote.restore() }
        if mode == "authority" { await remote.denyAuthority() }
        if mode == "checkpoint" {
            let file = try LocalVaultDocumentStore(root: root).read(path: path)
            let journal = String(decoding: try JSONSerialization.data(withJSONObject: ["version": 1, "epoch": 1, "seq": 0, "journalGeneration": 1, "revision": file.hash, "relativePath": path, "update": "AAA=", "pending": []]), as: UTF8.self)
            _ = try LocalVaultSharedEditingStore(root: root).materialize(checkpoint: .init(itemId: id, path: path, projectedHash: file.hash, acknowledgedRevision: file.hash, epoch: 1, seq: 0, journalGeneration: 1, journal: journal, pending: false), expectedHash: file.hash, markdown: file.contents.markdown, documentJSON: try XCTUnwrap(file.contents.documentJSON))
        }
        if mode == "editor", let sync { session = try await sync.beginSharedEditing(itemId: id, path: path, expectedHash: TextTextStableDigest.sha256Hex(original)) }
    }
    func close() async { if let session, let sync { try? await sync.endSharedEditing(sessionToken: session.sessionToken, itemId: id) } }
}
