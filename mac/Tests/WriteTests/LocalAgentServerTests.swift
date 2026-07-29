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

    // MARK: - Transport guard (Tier 0)
    //
    // These exercise LocalAgentServer.rejection(for:) directly, which is the
    // real code the server runs. Loopback binding authenticates nothing: every
    // browser on this Mac can reach the port, so what must hold is that
    // browser-shaped requests never reach the tool dispatcher.

    private func parse(_ raw: String) throws -> LocalAgentHTTPRequest {
        try XCTUnwrap(LocalAgentHTTPRequest.parse(Data(raw.utf8)))
    }

    private var host: String { "127.0.0.1:\(LocalAgentServer.port)" }

    private func agentPost(
        extraHeaders: String = "",
        contentType: String = "application/json"
    ) throws -> LocalAgentHTTPRequest {
        try parse(
            "POST /mcp HTTP/1.1\r\nHost: \(host)\r\n\(extraHeaders)Content-Type: \(contentType)\r\nContent-Length: 2\r\n\r\n{}")
    }

    func testAdmitsANormalAgentRequest() throws {
        XCTAssertNil(LocalAgentServer.rejection(for: try agentPost()))
    }

    func testAdmitsJSONContentTypeWithParameters() throws {
        let request = try agentPost(contentType: "application/json; charset=utf-8")
        XCTAssertNil(LocalAgentServer.rejection(for: request))
    }

    func testRefusesAnyRequestCarryingOrigin() throws {
        // A page cannot remove Origin: it is a forbidden header name.
        let request = try agentPost(
            extraHeaders: "Origin: https://evil.example\r\n")
        XCTAssertEqual(LocalAgentServer.rejection(for: request)?.status, 403)
    }

    func testRefusesCrossSiteFetchMetadata() throws {
        for site in ["cross-site", "same-origin", "same-site"] {
            let request = try agentPost(
                extraHeaders: "Sec-Fetch-Site: \(site)\r\n")
            XCTAssertEqual(
                LocalAgentServer.rejection(for: request)?.status, 403,
                "Sec-Fetch-Site: \(site) must be refused")
        }
    }

    func testAllowsUserTypedNavigation() throws {
        // Sec-Fetch-Site: none is a typed URL, which no page can produce, so a
        // human can still open /health in a browser.
        let request = try parse(
            "GET /health HTTP/1.1\r\nHost: \(host)\r\nSec-Fetch-Site: none\r\n\r\n")
        XCTAssertNil(LocalAgentServer.rejection(for: request))
    }

    func testRefusesCORSSafelistedContentTypes() throws {
        // These skip the preflight, which is exactly how a page reached the
        // tool dispatcher before this guard existed.
        for type in ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"] {
            let request = try agentPost(contentType: type)
            XCTAssertEqual(
                LocalAgentServer.rejection(for: request)?.status, 415,
                "\(type) must be refused")
        }
    }

    func testRefusesMissingContentType() throws {
        let request = try parse(
            "POST /mcp HTTP/1.1\r\nHost: \(host)\r\nContent-Length: 2\r\n\r\n{}")
        XCTAssertEqual(LocalAgentServer.rejection(for: request)?.status, 415)
    }

    func testAnswersPreflightWith405AndNoCORSHeaders() throws {
        let request = try parse("OPTIONS /mcp HTTP/1.1\r\nHost: \(host)\r\n\r\n")
        let rejection = try XCTUnwrap(LocalAgentServer.rejection(for: request))

        XCTAssertEqual(rejection.status, 405)
        XCTAssertEqual(rejection.headers["Allow"], "GET, POST")
        let text = String(decoding: rejection.encoded(), as: UTF8.self)
        XCTAssertFalse(text.lowercased().contains("access-control-"))
    }

    func testNoResponseEverCarriesCORSHeaders() throws {
        let ok = LocalAgentHTTPResponse.json(["ok": true]).encoded()
        XCTAssertFalse(
            String(decoding: ok, as: UTF8.self).lowercased()
                .contains("access-control-"))
    }

    func testRefusesLoopbackHostName() throws {
        // Numeric only, and the 403 names the fix for a hand-typed config.
        let request = try parse(
            "POST /mcp HTTP/1.1\r\nHost: localhost:\(LocalAgentServer.port)\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
        let rejection = try XCTUnwrap(LocalAgentServer.rejection(for: request))

        XCTAssertEqual(rejection.status, 403)
        XCTAssertTrue(request.usesLoopbackName)
        // JSONSerialization escapes forward slashes, so match the actionable
        // part of the endpoint rather than the whole URL.
        let body = String(decoding: rejection.encoded(), as: UTF8.self)
        XCTAssertTrue(body.contains("127.0.0.1:\(LocalAgentServer.port)"))
        XCTAssertTrue(body.contains("rather than a host name"))
    }

    func testBrowserCheckPrecedesHostCheck() throws {
        // A browser must learn nothing about the host policy.
        let request = try parse(
            "POST /mcp HTTP/1.1\r\nHost: localhost:\(LocalAgentServer.port)\r\nOrigin: https://evil.example\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
        let text = String(
            decoding: try XCTUnwrap(LocalAgentServer.rejection(for: request)).encoded(),
            as: UTF8.self)
        XCTAssertTrue(text.contains("does not accept browser requests"))
    }

    // MARK: - Connection limiting and deadlines

    func testConnectionLimiterBoundsConcurrency() {
        let limiter = LocalAgentConnectionLimiter(limit: 2)

        XCTAssertTrue(limiter.acquire())
        XCTAssertTrue(limiter.acquire())
        XCTAssertFalse(limiter.acquire())
        limiter.release()
        XCTAssertTrue(limiter.acquire())
        XCTAssertEqual(limiter.activeCount, 2)
    }

    func testConnectionLimiterNeverGoesNegative() {
        let limiter = LocalAgentConnectionLimiter(limit: 1)
        limiter.release()
        limiter.release()
        XCTAssertEqual(limiter.activeCount, 0)
        XCTAssertTrue(limiter.acquire())
        XCTAssertFalse(limiter.acquire())
    }

    func testServerDeclaresADeadlineAndAConnectionCap() {
        XCTAssertGreaterThan(LocalAgentServer.requestTimeout, 0)
        XCTAssertGreaterThan(LocalAgentServer.maxConcurrentConnections, 0)
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
