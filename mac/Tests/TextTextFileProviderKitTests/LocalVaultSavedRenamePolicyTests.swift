import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultSavedRenamePolicyTests: XCTestCase {
    private struct Vector: Decodable { let name: String, observed: LocalVaultMirrorSavedRenameObservation, decision: LocalVaultMirrorSavedRenameDecision }
    private func vectors() throws -> [Vector] {
        var root = URL(fileURLWithPath: #filePath); for _ in 0..<4 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode([Vector].self, from: Data(contentsOf: root.appendingPathComponent("sync/fixtures/mirror-saved-rename.json")))
    }
    func testSerializedSavedRenameVectors() async throws {
        for vector in try vectors() {
            let actual = try await makeTestMirrorPolicy(workspaceId: "saved-rename-vectors").savedRename(vector.observed)
            XCTAssertEqual(actual, vector.decision, vector.name)
        }
    }
    func testTypedGenerationSavedRenameVectorsRoundTripThroughSharedOwner() async throws {
        var root = URL(fileURLWithPath: #filePath); for _ in 0..<4 { root.deleteLastPathComponent() }
        let rows = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: root.appendingPathComponent("sync/fixtures/mirror-generation-rename.json")))
        for vector in rows {
            let actual = try await makeTestMirrorPolicy(workspaceId: "typed-saved-rename-vectors").savedRename(vector.observed)
            XCTAssertEqual(actual, vector.decision, vector.name)
        }
    }
    func testSavedRenameReplyRejectsFutureAndForgedFields() async throws {
        let scope = LocalVaultMirrorScope(accountId: "account", workspaceId: "workspace", lifecycle: "connection")
        let observed = try vectors()[0].observed
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
            do { _ = try await policy.savedRename(observed); XCTFail("Accepted \(altered)") } catch { }
        }
    }
}
