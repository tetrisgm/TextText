import Foundation
import XCTest
@testable import Write

final class LocalAgentServerTests: XCTestCase {
    func testParsesCompleteLoopbackRequest() throws {
        let data = Data(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:47118\r\nContent-Length: 2\r\n\r\n{}".utf8)

        let request = try XCTUnwrap(LocalAgentHTTPRequest.parse(data))

        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.path, "/mcp")
        XCTAssertEqual(request.body, Data("{}".utf8))
        XCTAssertTrue(request.isLoopbackHost)
    }

    func testRejectsNonLoopbackHost() throws {
        let data = Data(
            "GET /health HTTP/1.1\r\nHost: texttext.app\r\n\r\n".utf8)

        let request = try XCTUnwrap(LocalAgentHTTPRequest.parse(data))

        XCTAssertFalse(request.isLoopbackHost)
    }

    func testWaitsForCompleteBody() {
        let data = Data(
            "POST /mcp HTTP/1.1\r\nHost: localhost:47118\r\nContent-Length: 4\r\n\r\n{}".utf8)

        XCTAssertNil(LocalAgentHTTPRequest.parse(data))
    }

    func testResponseUsesValidHTTPFraming() {
        let data = LocalAgentHTTPResponse.json(["ok": true]).encoded()
        let value = String(decoding: data, as: UTF8.self)

        XCTAssertTrue(value.hasPrefix("HTTP/1.1 200 OK\r\n"))
        XCTAssertTrue(value.contains("\r\nContent-Type: application/json\r\n"))
        XCTAssertTrue(value.contains("\r\n\r\n{\"ok\":true}"))
    }

    func testEndpointIsStableAndLoopbackOnly() {
        XCTAssertEqual(LocalAgentServer.port, 47_118)
        XCTAssertEqual(LocalAgentServer.endpoint, "http://127.0.0.1:47118/mcp")
    }

    // MARK: - Agent identity transport

    private func request(
        sessionId: String? = nil,
        userAgent: String? = nil
    ) -> LocalAgentHTTPRequest {
        var headers = ["host": "127.0.0.1:47118"]
        if let sessionId { headers["mcp-session-id"] = sessionId }
        if let userAgent { headers["user-agent"] = userAgent }
        return LocalAgentHTTPRequest(
            method: "POST", path: "/mcp", headers: headers, body: Data())
    }

    func testKeysIdentityBySessionWhenPresent() {
        let keyed = LocalAgentServer.identityKey(
            for: request(sessionId: "abc", userAgent: "codex/1.0"))
        let other = LocalAgentServer.identityKey(
            for: request(sessionId: "xyz", userAgent: "codex/1.0"))

        XCTAssertEqual(keyed, "session:abc")
        XCTAssertNotEqual(keyed, other)
    }

    func testFallsBackToUserAgentKeyWithoutSession() {
        XCTAssertEqual(
            LocalAgentServer.identityKey(for: request(userAgent: "claude/2.0")),
            "agent:claude/2.0")
    }

    func testPrefersClientInfoNameOverUserAgent() {
        let name = LocalAgentServer.clientName(
            clientInfo: ["name": "codex-cli", "version": "1.2.3"],
            request: request(userAgent: "node-fetch/1.0"))

        XCTAssertEqual(name, "codex-cli")
    }

    func testFallsBackToUserAgentWhenClientInfoIsMissingOrBlank() {
        XCTAssertEqual(
            LocalAgentServer.clientName(
                clientInfo: nil, request: request(userAgent: "claude-code/2.0")),
            "claude-code/2.0")
        XCTAssertEqual(
            LocalAgentServer.clientName(
                clientInfo: ["name": "   "],
                request: request(userAgent: "claude-code/2.0")),
            "claude-code/2.0")
        XCTAssertNil(
            LocalAgentServer.clientName(clientInfo: nil, request: request()))
    }

    @MainActor
    func testRemembersClientInfoForLaterToolCalls() {
        let server = LocalAgentServer()
        let call = request(sessionId: "abc", userAgent: "node-fetch/1.0")
        server.rememberIdentity(
            clientInfo: ["name": "codex-cli", "version": "1.2.3"],
            request: call)

        let identity = server.identity(for: call)

        XCTAssertEqual(identity?.clientName, "codex-cli")
        XCTAssertEqual(identity?.clientVersion, "1.2.3")
        XCTAssertEqual(identity?.connectionName, "codex-cli")
    }

    @MainActor
    func testKeepsTwoAgentIdentitiesSeparate() {
        let server = LocalAgentServer()
        let codex = request(sessionId: "codex-session")
        let claude = request(sessionId: "claude-session")
        server.rememberIdentity(clientInfo: ["name": "codex-cli"], request: codex)
        server.rememberIdentity(
            clientInfo: ["name": "Claude Code"], request: claude)

        XCTAssertEqual(server.identity(for: codex)?.clientName, "codex-cli")
        XCTAssertEqual(server.identity(for: claude)?.clientName, "Claude Code")
    }

    @MainActor
    func testDerivesIdentityFromUserAgentWhenInitializeWasNeverSeen() {
        let server = LocalAgentServer()

        let identity = server.identity(for: request(userAgent: "codex/1.0"))

        XCTAssertEqual(identity?.clientName, "codex/1.0")
        XCTAssertNil(identity?.clientVersion)
    }

    @MainActor
    func testReturnsNoIdentityWhenTheClientIsAnonymous() {
        let server = LocalAgentServer()

        XCTAssertNil(server.identity(for: request()))
    }

    @MainActor
    func testBoundsTheIdentityCache() {
        let server = LocalAgentServer()
        let overflow = LocalAgentServer.identityCacheLimit + 20
        for index in 0..<overflow {
            server.rememberIdentity(
                clientInfo: ["name": "agent-\(index)"],
                request: request(sessionId: "session-\(index)"))
        }

        // The newest entry survives; the cache never exceeds its limit.
        XCTAssertEqual(
            server.identity(for: request(sessionId: "session-\(overflow - 1)"))?
                .clientName,
            "agent-\(overflow - 1)")
        XCTAssertNil(
            server.identity(for: request(sessionId: "session-0")))
    }

    func testActorPayloadCarriesTheConnectionName() {
        let withVersion = LocalAgentIdentity(
            clientName: "codex-cli", clientVersion: "1.2.3", recordedAt: Date())
        let payload = withVersion.actorPayload()

        XCTAssertEqual(payload["connectionName"] as? String, "codex-cli")
        XCTAssertEqual(payload["clientName"] as? String, "codex-cli")
        XCTAssertEqual(payload["clientVersion"] as? String, "1.2.3")

        let withoutVersion = LocalAgentIdentity(
            clientName: "Claude Code", clientVersion: nil, recordedAt: Date())
        XCTAssertNil(withoutVersion.actorPayload()["clientVersion"])
    }
}
