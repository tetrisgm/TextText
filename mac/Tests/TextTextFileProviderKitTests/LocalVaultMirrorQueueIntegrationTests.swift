import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultMirrorQueueIntegrationTests: XCTestCase {
    func testSharedSerializedQueueLanesAndUnknownLaneRefusal() async throws {
        struct Vector: Decodable { let name: String; let observed: LocalVaultMirrorQueueObservation; let decision: LocalVaultMirrorQueueDecision }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: root.appendingPathComponent("sync/fixtures/mirror-queue.json")))
        for vector in vectors {
            let policy = makeTestMirrorPolicy(workspaceId: "queue-vectors")
            let actual = try await policy.queue(vector.observed)
            XCTAssertEqual(actual.operationIds, vector.decision.operationIds, vector.name)
            XCTAssertEqual(actual.hasMore, vector.decision.hasMore, vector.name)
        }
        let policy = makeTestMirrorPolicy(workspaceId: "queue-invalid")
        do {
            _ = try await policy.queue(.init(candidates: [], budget: 1, lane: "future"))
            XCTFail("Unknown lane must refuse")
        } catch { }
    }
    private struct Fixture: Sendable {
        let root: URL, binding: LocalVaultSyncBinding, stateURL: URL
        let transport: FakeVaultTransport
        let operations: [String], itemIDs: [String], payloads: [Data], paths: [String]
    }
    private func fixture() async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-queue-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://queue.test")!, workspaceId: "queue-fixture")
        let transport = FakeVaultTransport()
        let operations = ["c0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002", "b0000000-0000-4000-8000-000000000003"]
        var baselines: [String: Any] = [:], outbox: [String: Any] = [:], identities: [String: String] = [:]
        var payloads: [Data] = [], itemIDs: [String] = [], paths: [String] = []
        for index in 0..<3 {
            let id = "queue-item-\(index)", path = "Note-\(index).textpack"
            let old = try pack(root: root, id: id, body: "remote-\(index)")
            let pending = try pack(root: root, id: id, body: "retained exact payload-\(index)")
            try pending.write(to: root.appendingPathComponent(path))
            await transport.set(itemId: id, path: path, data: old)
            let revision = TextTextStableDigest.sha256Hex(old)
            baselines[id] = ["path": path, "revision": revision, "localHash": revision]
            outbox[id] = ["itemId": id, "path": path, "hash": TextTextStableDigest.sha256Hex(pending), "baseRevision": revision, "operationId": operations[index]]
            identities[path] = id; itemIDs.append(id); paths.append(path); payloads.append(pending)
        }
        let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        try FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let outboxDirectory = stateURL.deletingLastPathComponent().appendingPathComponent("outbox")
        try FileManager.default.createDirectory(at: outboxDirectory, withIntermediateDirectories: true)
        for index in 0..<3 {
            try payloads[index].write(to: outboxDirectory.appendingPathComponent(operations[index] + ".textpack"))
        }
        try JSONSerialization.data(withJSONObject: ["version": 1, "binding": try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding)), "baselines": baselines, "outbox": outbox, "conflicts": [:], "cursor": 0, "identities": identities]).write(to: stateURL)
        return Fixture(root: root, binding: binding, stateURL: stateURL, transport: transport, operations: operations, itemIDs: itemIDs, payloads: payloads, paths: paths)
    }
    private func pack(root: URL, id: String, body: String) throws -> Data {
        let temporary = root.appendingPathComponent(".pack-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let document = try BuiltinTextPackDocument.create(title: "Queue fixture", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: \"Queue fixture\"\n---\n\n\(body)", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: temporary)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: temporary))
    }
    private func pending(_ fixture: Fixture) throws -> [String: [String: Any]] {
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture.stateURL)) as? [String: Any])
        return try XCTUnwrap(state["outbox"] as? [String: [String: Any]])
    }
    private func assertPendingPayloads(_ f: Fixture, file: StaticString = #filePath, line: UInt = #line) throws {
        let retained = try pending(f)
        for index in 0..<3 where retained[f.itemIDs[index]] != nil {
            let path = f.stateURL.deletingLastPathComponent().appendingPathComponent("outbox/" + f.operations[index] + ".textpack")
            XCTAssertEqual(try Data(contentsOf: path), f.payloads[index], file: file, line: line)
        }
    }
    func testBoundedRetainedSelectionPreservesCapturedOrderIDsAndPayloadAcrossRestart() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let original = try pending(f)
        for index in 0..<3 {
            let engine = try makeTestSync(root: f.root, binding: f.binding, transport: f.transport)
            let report = try await engine.sync(maxItems: 1)
            let sent = await f.transport.operations()
            XCTAssertEqual(sent, Array(f.operations.prefix(index + 1)))
            let remaining = try pending(f)
            XCTAssertEqual(remaining.count, 2 - index)
            try assertPendingPayloads(f)
            for id in f.itemIDs.suffix(2 - index) {
                XCTAssertEqual(try JSONSerialization.data(withJSONObject: try XCTUnwrap(remaining[id]), options: .sortedKeys), try JSONSerialization.data(withJSONObject: try XCTUnwrap(original[id]), options: .sortedKeys))
            }
            if index < 2 { XCTAssertTrue(report.hasMore) }
            let remote = try await f.transport.download(itemId: f.itemIDs[index])
            XCTAssertEqual(remote.data, f.payloads[index])
            XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent(f.paths[index])), f.payloads[index])
        }
    }
    func testPermissionRevokedDuringQueueRPCDoesNotSendCapturedIntents() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let before = try pending(f)
        let policy = makeTestMirrorPolicy(workspaceId: f.binding.workspaceId) { script in
            if script.contains(".queue(") { await f.transport.setWritable(false) }
        }
        let engine = try LocalVaultSync(root: f.root, binding: f.binding, transport: f.transport, mirrorPolicy: policy)
        _ = try await engine.sync(maxItems: 1)
        let sent = await f.transport.operations(); XCTAssertTrue(sent.isEmpty)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: pending(f), options: .sortedKeys), try JSONSerialization.data(withJSONObject: before, options: .sortedKeys))
        try assertPendingPayloads(f)
        for index in 0..<3 { XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent(f.paths[index])), f.payloads[index]) }
    }
    func testUnavailableQueuePolicyRetainsExactDurableOperations() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let before = try pending(f), witness = QueuePolicyRetirement()
        let policy = makeTestMirrorPolicy(workspaceId: f.binding.workspaceId) { script in
            if script.contains(".queue(") { await witness.recordRequest(); throw LocalVaultMirrorPolicy.Failure.stale }
        }
        let engine = try LocalVaultSync(root: f.root, binding: f.binding, transport: f.transport, mirrorPolicy: policy)
        do { _ = try await engine.sync(maxItems: 1); XCTFail("Unavailable queue policy must stop the pass") }
        catch { }
        let queueRequests = await witness.requests
        XCTAssertGreaterThan(queueRequests, 0, "The refusal must occur at the actual queue RPC.")
        let sent = await f.transport.operations(); XCTAssertTrue(sent.isEmpty)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: pending(f), options: .sortedKeys), try JSONSerialization.data(withJSONObject: before, options: .sortedKeys))
        try assertPendingPayloads(f)
    }
    func testRetiredQueueReplyCannotResumeCapturedPendingOperations() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let before = try pending(f), retirement = QueuePolicyRetirement()
        let policy = makeTestMirrorPolicy(workspaceId: f.binding.workspaceId) { script in
            if script.contains(".queue(") { await retirement.retire() }
        }
        await retirement.install(policy)
        let engine = try LocalVaultSync(root: f.root, binding: f.binding, transport: f.transport, mirrorPolicy: policy)
        do { _ = try await engine.sync(maxItems: 1); XCTFail("A retired queue RPC must not authorize sends") }
        catch { }
        let queueRequests = await retirement.requests
        XCTAssertGreaterThan(queueRequests, 0, "The reply must retire during the actual queue RPC.")
        let sent = await f.transport.operations(); XCTAssertTrue(sent.isEmpty)
        XCTAssertEqual(try JSONSerialization.data(withJSONObject: pending(f), options: .sortedKeys), try JSONSerialization.data(withJSONObject: before, options: .sortedKeys))
        try assertPendingPayloads(f)
    }

    func testNewlyStagedUploadMustPassQueueBeforePermissionCanAuthorizeSend() async throws {
        let f = try await fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        var state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: f.stateURL)) as? [String: Any])
        let original = try pending(f)
        state["outbox"] = [String: Any]()
        try JSONSerialization.data(withJSONObject: state).write(to: f.stateURL, options: .atomic)
        let witness = QueuePolicyRetirement()
        let policy = makeTestMirrorPolicy(workspaceId: f.binding.workspaceId) { script in
            guard let start = script.range(of: ".queue(") else { return }
            let json = String(script[start.upperBound...].dropLast())
            let request = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            let observed = try XCTUnwrap(request["observed"] as? [String: Any])
            let candidates = try XCTUnwrap(observed["candidates"] as? [[String: Any]])
            if !candidates.isEmpty {
                await witness.recordRequest()
                await f.transport.setWritable(false)
            }
        }
        let engine = try LocalVaultSync(root: f.root, binding: f.binding, transport: f.transport, mirrorPolicy: policy)
        _ = try await engine.sync(maxItems: 1)
        let requests = await witness.requests
        XCTAssertGreaterThan(requests, 0, "Newly staged content must reach the shared queue selector before sending.")
        let sent = await f.transport.operations()
        XCTAssertTrue(sent.isEmpty, "Revocation at the queue RPC must fence the newly captured upload.")
        let retained = try pending(f)
        XCTAssertEqual(retained.count, 1)
        if let captured = retained[f.itemIDs[0]] {
            XCTAssertEqual(captured["path"] as? String, f.paths[0])
            XCTAssertEqual(captured["itemId"] as? String, f.itemIDs[0])
            XCTAssertEqual(captured["hash"] as? String, TextTextStableDigest.sha256Hex(f.payloads[0]))
            XCTAssertEqual(captured["baseRevision"] as? String, original[f.itemIDs[0]]?["baseRevision"] as? String)
            let operation = try XCTUnwrap(captured["operationId"] as? String)
            XCTAssertNotNil(UUID(uuidString: operation))
            let bytes = try Data(contentsOf: f.stateURL.deletingLastPathComponent().appendingPathComponent("outbox/" + operation + ".textpack"))
            XCTAssertEqual(bytes, f.payloads[0])
        } else { XCTFail("The denied staged intent must remain durable.") }
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent(f.paths[0])), f.payloads[0])
    }

}

private actor QueuePolicyRetirement {
    private var policy: LocalVaultMirrorPolicy?
    private(set) var requests = 0
    func recordRequest() { requests += 1 }
    func install(_ policy: LocalVaultMirrorPolicy) { self.policy = policy }
    func retire() async { requests += 1; await policy?.retire() }
}
