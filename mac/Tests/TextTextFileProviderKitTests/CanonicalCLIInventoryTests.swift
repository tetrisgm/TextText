import XCTest
@testable import TextTextFileProviderKit

final class CanonicalCLIInventoryTests: XCTestCase {
    func testFullPhysicalInventoryUsesCapturedPrincipalAndNoLegacyRoutes() async throws {
        let state = CanonicalInventoryState()
        let result = await run(state)
        let value = try result.get()
        XCTAssertEqual(value.items.count, 151)
        XCTAssertEqual(value.folders, ["Notes"])
        XCTAssertTrue(value.items.contains(where: { $0.relativePath == "Notes/Physical-150.textpack" }))
        XCTAssertEqual(state.paths, ["/api/vault", "/api/vault/workspace/items", "/api/vault"])
    }
    func testAccountChangeDuringManifestRefuses() async {
        let state = CanonicalInventoryState(); state.changedAccount = true
        if case .success = await run(state) { XCTFail("account change must refuse") }
    }
    func testMissingOwnerFolderCatalogRefusesWithoutLegacyFallback() async {
        let state = CanonicalInventoryState(); state.owner = false
        if case .success = await run(state) { XCTFail("missing authoritative catalog must refuse") }
        XCTAssertFalse(state.paths.contains(where: { $0.contains("sync/v1") }))
    }
    private func run(_ state: CanonicalInventoryState) async -> Result<TextTextCLIInventory, TextTextSyncError> {
        CanonicalInventoryProtocol.install { try state.reply($0) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CanonicalInventoryProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); CanonicalInventoryProtocol.install(nil) }
        return await LiveTextTextSyncAPI(origin: URL(string: "https://canonical-cli.test")!, token: "fixture-only", session: session).canonicalCLIInventory(expectedWorkspaceId: "workspace", expectedAccountId: "account-a")
    }
}
private final class CanonicalInventoryState: @unchecked Sendable {
    var paths: [String] = []; var changedAccount = false; var owner = true
    func reply(_ request: URLRequest) throws -> Data {
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-only" else { throw LocalVaultSyncFailure.invalidResponse }
        let path = request.url!.path; paths.append(path)
        if path == "/api/vault" {
            return try JSONSerialization.data(withJSONObject: ["workspaceId": "workspace", "accountId": changedAccount && paths.count > 1 ? "account-b" : "account-a", "name": "Fixture"])
        }
        guard path == "/api/vault/workspace/items", request.value(forHTTPHeaderField: "X-TextText-Account") == "account-a" else { throw LocalVaultSyncFailure.invalidResponse }
        return try JSONSerialization.data(withJSONObject: ["items": (0..<151).map { ["itemId": "item-\($0)", "relativePath": "Notes/Physical-\($0).textpack", "revision": "r"] }, "folders": ["Notes"], "fullAccess": owner, "canCreateContent": owner])
    }
}
private final class CanonicalInventoryProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: (@Sendable (URLRequest) throws -> Data)?
    static func install(_ value: (@Sendable (URLRequest) throws -> Data)?) { lock.lock(); handler = value; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "canonical-cli.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let handler = Self.handler; Self.lock.unlock()
        do {
            guard let handler else { throw LocalVaultSyncFailure.invalidResponse }
            let data = try handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
