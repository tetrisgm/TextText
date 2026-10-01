import Foundation
import XCTest

@testable import TextTextCLICore

private func agentPresenceRequestBody(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else {
        throw URLError(.cannotDecodeContentData)
    }
    stream.open()
    defer { stream.close() }
    var body = Data()
    var buffer = [UInt8](repeating: 0, count: 4_096)
    while true {
        let count = buffer.withUnsafeMutableBufferPointer { pointer in
            stream.read(pointer.baseAddress!, maxLength: pointer.count)
        }
        if count == 0 { break }
        if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeContentData) }
        body.append(contentsOf: buffer.prefix(count))
    }
    return body
}

private final class AgentPresenceURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> Void)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.handler?(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"ok":true}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class AgentPresenceTests: XCTestCase {
    override func tearDown() {
        AgentPresenceURLProtocol.handler = nil
        super.tearDown()
    }

    func testPresencePublishesNoDocumentContentPathOrIntent() async throws {
        var captured: URLRequest?
        AgentPresenceURLProtocol.handler = { captured = $0 }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AgentPresenceURLProtocol.self]
        let publisher = PresencePublisher(
            credentials: DeviceCredentials(token: "wsk_test", serverOrigin: "https://texttext.example"),
            session: URLSession(configuration: configuration))
        let actor = AgentActor(name: "Codex", activity: .edit, section: "Summary",
            message: "Secret prompt and document content", itemId: "item-1")

        await publisher.publish(document: "Private/Plan.textpack", actor: actor, active: true)

        let request = try XCTUnwrap(captured)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(
            with: try agentPresenceRequestBody(request)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["active", "activity", "agent", "itemId", "section"])
        XCTAssertEqual(body["itemId"] as? String, "item-1")
        XCTAssertEqual(body["agent"] as? String, "Codex")
        XCTAssertEqual(body["section"] as? String, "Summary")
        XCTAssertEqual(request.url?.path, "/api/agent/presence")
    }
}
