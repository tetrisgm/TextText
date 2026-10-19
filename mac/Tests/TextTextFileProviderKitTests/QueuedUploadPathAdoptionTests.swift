import TextTextSyncTestSupport
import TextTextWorkspaceCore
import XCTest
import ZIPFoundation
@testable import TextTextFileProviderKit

/// Actual private native staging with an explicitly scoped controlled transport.
final class QueuedUploadPathAdoptionTests: XCTestCase {
    private var root: URL!, device: URL!, priorBase: URL?
    private let id = "c1111111-1111-4111-8111-111111111111"
    private let source = "Original.textpack", destination = "Moved.textpack"
    private var binding: LocalVaultSyncBinding { get throws { try .init(origin: URL(string: "https://queued.test")!, workspaceId: "queued-fixture") } }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("queued-path-" + UUID().uuidString)
        device = FileManager.default.temporaryDirectory.appendingPathComponent("queued-device-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        priorBase = LocalVaultDeviceState.exchangeConfiguredBase(device)
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
    }
    override func tearDownWithError() throws {
        _ = LocalVaultDeviceState.exchangeConfiguredBase(priorBase)
        try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: device)
    }
    private func pack(_ body: String, generation: String?) throws -> Data {
        let scratch = root.appendingPathComponent(".fixture-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Queued", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Queued\n---\n\n\(body)", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        let bytes = try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
        guard let generation else { return bytes }
        let archive = try Archive(data: bytes, accessMode: .update)
        let marker = try JSONSerialization.data(withJSONObject: ["version": 1, "generation": generation], options: [.sortedKeys])
        try archive.addEntry(with: "texttext-lifecycle.json", type: .file, uncompressedSize: Int64(marker.count)) { position, size in marker.subdata(in: Int(position)..<Int(position) + size) }
        return try XCTUnwrap(archive.data)
    }
    private func engine(_ transport: QueuedPathTransport, gate: QueuedPolicyGate) throws -> LocalVaultSync {
        try LocalVaultSync(root: root, binding: binding, transport: transport, accountId: "account-a",
            mirrorPolicy: makeTestMirrorPolicy(workspaceId: "queued-fixture", accountId: "account-a", beforeRequest: { script in try await gate.run(script) }))
    }
    private func prepared(generation: String? = "generation-a") async throws -> (LocalVaultSync, QueuedPathTransport, QueuedPolicyGate, Data) {
        let original = try pack("Initial", generation: generation), changed = try pack("Pending exact bytes", generation: generation)
        let transport = QueuedPathTransport(id: id, path: source, data: original, generation: generation), gate = QueuedPolicyGate()
        let sync = try engine(transport, gate: gate)
        let initial = try await sync.sync(); XCTAssertTrue(initial.errors.isEmpty)
        try changed.write(to: root.appendingPathComponent(source))
        _ = try await sync.sync()
        XCTAssertEqual(try pending()["hash"] as? String, TextTextStableDigest.sha256Hex(changed))
        return (sync, transport, gate, changed)
    }
    private func pending() throws -> [String: Any] {
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json"))) as? [String: Any])
        return try XCTUnwrap((state["outbox"] as? [String: [String: Any]])?[id])
    }
    private static func snapshot(root: URL, device: URL, id: String) throws -> [String: Data] {
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: device.appendingPathComponent("sync/state.json"))) as! [String: Any]
        var target: [String: Any] = [:]
        for key in ["outbox", "baselines", "lifecycles", "conflicts", "binaryOutbox", "binaryBaselines", "binaryRevisions", "sharedRenames", "sharedDownloads"] { target[key] = (raw[key] as? [String: Any])?[id] ?? NSNull() }
        for key in ["binding", "accountId", "folderCaseCommand"] { target[key] = raw[key] ?? NSNull() }
        var result = ["targetState": try JSONSerialization.data(withJSONObject: target, options: [.sortedKeys])]
        let pending = (raw["outbox"] as? [String: [String: Any]])?[id]
        if let operation = pending?["operationId"] as? String {
            result["stagedPayload"] = try Data(contentsOf: device.appendingPathComponent("sync/outbox/\(operation).textpack"))
        }
        let outbox = device.appendingPathComponent("sync/outbox")
        result["payloadNames"] = try JSONSerialization.data(withJSONObject: (try? FileManager.default.contentsOfDirectory(atPath: outbox.path).sorted()) ?? [], options: [.sortedKeys])
        for name in ["Original.textpack", "Moved.textpack", "Extra.textpack", "Third.textpack"] {
            let file = root.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: file.path) { result["local:" + name] = try Data(contentsOf: file) }
        }
        for name in ["checkpoint.json", "intent.json", "move-intent.json", "binary-intent.json", "projection.textpack", "binary-next.textpack"] {
            let file = device.appendingPathComponent("shared-editing/\(id)/\(name)")
            if FileManager.default.fileExists(atPath: file.path) { result["shared:" + name] = try Data(contentsOf: file) }
        }
        let owner = device.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        if FileManager.default.fileExists(atPath: owner.path) { result["owner"] = try Data(contentsOf: owner) }
        if let intent = try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: id) { result["deletion"] = intent }
        return result
    }
    private func retainedScenario(deletion: Bool, generation: String? = "generation-a") async throws {
        let (sync, transport, gate, changed) = try await prepared(generation: generation)
        if deletion {
            try LocalVaultDocumentStore(root: root).removeRetaining(path: source, expectedHash: TextTextStableDigest.sha256Hex(changed), recordDeletion: true)
            try changed.write(to: root.appendingPathComponent(source))
        }
        await transport.move(destination)
        let directory = LocalVaultDeviceState.directory(root: root), before = try Self.snapshot(root: root, device: directory, id: id)
        let calls = await transport.uploads
        let pass = try await sync.sync(); XCTAssertFalse(pass.hasMore)
        XCTAssertTrue(pass.errors.contains("A queued file update needs review before its path can change. Your file is kept on this device."))
        XCTAssertEqual(try Self.snapshot(root: root, device: directory, id: id), before)
        let fresh = try engine(transport, gate: gate), restarted = try await fresh.sync(); XCTAssertFalse(restarted.hasMore)
        XCTAssertEqual(try Self.snapshot(root: root, device: directory, id: id), before)
        let after = await transport.uploads; XCTAssertEqual(after, calls)
        XCTAssertEqual(before["stagedPayload"], changed)
    }
    func testDeletionIntentBlocksQueuedUploadPathAdoption() async throws { try await retainedScenario(deletion: true) }
    func testUnknownGenerationRetainsQueuedBytesAcrossRestart() async throws { try await retainedScenario(deletion: false, generation: nil) }
    private func positive(alreadyMoved: Bool) async throws {
        let (sync, transport, _, changed) = try await prepared()
        let before = try pending(), oldId = try XCTUnwrap(before["operationId"] as? String)
        if alreadyMoved { try FileManager.default.moveItem(at: root.appendingPathComponent(source), to: root.appendingPathComponent(destination)) }
        await transport.move(destination); await transport.allowUpload()
        let beforeCalls = await transport.uploads
        let result = try await sync.sync(); XCTAssertTrue(result.errors.isEmpty, "\(result.errors)")
        let calls = await transport.uploads
        XCTAssertEqual(calls.count, beforeCalls.count + 1)
        XCTAssertNotEqual(calls.last?.operationId, oldId); XCTAssertEqual(calls.last?.path, destination)
        XCTAssertEqual(calls.last?.hash, before["hash"] as? String); XCTAssertEqual(calls.last?.base, before["baseRevision"] as? String)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(source).path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(destination)), changed)
        let server = try await transport.download(itemId: id); XCTAssertEqual(server.data, changed)
    }
    func testKnownGenerationReissuesCapturedBytesAtFreshRemotePath() async throws { try await positive(alreadyMoved: false) }
    func testKnownGenerationAdoptsAlreadyMovedLocalProjection() async throws { try await positive(alreadyMoved: true) }
    func testOwnerlessKnownGenerationCannotReissue() async throws {
        let legacy = root.appendingPathComponent("UnownedRoot")
        try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        let original = try pack("Initial", generation: "generation-a"), changed = try pack("Unowned pending", generation: "generation-a")
        let transport = QueuedPathTransport(id: id, path: source, data: original, generation: "generation-a")
        let sync = try LocalVaultSync(root: legacy, binding: binding, transport: transport, mirrorPolicy: makeTestMirrorPolicy(workspaceId: "queued-fixture"))
        _ = try await sync.sync(); try changed.write(to: legacy.appendingPathComponent(source)); _ = try await sync.sync()
        await transport.move(destination); await transport.allowUpload()
        let directory = LocalVaultDeviceState.directory(root: legacy), before = try Self.snapshot(root: legacy, device: directory, id: id)
        let calls = await transport.uploads
        _ = try await sync.sync()
        XCTAssertEqual(try Self.snapshot(root: legacy, device: directory, id: id), before)
        let after = await transport.uploads; XCTAssertEqual(after, calls)
    }
    func testManifestAwaitDurableChangeAbortsBeforePolicy() async throws { try await manifestRace(unsafeProjection: false) }
    func testManifestAwaitDurableChangeAndUnreadableProjectionAbortsBeforeSetup() async throws { try await manifestRace(unsafeProjection: true) }
    private func manifestRace(unsafeProjection: Bool) async throws {
        let (sync, transport, gate, _) = try await prepared()
        await transport.move(destination)
        let directory = LocalVaultDeviceState.directory(root: root), url = directory.appendingPathComponent("sync/state.json"), itemId = id
        await transport.setManifestHook {
            var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
            var values = raw["baselines"] as! [String: [String: Any]], value = values[itemId]!
            value["revision"] = String(repeating: "f", count: 64); values[itemId] = value; raw["baselines"] = values
            try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys]).write(to: url)
            if unsafeProjection { try FileManager.default.createDirectory(at: directory.appendingPathComponent("shared-editing/\(itemId)/projection.textpack"), withIntermediateDirectories: true) }
            await gate.recordExpected(["rawState": try Data(contentsOf: url)])
        }
        let calls = await transport.uploads
        do { _ = try await sync.sync(); XCTFail("A durable race must abort the pass") } catch LocalVaultSyncFailure.changed { }
        let hits = await gate.hits; XCTAssertEqual(hits, 0)
        let expected = await gate.expected
        XCTAssertEqual(try Data(contentsOf: url), expected?["rawState"])
        if unsafeProjection { var isDirectory: ObjCBool = false; XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("shared-editing/\(itemId)/projection.textpack").path, isDirectory: &isDirectory)); XCTAssertTrue(isDirectory.boolValue) }
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(((raw["baselines"] as? [String: [String: Any]])?[id])?["revision"] as? String, String(repeating: "f", count: 64))
        let after = await transport.uploads; XCTAssertEqual(after, calls)
    }
    private func race(_ kind: String) async throws {
        let (sync, transport, gate, changed) = try await prepared()
        await transport.move(destination)
        let directory = LocalVaultDeviceState.directory(root: root), rootURL = root!, itemId = id
        let alternative = try pack("Intervening exact local content", generation: "generation-a")
        let beforeCalls = await transport.uploads
        await gate.set(failAfterAction: kind == "policy-error" || kind == "policy-error-unchanged") {
            @Sendable func changeBaseline() throws {
                let url = directory.appendingPathComponent("sync/state.json")
                var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
                var map = raw["baselines"] as! [String: [String: Any]], entry = map[itemId]!
                entry["revision"] = String(repeating: "f", count: 64); map[itemId] = entry; raw["baselines"] = map
                try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys]).write(to: url)
            }
            switch kind {
            case "policy-error": try changeBaseline()
            case "policy-error-unchanged": break
            case "permission-error":
                await transport.setWriteHook {
                    do {
                        try changeBaseline()
                        var expected = try Self.snapshot(root: rootURL, device: directory, id: itemId)
                        expected["rawState"] = try Data(contentsOf: directory.appendingPathComponent("sync/state.json"))
                        await gate.recordExpected(expected)
                    } catch { await gate.recordFailure("Permission fixture mutation failed") }
                    return false
                }
            case "manifest-error", "manifest-error-unchanged":
                await transport.setManifestHook {
                    if kind == "manifest-error" {
                        do {
                            try changeBaseline()
                            var expected = try Self.snapshot(root: rootURL, device: directory, id: itemId)
                            expected["rawState"] = try Data(contentsOf: directory.appendingPathComponent("sync/state.json"))
                            await gate.recordExpected(expected)
                        } catch { await gate.recordFailure("Manifest fixture mutation failed"); throw error }
                    }
                    throw URLError(.notConnectedToInternet)
                }
            case "remote-path": await transport.move("Third.textpack")
            case "remote-generation": await transport.setGeneration("generation-b")
            case "remote-revision": await transport.peer(alternative)
            case "permission": await transport.setPermission(false)
            case "local": try alternative.write(to: rootURL.appendingPathComponent("Original.textpack"))
            case "duplicate": try changed.write(to: rootURL.appendingPathComponent("Extra.textpack"))
            case "deletion":
                try LocalVaultDocumentStore(root: rootURL).removeRetaining(path: "Original.textpack", expectedHash: TextTextStableDigest.sha256Hex(changed), recordDeletion: true)
                try changed.write(to: rootURL.appendingPathComponent("Original.textpack"))
            case "payload":
                let stateURL = directory.appendingPathComponent("sync/state.json")
                let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as! [String: Any]
                let operation = ((raw["outbox"] as! [String: [String: Any]])[itemId]!["operationId"] as! String)
                try alternative.write(to: directory.appendingPathComponent("sync/outbox/\(operation).textpack"))
            case "account", "binary-baseline", "binary-revision":
                let url = directory.appendingPathComponent("sync/state.json")
                var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
                if kind == "account" { raw["accountId"] = "account-b" }
                if kind == "binary-baseline" { raw["binaryBaselines"] = [itemId: ["assets/a.bin": String(repeating: "a", count: 64)]] }
                if kind == "binary-revision" { raw["binaryRevisions"] = [itemId: String(repeating: "b", count: 64)] }
                try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys]).write(to: url)
            case "pending", "baseline":
                let url = directory.appendingPathComponent("sync/state.json")
                var raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
                let key = kind == "pending" ? "outbox" : "baselines"
                var map = raw[key] as! [String: [String: Any]], entry = map[itemId]!
                entry[kind == "pending" ? "lifecycle" : "revision"] = kind == "pending" ? "different-generation" : String(repeating: "f", count: 64)
                map[itemId] = entry; raw[key] = map
                try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys]).write(to: url)
            case "checkpoint":
                let shared = directory.appendingPathComponent("shared-editing/\(itemId)")
                try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
                try Data(#"{"version":999}"#.utf8).write(to: shared.appendingPathComponent("checkpoint.json"))
            default: throw LocalVaultSyncFailure.invalidResponse
            }
            var expected = try Self.snapshot(root: rootURL, device: directory, id: itemId)
            if ["account", "pending", "baseline", "binary-baseline", "binary-revision", "policy-error"].contains(kind) { expected["rawState"] = try Data(contentsOf: directory.appendingPathComponent("sync/state.json")) }
            return expected
        }
        var report: LocalVaultSyncReport?
        do { report = try await sync.sync() }
        catch { if kind.hasSuffix("-unchanged") { XCTFail("An unchanged target must retain a normal report") } }
        if kind.hasSuffix("-unchanged") { XCTAssertTrue(report?.errors.contains("A queued file update needs review before its path can change. Your file is kept on this device.") == true) }
        let fixtureFailure = await gate.failure; XCTAssertNil(fixtureFailure)
        let hits = await gate.hits; XCTAssertEqual(hits, 1)
        let capturedExpected = await gate.expected
        let expected = try XCTUnwrap(capturedExpected)
        var actual = try Self.snapshot(root: rootURL, device: directory, id: id)
        if expected["rawState"] != nil { actual["rawState"] = try Data(contentsOf: directory.appendingPathComponent("sync/state.json")) }
        XCTAssertEqual(actual, expected)
        let calls = await transport.uploads; XCTAssertEqual(calls, beforeCalls)
    }
    func testChangedDurableTargetAndPolicyFailureAbortWithoutOverwrite() async throws { try await race("policy-error") }
    func testChangedDurableTargetAndFinalPermissionDenialAbortWithoutOverwrite() async throws { try await race("permission-error") }
    func testChangedDurableTargetAndManifestFailureAbortWithoutOverwrite() async throws { try await race("manifest-error") }
    func testUnchangedTargetPolicyFailureReturnsRetainedReview() async throws { try await race("policy-error-unchanged") }
    func testUnchangedTargetManifestFailureReturnsRetainedReview() async throws { try await race("manifest-error-unchanged") }
    func testHeldPolicyRemotePathChangePreservesTarget() async throws { try await race("remote-path") }
    func testHeldPolicyRemoteGenerationChangePreservesTarget() async throws { try await race("remote-generation") }
    func testHeldPolicyRemoteRevisionChangePreservesTarget() async throws { try await race("remote-revision") }
    func testHeldPolicyPermissionRevocationPreservesTarget() async throws { try await race("permission") }
    func testHeldPolicyLocalEditPreservesTarget() async throws { try await race("local") }
    func testHeldPolicyDuplicateIdentityPreservesTarget() async throws { try await race("duplicate") }
    func testHeldPolicyDeletionIntentPreservesTarget() async throws { try await race("deletion") }
    func testHeldPolicyStagedBytesChangePreservesTarget() async throws { try await race("payload") }
    func testHeldPolicyDurablePendingChangeAbortsWithoutOverwrite() async throws { try await race("pending") }
    func testHeldPolicyDurableBaselineChangeAbortsWithoutOverwrite() async throws { try await race("baseline") }
    func testHeldPolicyDurableAccountChangeAbortsWithoutOverwrite() async throws { try await race("account") }
    func testHeldPolicyDurableBinaryBaselineChangeAbortsWithoutOverwrite() async throws { try await race("binary-baseline") }
    func testHeldPolicyDurableBinaryRevisionChangeAbortsWithoutOverwrite() async throws { try await race("binary-revision") }
    func testHeldPolicyFutureCheckpointPreservesTarget() async throws { try await race("checkpoint") }
}
private actor QueuedPolicyGate {
    private var action: (@Sendable () async throws -> [String: Data])?
    var expected: [String: Data]?, hits = 0, failure: String?
    private var failAfterAction = false
    func set(failAfterAction: Bool = false, _ action: @escaping @Sendable () async throws -> [String: Data]) { self.action = action; self.failAfterAction = failAfterAction }
    func recordExpected(_ value: [String: Data]) { expected = value }
    func recordFailure(_ value: String) { failure = value }
    func run(_ script: String) async throws {
        guard script.contains(".queuedUploadPath("), let action else { return }
        self.action = nil; hits += 1; expected = try await action()
        if failAfterAction { throw URLError(.notConnectedToInternet) }
    }
}
private actor QueuedPathTransport: LocalVaultSyncTransport {
    nonisolated let protectedRenameBinding: LocalVaultProtectedRenameScope? = .init(origin: "https://queued.test", workspaceId: "queued-fixture", accountId: "account-a")
    struct Upload: Equatable { let operationId: String, path: String, hash: String, base: String? }
    var uploads: [Upload] = []
    var item: LocalVaultRemoteItem, data: Data, writable = true, uploading = false
    var manifestHook: (@Sendable () async throws -> Void)?
    var writeHook: (@Sendable () async -> Bool)?
    func setWriteHook(_ hook: @escaping @Sendable () async -> Bool) { writeHook = hook }
    func setManifestHook(_ hook: @escaping @Sendable () async throws -> Void) { manifestHook = hook }
    init(id: String, path: String, data: Data, generation: String?) { self.data = data; item = .init(itemId: id, relativePath: path, revision: TextTextStableDigest.sha256Hex(data), lifecycle: generation) }
    func move(_ path: String) { item = .init(itemId: item.itemId, relativePath: path, revision: item.revision, lifecycle: item.lifecycle) }
    func setGeneration(_ generation: String?) { item = .init(itemId: item.itemId, relativePath: item.relativePath, revision: item.revision, lifecycle: generation) }
    func setPermission(_ value: Bool) { writable = value }
    func peer(_ bytes: Data) { data = bytes; item = .init(itemId: item.itemId, relativePath: item.relativePath, revision: TextTextStableDigest.sha256Hex(bytes), lifecycle: item.lifecycle) }
    func allowUpload() { uploading = true }
    func canOrganize() -> Bool { writable }
    func canWrite(itemId: String, path: String, existing: Bool) async -> Bool {
        if let hook = writeHook { writeHook = nil; return await hook() }
        return writable && itemId == item.itemId && path == item.relativePath && existing
    }
    func manifest() async throws -> [LocalVaultRemoteItem] {
        if let hook = manifestHook { manifestHook = nil; try await hook() }
        return [item]
    }
    func download(itemId: String) throws -> LocalVaultRemotePack { guard itemId == item.itemId else { throw LocalVaultSyncFailure.invalidResponse }; return .init(data: data, relativePath: item.relativePath, revision: item.revision) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) throws -> String {
        uploads.append(.init(operationId: operationId, path: path, hash: TextTextStableDigest.sha256Hex(data), base: baseRevision))
        guard uploading else { throw URLError(.notConnectedToInternet) }
        guard writable, itemId == item.itemId, path == item.relativePath, baseRevision == item.revision else { throw LocalVaultSyncFailure.conflict }
        peer(data); return item.revision
    }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) throws { throw LocalVaultSyncFailure.invalidResponse }
}
