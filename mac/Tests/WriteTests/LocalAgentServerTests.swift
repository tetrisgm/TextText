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
}
