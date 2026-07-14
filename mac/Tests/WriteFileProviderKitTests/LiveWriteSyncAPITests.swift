import Foundation
import XCTest
@testable import WriteFileProviderKit

private final class WriteSyncURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(
                self, didFailWithError: URLError(.resourceUnavailable))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(
                self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class LiveWriteSyncAPITests: XCTestCase {
    override func tearDown() {
        WriteSyncURLProtocol.handler = nil
        super.tearDown()
    }

    func testCreateFileSendsRepresentationHeader() async throws {
        var capturedRequest: URLRequest?
        WriteSyncURLProtocol.handler = { request in
            capturedRequest = request
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 201,
                httpVersion: nil, headerFields: nil))
            let data = Data(#"{"item":{"file":"posts/item.txt","representation":"text","kind":"note","slug":"item","title":"Item","status":"draft","hash":"h","id":"p1"}}"#.utf8)
            return (response, data)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WriteSyncURLProtocol.self]
        let api = LiveWriteSyncAPI(
            origin: try XCTUnwrap(URL(string: "https://write.example")),
            token: "wsk_test", session: URLSession(configuration: configuration))

        let result = await api.createFile(
            body: "# Item", folderId: "notes", representation: .text,
            idempotencyKey: "create-1")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Write-File-Representation"), "text")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "create-1")
        XCTAssertEqual(request.url?.path, "/api/sync/v1/files")
        XCTAssertEqual(request.url?.query, "folder=notes")
        guard case .success(let item) = result else {
            return XCTFail("createFile failed: \(result)")
        }
        XCTAssertEqual(item.representation, .text)
    }

    func testLegacyCreateSendsMarkdownRepresentationHeader() async throws {
        var representationHeader: String?
        WriteSyncURLProtocol.handler = { request in
            representationHeader = request.value(
                forHTTPHeaderField: "Write-File-Representation")
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 201,
                httpVersion: nil, headerFields: nil))
            let data = Data(#"{"item":{"file":"posts/item.md","representation":"markdown","kind":"note","slug":"item","title":"Item","status":"draft","hash":"h","id":"p1"}}"#.utf8)
            return (response, data)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WriteSyncURLProtocol.self]
        let api = LiveWriteSyncAPI(
            origin: try XCTUnwrap(URL(string: "https://write.example")),
            token: "wsk_test", session: URLSession(configuration: configuration))

        _ = await api.createFile(
            body: "# Item", folderId: "notes", idempotencyKey: nil)

        XCTAssertEqual(representationHeader, "markdown")
    }
}
