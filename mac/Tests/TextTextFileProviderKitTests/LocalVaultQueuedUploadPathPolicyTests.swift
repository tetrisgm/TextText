import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultQueuedUploadPathPolicyTests: XCTestCase {
    private struct Vector: Decodable { let name: String, observed: LocalVaultMirrorQueuedUploadPathObservation, decision: LocalVaultMirrorQueuedUploadPathDecision }
    private func vectors() throws -> [Vector] {
        var root = URL(fileURLWithPath: #filePath); for _ in 0..<4 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode([Vector].self, from: Data(contentsOf: root.appendingPathComponent("sync/fixtures/mirror-queued-upload-path.json")))
    }
    func testSerializedQueuedUploadPathVectors() async throws {
        for vector in try vectors() {
            let actual = try await makeTestMirrorPolicy(workspaceId: "queued-upload-path-vectors").queuedUploadPath(vector.observed)
            XCTAssertEqual(actual, vector.decision, vector.name)
        }
    }
    func testQueuedUploadPathReplyRejectsFutureAndForgedFields() async throws {
        let scope = LocalVaultMirrorScope(accountId: "account", workspaceId: "workspace", lifecycle: "connection")
        let observed = try vectors()[0].observed
        for altered in ["scope", "requestId", "pageId", "generation", "digest", "unknown", "unknown-observed", "missing-lifecycle", "action"] {
            let policy = LocalVaultMirrorPolicy(digest: String(repeating: "f", count: 64), scope: scope) { script in
                let header: [String: Any] = ["version": 1, "digest": String(repeating: "f", count: 64), "pageId": "page", "generation": 1]
                if script.contains(".handshake(") { return String(decoding: try JSONSerialization.data(withJSONObject: header), as: UTF8.self) }
                if script.contains(".bind(") { return String(decoding: try JSONSerialization.data(withJSONObject: header.merging(["scope": ["accountId": "account", "workspaceId": "workspace", "lifecycle": "connection"]]) { _, next in next }), as: UTF8.self) }
                let start = try XCTUnwrap(script.firstIndex(of: "("))
                var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(script[script.index(after: start)..<script.index(before: script.endIndex)].utf8)) as? [String: Any])
                value["decision"] = ["action": "defer"]
                if altered == "scope" { value["scope"] = ["accountId": "foreign", "workspaceId": "workspace", "lifecycle": "connection"] }
                if altered == "requestId" { value["requestId"] = "foreign" }
                if altered == "pageId" { value["pageId"] = "foreign" }
                if altered == "generation" { value["generation"] = 99 }
                if altered == "digest" { value["digest"] = String(repeating: "0", count: 64) }
                if altered == "unknown" { value["future"] = true }
                if altered == "action" { value["decision"] = ["action": "future"] }
                if altered == "unknown-observed" || altered == "missing-lifecycle" {
                    var observed = try XCTUnwrap(value["observed"] as? [String: Any])
                    if altered == "unknown-observed" { observed["future"] = true } else { observed.removeValue(forKey: "pendingLifecycle") }
                    value["observed"] = observed
                }
                return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
            }
            do { _ = try await policy.queuedUploadPath(observed); XCTFail("Accepted \(altered)") } catch { }
        }
    }
    func testPageReloadAfterDecisionRefusesAuthority() async throws {
        let counter = QueuedPolicyHandshakeCounter()
        let scope = LocalVaultMirrorScope(accountId: "account", workspaceId: "workspace", lifecycle: "connection")
        let policy = LocalVaultMirrorPolicy(digest: String(repeating: "f", count: 64), scope: scope) { script in
            var header: [String: Any] = ["version": 1, "digest": String(repeating: "f", count: 64), "pageId": "page", "generation": 1]
            if script.contains(".handshake(") { if await counter.next() > 1 { header["pageId"] = "reloaded" }; return String(decoding: try JSONSerialization.data(withJSONObject: header), as: UTF8.self) }
            if script.contains(".bind(") { header["scope"] = ["accountId": "account", "workspaceId": "workspace", "lifecycle": "connection"]; return String(decoding: try JSONSerialization.data(withJSONObject: header), as: UTF8.self) }
            let start = try XCTUnwrap(script.firstIndex(of: "("))
            var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(script[script.index(after: start)..<script.index(before: script.endIndex)].utf8)) as? [String: Any])
            value["decision"] = ["action": "defer"]
            return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
        }
        do { _ = try await policy.queuedUploadPath(vectors()[0].observed); XCTFail("Accepted reloaded page") } catch { }
        let handshakes = await counter.count; XCTAssertEqual(handshakes, 2)
    }

}

private actor QueuedPolicyHandshakeCounter { var count = 0; func next() -> Int { count += 1; return count } }
