import XCTest
import Darwin
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
        XCTAssertFalse(LocalVaultDeviceState.isLocalHandoffPreparationBusy(NSError(domain: "fixture", code: 1)))
        XCTAssertFalse(LocalVaultDeviceState.isLocalHandoffPreparationBusy(RetainedReplacementProfile.Failure.invalidProfile))
        // Migration really needs EX: a stable reader blocks floor3 -> floor4.
        // Only this pre-engine typed refusal proves no session was opened.
        let migrationLease = LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile.lock")
        let migrationFD = Darwin.open(migrationLease.path, O_RDWR | O_NOFOLLOW)
        XCTAssertGreaterThanOrEqual(migrationFD, 0)
        guard migrationFD >= 0 else { return }
        defer { _ = Darwin.close(migrationFD) }
        XCTAssertEqual(flock(migrationFD, LOCK_SH | LOCK_NB), 0)
        do {
            _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": 1], root)
            XCTFail("Migration unexpectedly acquired an exclusive lease")
        } catch let error as LocalVaultCollaborationError { XCTAssertEqual(error.code, "handoff_not_open") }
        XCTAssertEqual(try Data(contentsOf: profile), prior)
        // A contended profile does not establish the retained principal. A
        // different or unreadable owner must never receive a no-open certificate.
        let ownerURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let ownerBytes = try Data(contentsOf: ownerURL)
        var foreignOwner = try XCTUnwrap(JSONSerialization.jsonObject(with: ownerBytes) as? [String: Any])
        foreignOwner["accountId"] = "account-b"
        let foreignBytes = try JSONSerialization.data(withJSONObject: foreignOwner, options: [.sortedKeys])
        XCTAssertEqual(flock(migrationFD, LOCK_EX | LOCK_NB), 0)
        do {
            _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": 1], root)
            XCTFail("Exclusive profile lease unexpectedly allowed native open")
        } catch let error as LocalVaultCollaborationError { XCTAssertEqual(error.code, "handoff_not_open") }
        XCTAssertEqual(try Data(contentsOf: ownerURL), ownerBytes)
        for refusedOwner in [foreignBytes, Data("invalid-owner".utf8)] {
            try refusedOwner.write(to: ownerURL)
            do {
                _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": 1], root)
                XCTFail("Accepted an unverified retained principal")
            } catch let error as LocalVaultCollaborationError { XCTAssertNotEqual(error.code, "handoff_not_open") }
            catch { }
            XCTAssertEqual(try Data(contentsOf: ownerURL), refusedOwner)
            XCTAssertEqual(try Data(contentsOf: profile), prior)
        }
        try ownerBytes.write(to: ownerURL)
        XCTAssertEqual(flock(migrationFD, LOCK_UN), 0)
        // A failed native open still proves publication precedes lease acquisition.
        do { _ = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": String(repeating: "0", count: 64), "localHandoffVersion": 1], root); XCTFail("Accepted stale projection") } catch { }
        XCTAssertEqual((try JSONSerialization.jsonObject(with: Data(contentsOf: profile)) as? [String: Any])?["version"] as? Int, 4)
        let opened = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": 1], root)
        XCTAssertEqual((opened["localHandoff"] as? [String: Int])?["version"], 1)
        _ = try await request(relay, "collaborationClose", ["itemId": item, "sessionToken": try XCTUnwrap(opened["sessionToken"] as? String)], root)
        // A stable verifier may hold the shared migration lease while a new
        // editor opens an already-published floor. No migration is necessary.
        let stableBytes = try Data(contentsOf: profile)
        let lease = LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile.lock")
        let descriptor = Darwin.open(lease.path, O_RDWR | O_NOFOLLOW)
        XCTAssertGreaterThanOrEqual(descriptor, 0)
        guard descriptor >= 0 else { return }
        defer { _ = flock(descriptor, LOCK_UN); _ = Darwin.close(descriptor) }
        XCTAssertEqual(flock(descriptor, LOCK_SH | LOCK_NB), 0)
        let concurrent = try await request(relay, "collaborationOpen", ["itemId": item, "path": path, "hash": file.hash, "localHandoffVersion": 1], root)
        XCTAssertEqual((concurrent["localHandoff"] as? [String: Int])?["profileVersion"], 4)
        XCTAssertEqual(try Data(contentsOf: profile), stableBytes)
        _ = flock(descriptor, LOCK_UN)
        _ = try await request(relay, "collaborationClose", ["itemId": item, "sessionToken": try XCTUnwrap(concurrent["sessionToken"] as? String)], root)
    }
}
private actor HandoffBridgeTransport: LocalVaultSyncTransport {
    func manifest() async throws -> [LocalVaultRemoteItem] { [] }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { TextTextStableDigest.sha256Hex(data) }
    func download(itemId: String) async throws -> LocalVaultRemotePack { throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
