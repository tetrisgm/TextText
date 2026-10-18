import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultFolderCaseHTTPTests: XCTestCase {
    func testAdvertisedOwnerContextUsesActualHTTPWireAndDisappearsOnDowngrade() async throws {
        let state = FolderCaseHTTPState()
        FolderCaseURLProtocol.install { request in try state.reply(request) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [FolderCaseURLProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); FolderCaseURLProtocol.install(nil) }
        let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://folder-case.test")!, workspaceId: "fixture", token: "fixture-only", session: session, accountId: "account-a")
        _ = try await transport.manifest(); let context = await transport.folderCaseContext(); XCTAssertEqual(context?.manifestRevision, String(repeating: "a", count: 64))
        let command = LocalVaultFolderCaseRequest(operationId: UUID().uuidString, source: "Case", destination: "CASE", baseManifestRevision: String(repeating: "a", count: 64), folders: ["Case"], items: [])
        let receipt = try await transport.moveFolderCase(command); XCTAssertEqual(receipt.operationId, command.operationId); XCTAssertEqual(receipt.folders, ["CASE"])
        state.downgrade(); _ = try await transport.manifest(); let unavailable = await transport.folderCaseContext(); XCTAssertNil(unavailable)
        do { _ = try await transport.moveFolderCase(command); XCTFail("No new command without advertised owner capability") } catch LocalVaultSyncFailure.invalidResponse { }
        XCTAssertEqual(state.moves(), 1)
    }
    func testFutureReceiptFieldsRefuseRatherThanInventSuccess() async throws {
        let state = FolderCaseHTTPState(); state.future()
        FolderCaseURLProtocol.install { request in try state.reply(request) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [FolderCaseURLProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); FolderCaseURLProtocol.install(nil) }
        let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://folder-case.test")!, workspaceId: "fixture", token: "fixture-only", session: session, accountId: "account-a")
        _ = try await transport.manifest()
        let command = LocalVaultFolderCaseRequest(operationId: UUID().uuidString, source: "Case", destination: "CASE", baseManifestRevision: String(repeating: "a", count: 64), folders: ["Case"], items: [])
        do { _ = try await transport.moveFolderCase(command); XCTFail("Unknown receipt field must refuse") } catch LocalVaultSyncFailure.invalidResponse { }
    }
}
private final class FolderCaseHTTPState: @unchecked Sendable {
    private let lock = NSLock(); private var owner = true, unknown = false, count = 0
    func downgrade() { lock.lock(); owner = false; lock.unlock() }
    func future() { lock.lock(); unknown = true; lock.unlock() }
    func moves() -> Int { lock.lock(); defer { lock.unlock() }; return count }
    func reply(_ request: URLRequest) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        guard request.value(forHTTPHeaderField: "X-TextText-Account") == "account-a" else { throw LocalVaultSyncFailure.invalidResponse }
        if request.url!.path.hasSuffix("/items") {
            var fields: [String: Any] = ["items": [], "folders": ["Case"], "fullAccess": true, "canCreateContent": true, "writableFolders": []]
            if owner { fields["manifestRevision"] = String(repeating: "a", count: 64); fields["syncCapabilities"] = ["folder-case-moves-v1"] }
            return try JSONSerialization.data(withJSONObject: fields)
        }
        guard request.httpMethod == "POST", request.url!.path == "/api/vault/fixture/folder-case-moves" else { throw LocalVaultSyncFailure.invalidResponse }
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); guard count >= 0 else { throw LocalVaultSyncFailure.invalidResponse }; if count == 0 { break }; body.append(buffer, count: count); guard body.count <= 4 * 1024 * 1024 else { throw LocalVaultSyncFailure.invalidResponse } }
        }
        let command = try JSONDecoder().decode(LocalVaultFolderCaseRequest.self, from: body); count += 1
        var fields: [String: Any] = ["operationId": command.operationId, "status": "moved", "source": command.source, "destination": command.destination, "manifestRevision": String(repeating: "b", count: 64), "folders": ["CASE"], "items": []]
        if unknown { fields["future"] = true }; return try JSONSerialization.data(withJSONObject: fields)
    }
}
private final class FolderCaseURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock(); nonisolated(unsafe) private static var handler: (@Sendable (URLRequest) throws -> Data)?
    static func install(_ value: (@Sendable (URLRequest) throws -> Data)?) { lock.lock(); handler = value; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "folder-case.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let handler = Self.handler; Self.lock.unlock()
        do { guard let handler else { throw LocalVaultSyncFailure.invalidResponse }; let data = try handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
