import Foundation
import XCTest
@testable import WriteFileProviderKit

private func requestBodyData(_ request: URLRequest) throws -> Data {
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

    func testTextPackReadRequestsAndDecodesStructuredDocument() async throws {
        var acceptHeader: String?
        WriteSyncURLProtocol.handler = { request in
            acceptHeader = request.value(forHTTPHeaderField: "Accept")
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200,
                httpVersion: nil, headerFields: ["ETag": "\"document-hash\""]))
            let data = Data(##"{"schema":"texttext.sync-document.v1","markdown":"# Hello","document":{"schema":1,"content":{"body":"Hello"}}}"##.utf8)
            return (response, data)
        }
        let api = makeAPI()

        let result = await api.fileContent(postId: "p1", representation: .textpack)

        XCTAssertEqual(
            acceptHeader, "application/vnd.texttext.document+json")
        guard case .success(let content) = result else {
            return XCTFail("fileContent failed: \(result)")
        }
        XCTAssertEqual(content.text, "# Hello")
        XCTAssertEqual(content.hash, "document-hash")
        XCTAssertTrue(content.documentJSON?.contains("\"schema\" : 1") == true)
    }

    func testTextPackCreateSendsStructuredDocumentEnvelope() async throws {
        var capturedRequest: URLRequest?
        var capturedBody: Data?
        WriteSyncURLProtocol.handler = { request in
            capturedRequest = request
            capturedBody = try requestBodyData(request)
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 201,
                httpVersion: nil, headerFields: nil))
            let data = Data(#"{"item":{"file":"posts/item.textpack","representation":"textpack","kind":"note","slug":"item","title":"Item","status":"draft","hash":"markdown-hash","documentHash":"document-hash","id":"p1"}}"#.utf8)
            return (response, data)
        }
        let api = makeAPI()

        let result = await api.createFile(
            body: "# Item", documentJSON: #"{"schema":1,"content":{"body":"Item"}}"#,
            folderId: "notes", representation: .textpack,
            idempotencyKey: "create-doc")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Content-Type"),
            "application/vnd.texttext.document+json")
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(capturedBody))
                as? [String: Any])
        XCTAssertEqual(object["schema"] as? String, "texttext.sync-document.v1")
        XCTAssertEqual(object["markdown"] as? String, "# Item")
        XCTAssertNotNil(object["document"] as? [String: Any])
        guard case .success(let item) = result else {
            return XCTFail("createFile failed: \(result)")
        }
        XCTAssertEqual(item.contentHash(), "document-hash")
    }

    func testStructuredPutUsesDocumentHashAsIfMatch() async throws {
        var capturedRequest: URLRequest?
        WriteSyncURLProtocol.handler = { request in
            capturedRequest = request
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200,
                httpVersion: nil, headerFields: nil))
            let data = Data(#"{"item":{"file":"posts/item.textpack","representation":"textpack","kind":"note","slug":"item","title":"Item","status":"draft","hash":"markdown-hash","documentHash":"next-document-hash","id":"p1"}}"#.utf8)
            return (response, data)
        }
        let api = makeAPI()

        _ = await api.putFile(
            postId: "p1", body: "# Item",
            documentJSON: #"{"schema":1,"content":{"body":"Next"}}"#,
            ifMatch: "base-document-hash")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.value(forHTTPHeaderField: "If-Match"),
                       "\"base-document-hash\"")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Content-Type"),
            "application/vnd.texttext.document+json")
    }

    private func makeAPI() -> LiveWriteSyncAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WriteSyncURLProtocol.self]
        return LiveWriteSyncAPI(
            origin: URL(string: "https://write.example")!, token: "wsk_test",
            session: URLSession(configuration: configuration))
    }
}
