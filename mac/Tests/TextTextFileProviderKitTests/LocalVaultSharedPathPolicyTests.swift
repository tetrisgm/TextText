import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultSharedPathPolicyTests: XCTestCase {
    func testSerializedProtectedPathVectors() async throws {
        struct Vector: Decodable { let name: String, observed: LocalVaultMirrorSharedPathObservation, decision: LocalVaultMirrorSharedPathDecision }
        var root = URL(fileURLWithPath: #filePath); for _ in 0..<4 { root.deleteLastPathComponent() }
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: root.appendingPathComponent("sync/fixtures/mirror-shared-path.json")))
        for vector in vectors { let actual = try await makeTestMirrorPolicy(workspaceId: "path-vectors").sharedPath(vector.observed); XCTAssertEqual(actual, vector.decision, vector.name) }
    }
    func testProtectedPathReplyRejectsFutureAndForgedFields() async throws {
        let scope = LocalVaultMirrorScope(accountId: "account", workspaceId: "workspace", lifecycle: "connection")
        let observed = LocalVaultMirrorSharedPathObservation(protectedProjection: true, baselinePath: "a.textpack", localPath: "a.textpack", remotePath: "a.textpack", checkpointPath: "a.textpack", checkpointReady: true, checkpointRetired: false, localUnique: true, remoteDeleted: false, localLifecycle: "g", remoteLifecycle: "g", blocked: false, organizePermitted: true, pendingRename: "none")
        for altered in ["scope", "requestId", "unknown", "unknown-observed", "missing-lifecycle", "action"] {
            let policy = LocalVaultMirrorPolicy(digest: String(repeating: "f", count: 64), scope: scope) { script in
                let header: [String: Any] = ["version": 1, "digest": String(repeating: "f", count: 64), "pageId": "page", "generation": 1]
                if script.contains(".handshake(") { return String(decoding: try JSONSerialization.data(withJSONObject: header), as: UTF8.self) }
                if script.contains(".bind(") { return String(decoding: try JSONSerialization.data(withJSONObject: header.merging(["scope": ["accountId": "account", "workspaceId": "workspace", "lifecycle": "connection"]]) { _, next in next }), as: UTF8.self) }
                let start = try XCTUnwrap(script.firstIndex(of: "("))
                var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(script[script.index(after: start)..<script.index(before: script.endIndex)].utf8)) as? [String: Any])
                value["decision"] = ["action": "hold"]
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
            do { _ = try await policy.sharedPath(observed); XCTFail("Accepted \(altered)") } catch { }
        }
    }
    func testInboundPathRequiresKnownMatchingFileGeneration() async throws {
        for (local, remote, missing, moved, race) in [("generation-a", "generation-b", false, false, "none"), (nil, "generation-a", false, false, "none"), (nil, "generation-a", true, false, "none"), ("generation-a", "generation-a", true, true, "none"), ("generation-a", "generation-a", false, true, "none"), ("generation-a", "generation-a", false, false, "duplicate"), ("generation-a", "generation-a", false, false, "checkpoint"), ("generation-a", "generation-a", false, false, "lifecycle"), ("generation-a", "generation-a", false, true, "adopt"), ("generation-a", "generation-a", false, false, "permission")] as [(String?, String?, Bool, Bool, String)] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("shared-path-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let path = "Original.textpack", destination = "Remote.textpack", id = "shared-path-fixture"
            let document = try BuiltinTextPackDocument.create(title: "Path fixture", body: "Retained body")
            let markdown = "---\ntextTextId: \"\(id)\"\ntitle: \"Path fixture\"\n---\n\nRetained body"
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
            let temporary = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            try FileManager.default.moveItem(at: temporary, to: root.appendingPathComponent(path))
            let store = LocalVaultDocumentStore(root: root), initial = try store.read(path: path)
            let binding = try LocalVaultSyncBinding(origin: URL(string: "https://shared-path.test")!, workspaceId: "shared-path")
            let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
            try FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            var state: [String: Any] = ["version": 1, "binding": try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding)), "baselines": missing ? [:] : [id: ["path": path, "revision": initial.hash, "localHash": initial.hash]], "outbox": [:], "conflicts": [:], "cursor": 0, "identities": [path: id]]
            if let local { state["lifecycles"] = [id: local] }
            try JSONSerialization.data(withJSONObject: state).write(to: stateURL)
            let journal = String(decoding: try JSONSerialization.data(withJSONObject: ["version": 1, "epoch": 1, "seq": 0, "journalGeneration": 1, "revision": initial.hash, "relativePath": path, "update": "AAA=", "pending": ["AAA="]]), as: UTF8.self)
            let shared = LocalVaultSharedEditingStore(root: root)
            _ = try shared.materialize(checkpoint: .init(itemId: id, path: path, projectedHash: initial.hash, acknowledgedRevision: initial.hash, epoch: 1, seq: 0, journalGeneration: 1, journal: journal, pending: true), expectedHash: initial.hash, markdown: markdown, documentJSON: document.documentJSON)
            let before = try Data(contentsOf: root.appendingPathComponent(path))
            let transport = FakeVaultTransport()
            await transport.restore(itemId: id, path: destination, data: before, lifecycle: remote ?? "generation-a")
            if race == "adopt" {
                try FileManager.default.moveItem(at: root.appendingPathComponent(path), to: root.appendingPathComponent(destination))
                _ = try shared.rebase(itemId: id, newPath: destination, adoptingExternalChange: true)
            }
            let mutation = SharedPathMutation(root: root, path: path, destination: destination, itemId: id, transport: transport, bytes: before, mode: race)
            let sync = try LocalVaultSync(root: root, binding: binding, transport: transport,
                mirrorPolicy: makeTestMirrorPolicy(workspaceId: binding.workspaceId, beforeRequest: { script in try await mutation.run(script) }))
            _ = try await sync.sync()
            XCTAssertEqual(FileManager.default.fileExists(atPath: root.appendingPathComponent(destination).path), moved, "local=\(local ?? "unknown") missing=\(missing)")
            if race == "adopt" {
                let result = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
                XCTAssertEqual((result["baselines"] as? [String: [String: Any]])?[id]?["path"] as? String, destination)
            }
            if !moved {
                if FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path) { XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), before) }
                XCTAssertEqual(try shared.checkpoint(itemId: id)?.path, path)
                let result = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
                let baseline = (result["baselines"] as? [String: [String: Any]])?[id]
                XCTAssertEqual(baseline?["path"] as? String, missing ? nil : path)
            }
        }
    }
}

private actor SharedPathMutation {
    let root: URL, path: String, destination: String, itemId: String, transport: FakeVaultTransport, bytes: Data, mode: String
    var ran = false
    init(root: URL, path: String, destination: String, itemId: String, transport: FakeVaultTransport, bytes: Data, mode: String) {
        self.root = root; self.path = path; self.destination = destination; self.itemId = itemId; self.transport = transport; self.bytes = bytes; self.mode = mode
    }
    func run(_ script: String) async throws {
        guard script.contains(".sharedPath("), !ran else { return }; ran = true
        if mode == "permission" { await transport.setWritable(false) }
        if mode == "duplicate" { try bytes.write(to: root.appendingPathComponent("Duplicate.textpack")) }
        if mode == "lifecycle" { await transport.restore(itemId: itemId, path: destination, data: bytes, lifecycle: "generation-after-await") }
        if mode == "checkpoint" {
            let shared = LocalVaultSharedEditingStore(root: root)
            var checkpoint = try XCTUnwrap(shared.checkpoint(itemId: itemId))
            checkpoint.journalGeneration += 1
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(checkpoint.journal.utf8)) as? [String: Any])
            object["journalGeneration"] = checkpoint.journalGeneration
            checkpoint.journal = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            let file = try LocalVaultDocumentStore(root: root).read(path: path)
            _ = try shared.materialize(checkpoint: checkpoint, expectedHash: file.hash, markdown: file.contents.markdown, documentJSON: try XCTUnwrap(file.contents.documentJSON))
        }
    }
}
