import Foundation
import XCTest

@testable import TextTextFileProviderKit

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

private final class TextTextSyncURLProtocol: URLProtocol {
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

final class LiveTextTextSyncAPITests: XCTestCase {
    override func tearDown() {
        TextTextSyncURLProtocol.handler = nil
        super.tearDown()
    }

    func testCreateFileSendsRepresentationHeader() async throws {
        var capturedRequest: URLRequest?
        TextTextSyncURLProtocol.handler = { request in
            capturedRequest = request
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 201,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"item":{"file":"posts/item.txt","representation":"text","kind":"note","slug":"item","title":"Item","status":"draft","hash":"h","id":"p1"}}"#
                    .utf8)
            return (response, data)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TextTextSyncURLProtocol.self]
        let api = LiveTextTextSyncAPI(
            origin: try XCTUnwrap(URL(string: "https://texttext.example")),
            token: "wsk_test", session: URLSession(configuration: configuration))

        let result = await api.createFile(
            body: "# Item", folderId: "notes", representation: .text,
            idempotencyKey: "create-1")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "TextText-File-Representation"), "text")
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
        TextTextSyncURLProtocol.handler = { request in
            representationHeader = request.value(
                forHTTPHeaderField: "TextText-File-Representation")
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 201,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"item":{"file":"posts/item.md","representation":"markdown","kind":"note","slug":"item","title":"Item","status":"draft","hash":"h","id":"p1"}}"#
                    .utf8)
            return (response, data)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TextTextSyncURLProtocol.self]
        let api = LiveTextTextSyncAPI(
            origin: try XCTUnwrap(URL(string: "https://texttext.example")),
            token: "wsk_test", session: URLSession(configuration: configuration))

        _ = await api.createFile(
            body: "# Item", folderId: "notes", idempotencyKey: nil)

        XCTAssertEqual(representationHeader, "markdown")
    }

    func testAgentUpdateUsesTheCommandRouteWithBoundedMetadata() async throws {
        var capturedRequest: URLRequest?
        var capturedBody: Data?
        TextTextSyncURLProtocol.handler = { request in
            capturedRequest = request
            capturedBody = try requestBodyData(request)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 200,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"content":[{"type":"text","text":"{}"}],"structuredContent":{"item":{"id":"p1","title":"Item","hash":"h2"}}}"#
                    .utf8)
            return (response, data)
        }
        let api = makeAPI()

        let result = await api.agentUpdateItem(
            postId: "p1", markdown: "# Item", ifMatchHash: "h1",
            agentName: "Codex", agentIntent: "Tighten the introduction")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.url?.path, "/api/agent/commands")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "X-TextText-Agent-Name"), "Codex")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "X-TextText-Agent-Intent"),
            "Tighten the introduction")
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(capturedBody))
                as? [String: Any])
        XCTAssertEqual(object["name"] as? String, "update_item")
        let arguments = try XCTUnwrap(object["arguments"] as? [String: String])
        XCTAssertEqual(arguments["id"], "p1")
        XCTAssertEqual(arguments["if_match_hash"], "h1")
        guard case .success(let reply) = result else {
            return XCTFail("agentUpdateItem failed: \(result)")
        }
        XCTAssertEqual(reply.structuredContent?.item?.hash, "h2")
    }

    func testAgentSearchUsesSharedCommandAndDecodesStructuredResults() async throws {
        var capturedBody: Data?
        TextTextSyncURLProtocol.handler = { request in
            capturedBody = try requestBodyData(request)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 200,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"content":[{"type":"text","text":"{}"}],"structuredContent":{"query":"field notes","results":[{"id":"p1","slug":"field-notes","title":"Field notes","kind":"note","status":"draft","hash":"h1","snippet":"Notes from the field.","folder_path":"Notes/Research"}]}}"#.utf8)
            return (response, data)
        }
        let api = makeAPI()

        let result = await api.agentSearchItems(
            query: "field notes", agentName: "Codex", agentIntent: nil)

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(capturedBody))
                as? [String: Any])
        XCTAssertEqual(object["name"] as? String, "search")
        let arguments = try XCTUnwrap(object["arguments"] as? [String: String])
        XCTAssertEqual(arguments, ["query": "field notes"])
        guard case .success(let reply) = result else {
            return XCTFail("agentSearchItems failed: \(result)")
        }
        XCTAssertEqual(reply.structuredContent?.query, "field notes")
        XCTAssertEqual(reply.structuredContent?.results?.first?.id, "p1")
        XCTAssertEqual(reply.structuredContent?.results?.first?.snippet, "Notes from the field.")
        XCTAssertEqual(
            reply.structuredContent?.results?.first?.folderPath,
            "Notes/Research")
    }

    func testAgentCaptureDecodesAuthoritativeReceipt() async throws {
        TextTextSyncURLProtocol.handler = { request in
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 200,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"content":[{"type":"text","text":"{}"}],"structuredContent":{"item":{"id":"p1","title":"Server title","hash":"h1"},"receipt":{"item_id":"p1","kind":"note","saved_to":"Notes/Research","title":"Server title"}}}"#.utf8)
            return (response, data)
        }
        let api = makeAPI()

        let result = await api.agentCaptureItem(
            capture: "Client title", folderPath: nil,
            idempotencyKey: "capture-1", agentName: "Codex",
            agentIntent: nil)

        guard case .success(let reply) = result else {
            return XCTFail("agentCaptureItem failed: \(result)")
        }
        XCTAssertEqual(reply.structuredContent?.receipt?.itemId, "p1")
        XCTAssertEqual(
            reply.structuredContent?.receipt?.savedTo,
            "Notes/Research")
        XCTAssertEqual(reply.structuredContent?.receipt?.title, "Server title")
    }

    func testAgentSectionUpdateSendsGuardedSurgicalArguments() async throws {
        var capturedBody: Data?
        TextTextSyncURLProtocol.handler = { request in
            capturedBody = try requestBodyData(request)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 200,
                    httpVersion: nil, headerFields: nil))
            return (
                response,
                Data(
                    #"{"content":[{"type":"text","text":"{}"}],"structuredContent":{"item":{"id":"p1","title":"Item","hash":"h2"}}}"#
                        .utf8))
        }
        let api = makeAPI()

        _ = await api.agentUpdateItemSection(
            postId: "p1", section: "## Pricing",
            expectedBody: "Ten dollars.", replacementBody: "Twelve dollars.",
            ifMatchHash: "h1", agentName: "Codex",
            agentIntent: "Update pricing")

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(capturedBody))
                as? [String: Any])
        XCTAssertEqual(object["name"] as? String, "update_item")
        let arguments = try XCTUnwrap(object["arguments"] as? [String: String])
        XCTAssertEqual(arguments["section"], "## Pricing")
        XCTAssertEqual(arguments["expected_section_body"], "Ten dollars.")
        XCTAssertEqual(arguments["body"], "Twelve dollars.")
        XCTAssertEqual(arguments["if_match_hash"], "h1")
    }

    func testTextPackReadRequestsAndDecodesStructuredDocument() async throws {
        var acceptHeader: String?
        TextTextSyncURLProtocol.handler = { request in
            acceptHeader = request.value(forHTTPHeaderField: "Accept")
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 200,
                    httpVersion: nil, headerFields: ["ETag": "\"document-hash\""]))
            let data = Data(
                ##"{"schema":"texttext.sync-document.v1","markdown":"# Hello","document":{"schema":1,"content":{"body":"Hello"}}}"##
                    .utf8)
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
        TextTextSyncURLProtocol.handler = { request in
            capturedRequest = request
            capturedBody = try requestBodyData(request)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 201,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"item":{"file":"posts/item.textpack","representation":"textpack","kind":"note","slug":"item","title":"Item","status":"draft","hash":"markdown-hash","documentHash":"document-hash","id":"p1"}}"#
                    .utf8)
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
        TextTextSyncURLProtocol.handler = { request in
            capturedRequest = request
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: 200,
                    httpVersion: nil, headerFields: nil))
            let data = Data(
                #"{"item":{"file":"posts/item.textpack","representation":"textpack","kind":"note","slug":"item","title":"Item","status":"draft","hash":"markdown-hash","documentHash":"next-document-hash","id":"p1"}}"#
                    .utf8)
            return (response, data)
        }
        let api = makeAPI()

        _ = await api.putFile(
            postId: "p1", body: "# Item",
            documentJSON: #"{"schema":1,"content":{"body":"Next"}}"#,
            ifMatch: "base-document-hash")

        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "If-Match"),
            "\"base-document-hash\"")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Content-Type"),
            "application/vnd.texttext.document+json")
    }

    private func makeAPI() -> LiveTextTextSyncAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TextTextSyncURLProtocol.self]
        return LiveTextTextSyncAPI(
            origin: URL(string: "https://texttext.example")!, token: "wsk_test",
            session: URLSession(configuration: configuration))
    }
}
