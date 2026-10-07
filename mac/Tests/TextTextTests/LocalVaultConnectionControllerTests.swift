import XCTest
@testable import TextTextApp

final class LocalVaultConnectionControllerTests: XCTestCase {
    @MainActor
    func testCredentialRefreshKeepsSyncActorAndUsesNewToken() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CredentialRefreshProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        var token = "fixture-before"
        let connection = LocalVaultConnectionController(root: root, session: session,
            credentials: { (URL(string: "https://texttext.test")!, token) })
        defer { connection.stop() }
        _ = try await connection.connect()
        let engine = try XCTUnwrap(connection.collaborationEngine)
        token = "fixture-after"
        let refreshed = expectation(description: "credentials refreshed")
        connection.onChange = { status, _ in
            if status["connecting"] as? Bool == false { refreshed.fulfill() }
        }
        connection.credentialsChanged()
        await fulfillment(of: [refreshed], timeout: 3)
        connection.onChange = nil
        XCTAssertTrue(connection.collaborationEngine === engine, "Credential renewal must preserve active shared editing sessions")
        // The real transport rejects the old token after discovery of the new
        // token. A successful manifest proves the existing actor was updated.
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, report.errors.joined(separator: ", "))
    }

    @MainActor
    func testSuccessfulIdleWatchClearsOnlyWatchFailureOnce() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let connection = LocalVaultConnectionController(root: root, credentials: { nil })
        let retry = "Changes are saved on this Mac. The web connection will retry."
        var notices: [String?] = []
        connection.onChange = { status, changed in
            XCTAssertFalse(changed)
            notices.append(status["message"] as? String)
        }

        connection.watchDidFail()
        connection.watchDidFail()
        XCTAssertEqual(connection.message, retry)
        XCTAssertEqual(notices, [retry])
        connection.watchDidSucceed() // A 304 unchanged wait is still a successful connection.
        connection.watchDidSucceed()
        XCTAssertNil(connection.message)
        XCTAssertEqual(notices, [retry, nil])

        connection.recordSyncMessage("A sync error")
        connection.watchDidFail()
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, "A sync error")
        XCTAssertEqual(notices.count, 2)
        connection.recordSyncMessage("Conflicting edits were kept in recovery copies.")
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, "Conflicting edits were kept in recovery copies.")
        connection.recordSyncMessage(retry) // The sync failure can use the same copy.
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, retry)
        XCTAssertEqual(notices.count, 2)

        connection.recordSyncMessage(nil)
        connection.watchDidFail()
        connection.watchDidSucceed()
        XCTAssertEqual(notices, [retry, nil, retry, nil])
    }
}

private final class CredentialRefreshProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var expectedToken = "Bearer fixture-before"
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "texttext.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let token = request.value(forHTTPHeaderField: "Authorization")
        let discovery = request.url?.path == "/api/vault"
        Self.lock.lock()
        if discovery, let token { Self.expectedToken = token }
        let authorized = token == Self.expectedToken
        Self.lock.unlock()
        if request.url?.query?.contains("wait=") == true { return }
        let response = HTTPURLResponse(url: request.url!, statusCode: authorized ? 200 : 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((discovery ? "{\"workspaceId\":\"workspace\"}" : "{\"items\":[]}").utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
