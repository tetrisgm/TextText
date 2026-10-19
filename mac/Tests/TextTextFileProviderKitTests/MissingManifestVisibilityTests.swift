import Foundation
import TextTextSyncTestSupport
import XCTest
@testable import TextTextFileProviderKit

/// Actual HTTP transport with controlled server-shaped visibility snapshots.
/// No server authentication or physical fleet acceptance is claimed.
final class MissingManifestVisibilityTests: XCTestCase {
    func testMissingVisibleItemNeverBecomesExistingWriteAuthority() async throws {
        for fullAccess in [true, false] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("missing-manifest-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let id = "d1111111-1111-4111-8111-111111111111", path = "Notes/Visible.textpack"
            let scratch = root.appendingPathComponent(".fixture")
            try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
            let document = try BuiltinTextPackDocument.create(title: "Visible", body: "Retained exact bytes")
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Visible\n---\n\nRetained exact bytes", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
            let bytes = try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
            try FileManager.default.removeItem(at: scratch)
            MissingManifestURLProtocol.install(id: id, path: path, bytes: bytes, fullAccess: fullAccess)
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MissingManifestURLProtocol.self]
            let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
            let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://missing-manifest.test")!, workspaceId: "visibility-fixture", token: "fixture-not-a-credential", session: session)
            let sync = try LocalVaultSync(root: root, binding: .init(origin: URL(string: "https://missing-manifest.test")!, workspaceId: "visibility-fixture"), transport: transport, mirrorPolicy: makeTestMirrorPolicy(workspaceId: "visibility-fixture"))
            let initial = try await sync.sync(); XCTAssertTrue(initial.errors.isEmpty)
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), bytes)
            let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
            func baseline() throws -> Data {
                let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
                let entry = try XCTUnwrap((state["baselines"] as? [String: Any])?[id]); let outbox = try XCTUnwrap(state["outbox"])
                return try JSONSerialization.data(withJSONObject: ["baseline": entry, "outbox": outbox], options: [.sortedKeys])
            }
            let before = try baseline()
            MissingManifestURLProtocol.hideItem()
            let absent = try await sync.sync(); XCTAssertTrue(absent.errors.isEmpty)
            let canWriteExisting = await transport.canWrite(itemId: id, path: path, existing: true)
            XCTAssertFalse(canWriteExisting, "Successful manifest absence never grants existing-item write authority")
            let canCreate = await transport.canWrite(itemId: id, path: path, existing: false)
            XCTAssertEqual(canCreate, fullAccess, "Owner create permission is separate from absent existing-item authority")
            XCTAssertEqual(try baseline(), before)
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), bytes)
            let restarted = try LocalVaultSync(root: root, binding: .init(origin: URL(string: "https://missing-manifest.test")!, workspaceId: "visibility-fixture"), transport: transport, mirrorPolicy: makeTestMirrorPolicy(workspaceId: "visibility-fixture"))
            _ = try await restarted.sync()
            XCTAssertEqual(try baseline(), before)
            XCTAssertEqual(MissingManifestURLProtocol.writes, 0)
        }
    }
}
private final class MissingManifestURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var data = Data(), id = "", path = "", fullAccess = false, hidden = false, writeCount = 0
    static var writes: Int { lock.lock(); defer { lock.unlock() }; return writeCount }
    static func install(id: String, path: String, bytes: Data, fullAccess: Bool) { lock.lock(); defer { lock.unlock() }; self.id=id; self.path=path; data=bytes; self.fullAccess=fullAccess; hidden=false; writeCount=0 }
    static func hideItem() { lock.lock(); defer { lock.unlock() }; hidden=true }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "missing-manifest.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let snapshot = (Self.id, Self.path, Self.data, Self.fullAccess, Self.hidden)
        if request.httpMethod != "GET" { Self.writeCount += 1 }
        Self.lock.unlock()
        do {
            let revision = TextTextStableDigest.sha256Hex(snapshot.2)
            let manifest: [String: Any] = ["items": snapshot.4 ? [] : [["itemId": snapshot.0, "relativePath": snapshot.1, "revision": revision, "canEditContent": true]], "tombstones": [], "folders": snapshot.3 ? (snapshot.4 ? [] : ["Notes"]) : ["SharedEmpty"], "fullAccess": snapshot.3, "canCreateContent": snapshot.3, "writableFolders": []]
            let isManifest = request.url!.path.hasSuffix("/items")
            let body = isManifest ? try JSONSerialization.data(withJSONObject: manifest) : snapshot.2
            let headers = isManifest ? ["Content-Type": "application/json"] : ["ETag": "\"\(revision)\"", "X-TextText-Path": snapshot.1]
            let response = HTTPURLResponse(url: request.url!, statusCode: request.httpMethod == "GET" ? 200 : 500, httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: body); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}
