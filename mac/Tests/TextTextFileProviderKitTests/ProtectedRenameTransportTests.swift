import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class ProtectedRenameTransportTests: XCTestCase {
    private let command = LocalVaultProtectedRenameRequest(operationId: "11111111-1111-4111-8111-111111111111", itemId: "fixture-item", source: "Old.textpack", destination: "New.textpack", baseRevision: String(repeating: "a", count: 64))
    func testTypedMovedAndConflictReceiptsBindCommandAndScope() async throws {
        for status in [200, 409] {
            let body: [String: Any] = ["status": status == 200 ? "moved" : "conflict", "itemId": command.itemId, "relativePath": status == 200 ? command.destination : "Other.textpack", "revision": command.baseRevision]
            let receipt = try await response(status, body)
            XCTAssertEqual(receipt.request, command)
            XCTAssertEqual(receipt.scope.origin, "https://protected-rename.test")
            XCTAssertEqual(receipt.scope.workspaceId, "fixture")
            XCTAssertEqual(receipt.scope.accountId, "fixture-account")
            XCTAssertEqual(receipt.status, status == 200 ? "moved" : "conflict")
        }
    }
    func testStrictConflictNullRevisionAndDeletedTrue() async throws {
        let receipt = try await response(409, ["status": "conflict", "itemId": command.itemId, "relativePath": "Retired.textpack", "revision": NSNull(), "deleted": true])
        XCTAssertTrue(receipt.deleted); XCTAssertNil(receipt.revision)
    }
    func testMalformedAndGenericRepliesRemainAmbiguous() async throws {
        let valid: [String: Any] = ["status": "moved", "itemId": command.itemId, "relativePath": command.destination, "revision": command.baseRevision]
        let changes: [[String: Any]] = [
            ["future": true], ["status": "deleted"], ["Status": "moved"], ["itemId": "other"],
            ["relativePath": "Other.textpack"], ["relativePath": "../Escape.textpack"],
            ["revision": String(repeating: "b", count: 64)], ["revision": NSNull()], ["deleted": false]
        ]
        for change in changes {
            do { _ = try await response(200, valid.merging(change) { _, new in new }); XCTFail("Accepted malformed moved receipt") } catch { }
        }
        for status in [201, 204, 401, 403, 409, 412, 500] {
            do { _ = try await response(status, ["error": "conflict"]); XCTFail("Accepted generic HTTP result") } catch { }
        }
        do { _ = try await response(200, valid, replyURL: URL(string: "https://other.test/api/vault/fixture/items/fixture-item")!); XCTFail("Cross-endpoint receipt accepted") } catch { }
        for deleted in [false, 1, "true"] as [Any] {
            do { _ = try await response(409, ["status": "conflict", "itemId": command.itemId, "relativePath": command.source, "revision": NSNull(), "deleted": deleted]); XCTFail("Accepted non-true flag") } catch { }
        }
    }
    func testDuplicateKeysOversizeAndNoncanonicalHashesRefuse() throws {
        let scope = LocalVaultProtectedRenameScope(origin: "https://protected-rename.test", workspaceId: "fixture", accountId: "fixture-account")
        let duplicate = "{\"status\":\"moved\",\"status\":\"moved\",\"itemId\":\"fixture-item\",\"relativePath\":\"New.textpack\",\"revision\":\"\(command.baseRevision)\"}"
        XCTAssertThrowsError(try HTTPLocalVaultSyncTransport.parseProtectedRename(command, scope: scope, status: 200, data: Data(duplicate.utf8)))
        let trailingComma = "{\"status\":\"moved\",\"itemId\":\"fixture-item\",\"relativePath\":\"New.textpack\",\"revision\":\"\(command.baseRevision)\",}"
        XCTAssertThrowsError(try HTTPLocalVaultSyncTransport.parseProtectedRename(command, scope: scope, status: 200, data: Data(trailingComma.utf8)))
        XCTAssertThrowsError(try HTTPLocalVaultSyncTransport.parseProtectedRename(command, scope: scope, status: 200, data: Data(repeating: 32, count: 16385)))
        let ownerless = LocalVaultProtectedRenameScope(origin: scope.origin, workspaceId: scope.workspaceId, accountId: nil)
        let moved = try JSONSerialization.data(withJSONObject: ["status": "moved", "itemId": command.itemId, "relativePath": command.destination, "revision": command.baseRevision])
        XCTAssertThrowsError(try HTTPLocalVaultSyncTransport.parseProtectedRename(command, scope: ownerless, status: 200, data: moved))
        for revision in [command.baseRevision + "\n", command.baseRevision.uppercased()] {
            let data = try JSONSerialization.data(withJSONObject: ["status": "conflict", "itemId": command.itemId, "relativePath": command.source, "revision": revision])
            XCTAssertThrowsError(try HTTPLocalVaultSyncTransport.parseProtectedRename(command, scope: scope, status: 409, data: data))
        }
    }
    func testOwnerlessTransportRefusesBeforeSending() async throws {
        let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://protected-rename.test")!, workspaceId: "fixture", token: "fixture-not-a-credential")
        do { _ = try await transport.protectedRename(command); XCTFail("Ownerless command accepted") }
        catch LocalVaultSharedFailure.account { }
    }
    func testCredentialRotationDuringResponseAndLostReplyRemainAmbiguous() async throws {
        let data = try JSONSerialization.data(withJSONObject: ["status": "moved", "itemId": command.itemId, "relativePath": command.destination, "revision": command.baseRevision])
        let started = expectation(description: "Original PATCH is held")
        ProtectedRenameURLProtocol.install(status: 200, data: data, hold: true, started: { started.fulfill() })
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ProtectedRenameURLProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://protected-rename.test")!, workspaceId: "fixture", token: "fixture-original", session: session, accountId: "fixture-account")
        let task = Task { try await transport.protectedRename(command) }
        await fulfillment(of: [started], timeout: 2)
        try await transport.updateToken("fixture-rotated", accountId: "fixture-account")
        ProtectedRenameURLProtocol.release()
        do { _ = try await task.value; XCTFail("Stale credential reply accepted") }
        catch LocalVaultSharedFailure.account { }
        ProtectedRenameURLProtocol.install(status: 200, data: data, fail: true)
        do { _ = try await transport.protectedRename(command); XCTFail("Lost reply accepted") }
        catch let error as URLError { XCTAssertEqual(error.code, .networkConnectionLost) }
    }
    private func response(_ status: Int, _ body: [String: Any], replyURL: URL? = nil) async throws -> LocalVaultProtectedRenameReceipt {
        let data = try JSONSerialization.data(withJSONObject: body)
        ProtectedRenameURLProtocol.install(status: status, data: data, replyURL: replyURL)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ProtectedRenameURLProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://protected-rename.test")!, workspaceId: "fixture", token: "fixture-not-a-credential", session: session, accountId: "fixture-account")
        return try await transport.protectedRename(command)
    }
}
private final class ProtectedRenameURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var reply: (status: Int, data: Data, hold: Bool, fail: Bool, started: (@Sendable () -> Void)?, url: URL?) = (500, Data(), false, false, nil, nil)
    nonisolated(unsafe) private static var pending: ProtectedRenameURLProtocol?
    static func install(status: Int, data: Data, hold: Bool = false, fail: Bool = false, started: (@Sendable () -> Void)? = nil, replyURL: URL? = nil) {
        lock.lock(); reply = (status, data, hold, fail, started, replyURL); pending = nil; lock.unlock()
    }
    static func release() { lock.lock(); let request = pending; pending = nil; lock.unlock(); request?.finish() }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "protected-rename.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let reply = Self.reply; Self.lock.unlock()
        if reply.fail { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
        if reply.hold { Self.lock.lock(); Self.pending = self; Self.lock.unlock(); reply.started?(); return }
        finish()
    }
    private func finish() {
        Self.lock.lock(); let reply = Self.reply; Self.lock.unlock()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: reply.url ?? request.url!, statusCode: reply.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
