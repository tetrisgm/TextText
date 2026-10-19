import XCTest
import TextTextWorkspaceCore
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit
@testable import TextTextApp

final class LocalHandoffBridgeTests: XCTestCase {
    @MainActor
    private func request(_ relay: LocalVaultCollaboration, _ method: String, _ params: [String: Any], _ root: URL) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            relay.start(id: UUID().uuidString, method: method, params: params, root: root) { continuation.resume(with: $0.map { $0 ?? [:] }) }
        }
    }
    @MainActor
    func testConfiguredOwnedBridgeNegotiatesBeforeSingleNativeLease() async throws {
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("handoff-bridge-" + UUID().uuidString)
        let root = parent.appendingPathComponent("vault"), base = parent.appendingPathComponent("device")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(base)
        defer { _ = LocalVaultDeviceState.exchangeConfiguredBase(previous); try? FileManager.default.removeItem(at: parent) }
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let item = "handoff-bridge-note", path = "Note.textpack"
        let document = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"handoff-bridge-note\"\n---\nOriginal", documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
        let engine = try makeTestSync(root: root, binding: binding, transport: HandoffBridgeTransport(), accountId: "account-a")
        _ = try await engine.sync()
        try RetainedReplacementProfile.prepareFolderPropagation(root: root)
        let profile = LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json")
        let prior = try Data(contentsOf: profile)
        let file = try LocalVaultDocumentStore(root: root).read(path: path)
        let account = LocalVaultAccountCredential(origin: binding.origin, token: "fixture", accountId: "account-a")
        let relay = LocalVaultCollaboration(verifiedCredentials: { account }, expectedLifetime: .captured(account), engine: { engine })
        let config = try await request(relay, "collaborationConfig", ["path": path], root)
        XCTAssertEqual((config["localHandoff"] as? [String: Int])?["profileVersion"], 4)
        XCTAssertEqual(try Data(contentsOf: profile), prior)
        let legacy = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash], root)
        XCTAssertNil(legacy["localHandoff"]); XCTAssertEqual(try Data(contentsOf: profile), prior)
        _ = try await request(relay, "collaborationClose", ["itemId": item, "sessionToken": try XCTUnwrap(legacy["sessionToken"] as? String)], root)
        for version in [true, 0, 2, "1"] as [Any] {
            do { _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": version], root); XCTFail("Accepted invalid handoff version") } catch { }
            XCTAssertEqual(try Data(contentsOf: profile), prior)
        }
        do { _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "unknown": 1], root); XCTFail("Accepted unknown open field") } catch { }
        // A failed native open still proves publication precedes lease acquisition.
        do { _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": String(repeating: "0", count: 64), "localHandoffVersion": 1], root); XCTFail("Accepted stale projection") } catch { }
        XCTAssertEqual((try JSONSerialization.jsonObject(with: Data(contentsOf: profile)) as? [String: Any])?["version"] as? Int, 4)
        let opened = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": 1], root)
        XCTAssertEqual((opened["localHandoff"] as? [String: Int])?["version"], 1)
        _ = try await request(relay, "collaborationClose", ["itemId": item, "sessionToken": try XCTUnwrap(opened["sessionToken"] as? String)], root)
    }
}
private actor HandoffBridgeTransport: LocalVaultSyncTransport {
    func manifest() async throws -> [LocalVaultRemoteItem] { [] }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { TextTextStableDigest.sha256Hex(data) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
