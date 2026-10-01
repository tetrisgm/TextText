import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultCollaborationTests: XCTestCase {
    private let origin = URL(string: "https://texttext.app")!
    @MainActor
    func testClosingExpiredSessionIsIdempotentButCannotCheckpoint() async {
        let relay = LocalVaultCollaboration(credentials: { nil })
        for attempt in 0..<2 {
            let closed = expectation(description: "closed \(attempt)")
            relay.start(id: "close-\(attempt)", method: "collaborationClose", params: ["itemId": "item", "sessionToken": "expired"], root: FileManager.default.temporaryDirectory) { result in
                if case .failure(let error) = result { XCTFail(error.localizedDescription) }
                closed.fulfill()
            }
            await fulfillment(of: [closed], timeout: 2)
        }
        let rejected = expectation(description: "expired checkpoint rejected")
        relay.start(id: "write", method: "collaborationCheckpoint", params: ["itemId": "item", "sessionToken": "expired"], root: FileManager.default.temporaryDirectory) { result in
            if case .success = result { XCTFail("An expired session must not write") }
            rejected.fulfill()
        }
        await fulfillment(of: [rejected], timeout: 2)
    }
    func testConfigurationReadinessRequiresAcknowledgedUnchangedFileAndNoPendingWork() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let sync = root.appendingPathComponent(".texttext/sync")
        try FileManager.default.createDirectory(at: sync, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let hash = String(repeating: "a", count: 64)
        var state: [String: Any] = ["binding": ["origin": origin.absoluteString, "workspaceId": "workspace"],
            "baselines": ["item": ["path": "Note.textpack", "revision": hash, "localHash": hash]], "outbox": [:], "conflicts": [:], "cursor": 0]
        func save() throws { try JSONSerialization.data(withJSONObject: state).write(to: sync.appendingPathComponent("state.json")) }
        try save()
        XCTAssertTrue(try LocalVaultSync.collaborationReady(root: root, path: "Note.textpack", itemId: "item", localHash: hash))
        XCTAssertFalse(try LocalVaultSync.collaborationReady(root: root, path: "Note.textpack", itemId: "new-item", localHash: hash))
        XCTAssertFalse(try LocalVaultSync.collaborationReady(root: root, path: "Note.textpack", itemId: "item", localHash: String(repeating: "b", count: 64)))
        state["outbox"] = ["item": ["itemId": "item", "path": "Note.textpack", "hash": hash, "baseRevision": hash, "operationId": UUID().uuidString]]
        try save()
        XCTAssertFalse(try LocalVaultSync.collaborationReady(root: root, path: "Note.textpack", itemId: "item", localHash: hash))
    }
    func testReadBuildsOnlyBoundEndpointAndCursor() throws {
        let request = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture-token",
            method: "collaborationRead", params: ["itemId": "item-1", "epoch": 3, "seq": 4, "waitMs": 25_000])
        XCTAssertEqual(request.url?.absoluteString, "https://texttext.app/api/vault/workspace/items/item-1/collaboration?epoch=3&seq=4&waitMs=25000")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.timeoutInterval, 35)
    }
    func testRejectsPathInjectionUnknownParametersAndInvalidCursor() throws {
        for params: [String: Any] in [["itemId": "../private"], ["itemId": "item", "url": "https://outside.example"],
            ["itemId": "item", "waitMs": 1], ["itemId": "item", "epoch": true, "seq": 1],
            ["itemId": "item", "epoch": 1, "seq": -1], ["itemId": "item", "waitMs": 25_001]] {
            XCTAssertThrowsError(try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
                method: "collaborationRead", params: params))
        }
    }
    func testPushUsesBoundedWhitelistedDTO() throws {
        let request = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "collaborationPush", params: ["itemId": "item", "operationId": "operation-1", "epoch": 1, "updates": ["AQ=="]])
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["operationId", "epoch", "updates"])
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertThrowsError(try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "collaborationPush", params: ["itemId": "item", "operationId": "op", "epoch": 1, "updates": []]))
        XCTAssertThrowsError(try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "collaborationPush", params: ["itemId": "item", "operationId": "op", "epoch": 1, "updates": [String(repeating: "a", count: 512 * 1024 + 1)]]))
    }
}
