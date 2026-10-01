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
    func testPresenceUsesBoundItemEndpointAndWhitelistedSessions() throws {
        let read = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "presenceRead", params: ["itemId": "item-1"])
        XCTAssertEqual(read.url?.absoluteString, "https://texttext.app/api/vault/workspace/items/item-1/presence")
        XCTAssertEqual(read.httpMethod, "GET")
        let join = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "presenceJoin", params: ["itemId": "item-1", "awarenessClientId": 42])
        let joinBody = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(join.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(joinBody.keys), ["join", "awarenessClientId"])
        let session: [String: Any] = ["itemId": "item-1", "clientId": "p-00000000-0000-4000-8000-000000000001", "sessionCredential": "v1:fixture"]
        let update = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "presenceUpdate", params: session.merging(["awareness": "AAA="]) { _, new in new })
        let updateBody = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(update.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(updateBody.keys), ["clientId", "sessionCredential", "awareness"])
        let leave = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
            method: "presenceLeave", params: session)
        let leaveBody = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(leave.httpBody)) as? [String: Any])
        XCTAssertEqual(leaveBody["leave"] as? Bool, true)
        for invalid in [session.merging(["url": "https://outside.example"]) { _, new in new },
                        session.merging(["clientId": "../outside"]) { _, new in new },
                        session.merging(["sessionCredential": String(repeating: "x", count: 4097)]) { _, new in new }] {
            XCTAssertThrowsError(try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "fixture",
                method: "presenceLeave", params: invalid))
        }
    }
    func testShareRequestsUseBoundWorkspaceAndOnlyApprovedFields() throws {
        let scope: [String: Any] = ["scopeType": "folder", "scopeKey": "Research/Shared"]
        let list = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "shareList", params: scope)
        XCTAssertEqual(list.url?.absoluteString, "https://texttext.app/api/vault/workspace/shares?scopeType=folder&scopeKey=Research/Shared")
        XCTAssertEqual(list.value(forHTTPHeaderField: "Authorization"), "Bearer app-token")
        XCTAssertEqual(list.httpMethod, "GET")
        let invite = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "shareInvite", params: scope.merging(["email": "reader@example.com", "role": "commenter"]) { _, new in new })
        XCTAssertEqual(invite.httpMethod, "POST")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(invite.httpBody)) as? [String: String])
        XCTAssertEqual(body, ["scopeType": "folder", "scopeKey": "Research/Shared", "email": "reader@example.com", "role": "commenter"])
        let grant = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d"
        let role = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "shareRole", params: scope.merging(["grantId": grant, "role": "viewer"]) { _, new in new })
        XCTAssertEqual(role.httpMethod, "PATCH")
        let revoke = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "shareRevoke", params: scope.merging(["grantId": grant]) { _, new in new })
        XCTAssertEqual(revoke.httpMethod, "DELETE")
        for invalid in [scope.merging(["url": "https://outside.example"]) { _, new in new },
                        ["scopeType": "folder", "scopeKey": "../outside"],
                        scope.merging(["email": "reader@example.com", "role": "owner"]) { _, new in new }] {
            XCTAssertThrowsError(try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
                method: "shareInvite", params: invalid))
        }
    }
    func testCommentRequestsUseBoundItemAndWhitelistedFields() throws {
        let itemId = "item-1"
        let commentId = "0bd05f92-c562-4a78-8c0d-b5e41ca3215d"
        let operationId = "2bd05f92-c562-4a78-8c0d-b5e41ca3215d"
        let read = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "commentsRead", params: ["itemId": itemId, "limit": 100, "after": commentId])
        XCTAssertEqual(read.url?.absoluteString, "https://texttext.app/api/vault/workspace/items/item-1/comments?limit=100&after=\(commentId)")
        XCTAssertEqual(read.value(forHTTPHeaderField: "Authorization"), "Bearer app-token")
        XCTAssertEqual(read.httpMethod, "GET")
        let add = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "commentsAdd", params: ["itemId": itemId, "operationId": operationId, "body": "A useful note", "parentId": commentId])
        XCTAssertEqual(add.httpMethod, "POST")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(add.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["operationId", "body", "parentId"])
        let resolve = try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
            method: "commentsResolve", params: ["itemId": itemId, "operationId": operationId, "commentId": commentId, "resolved": true])
        XCTAssertEqual(resolve.httpMethod, "PATCH")
        let resolution = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(resolve.httpBody)) as? [String: Any])
        XCTAssertEqual(Set(resolution.keys), ["operationId", "commentId", "resolved"])
        for invalid: [String: Any] in [["itemId": itemId, "limit": 101],
                                       ["itemId": itemId, "after": "../other"],
                                       ["itemId": itemId, "operationId": operationId, "body": "", "workspaceId": "forged"],
                                       ["itemId": itemId, "operationId": operationId, "commentId": commentId, "resolved": "yes"]] {
            let method = invalid["resolved"] != nil ? "commentsResolve" : invalid["operationId"] != nil ? "commentsAdd" : "commentsRead"
            XCTAssertThrowsError(try LocalVaultCollaboration.request(origin: origin, workspaceId: "workspace", token: "app-token",
                method: method, params: invalid))
        }
    }
}
