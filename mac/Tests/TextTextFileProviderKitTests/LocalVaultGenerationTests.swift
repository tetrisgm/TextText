import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultGenerationTests: XCTestCase {
    let id = "a4e5658d-8848-477c-95a2-851922319b32"
    let revision = String(repeating: "a", count: 64)
    let scope = LocalVaultProtectedRenameScope(origin: "https://example.test", workspaceId: "workspace", accountId: "account")
    func manifest(_ change: (inout [String: Any]) -> Void = { _ in }) throws -> Data {
        var item: [String: Any] = ["itemId": id, "relativePath": "Folder/Item.textpack", "revision": revision, "canEditContent": true]
        change(&item)
        return try JSONSerialization.data(withJSONObject: ["items": [item], "tombstones": [], "folders": ["Folder"], "problems": [],
            "revision": revision, "fullAccess": true, "canCreateContent": true, "writableFolders": []])
    }
    func testCompleteDiscoveryRejectsTruncatedInventoryCount() throws {
        XCTAssertNoThrow(try LocalVaultDocumentStore.validateGenerationInventoryCount(20_000))
        XCTAssertThrowsError(try LocalVaultDocumentStore.validateGenerationInventoryCount(20_001))
    }
    func testUnknownIsNotObservedAbsence() throws {
        XCTAssertFalse(LocalVaultGeneration.unknown.matches(.unknown))
        XCTAssertFalse(LocalVaultGeneration.unknown.matches(.observedAbsent))
        XCTAssertTrue(LocalVaultGeneration.observedAbsent.matches(.observedAbsent))
        XCTAssertFalse(LocalVaultGeneration.observedAbsent.matches(.present("restored")))
        XCTAssertTrue(LocalVaultGeneration.present("restored").matches(.present("restored")))
        XCTAssertFalse(LocalVaultGeneration.present("restored").matches(.present("later")))
    }
    func testOnlyAuthenticatedCompleteManifestOmissionCertifiesAbsence() throws {
        let proof = try XCTUnwrap(LocalVaultGenerationManifest.parse(manifest(), itemId: id, scope: scope))
        XCTAssertEqual(proof.generation, .observedAbsent)
        XCTAssertEqual(proof.item.revision, revision)
        XCTAssertEqual(proof.scope, scope)
        XCTAssertEqual(proof.manifestHash.count, 64)
        let restored = try manifest { $0["lifecycle"] = "restored"; $0["restoreFromRevision"] = self.revision }
        XCTAssertEqual(try LocalVaultGenerationManifest.parse(restored, itemId: id, scope: scope)?.generation, .present("restored"))
        var filtered = try XCTUnwrap(JSONSerialization.jsonObject(with: manifest()) as? [String: Any])
        filtered["fullAccess"] = false
        XCTAssertNil(try LocalVaultGenerationManifest.parse(JSONSerialization.data(withJSONObject: filtered), itemId: id, scope: scope))
    }
    func testNullPartialDuplicateMalformedAndUnownedCannotCertifyAbsence() throws {
        for bytes in [try manifest { $0["lifecycle"] = NSNull() }, try manifest { $0["restoreFromRevision"] = NSNull() },
                      try manifest { $0["lifecycle"] = "generation" }, try manifest { $0["restoreFromRevision"] = self.revision },
                      try manifest { $0["revision"] = "wrong" }, try manifest { $0["relativePath"] = "../Item.textpack" },
                      try manifest { $0["deleted"] = true }, try manifest { $0["deleted"] = NSNull() },
                      try manifest { $0["extra"] = true }] {
            XCTAssertThrowsError(try LocalVaultGenerationManifest.parse(bytes, itemId: id, scope: scope))
        }
        let raw = String(decoding: try manifest(), as: UTF8.self)
        let duplicatedRoot = "{\"items\":[]," + raw.dropFirst()
        XCTAssertThrowsError(try LocalVaultGenerationManifest.parse(Data(duplicatedRoot.utf8), itemId: id, scope: scope))
        XCTAssertThrowsError(try LocalVaultGenerationManifest.parse(manifest(), itemId: id,
            scope: .init(origin: scope.origin, workspaceId: scope.workspaceId, accountId: nil)))
        var duplicatePath = try XCTUnwrap(JSONSerialization.jsonObject(with: manifest()) as? [String: Any])
        var entries = try XCTUnwrap(duplicatePath["items"] as? [[String: Any]])
        var other = entries[0]; other["itemId"] = "other-item"; other["relativePath"] = "folder/item.textpack"; entries.append(other)
        duplicatePath["items"] = entries
        XCTAssertThrowsError(try LocalVaultGenerationManifest.parse(JSONSerialization.data(withJSONObject: duplicatePath), itemId: id, scope: scope))
    }
    func testVersionTwoRetainsTypedAbsenceAndImmutableReceiptAcrossRoundTrip() throws {
        let root = String(repeating: "b", count: 64)
        let request = LocalVaultProtectedRenameRequest(operationId: "cd78d15b-1e08-4c44-8c71-2465c5e32c44", itemId: id,
            source: "Folder/Item.textpack", destination: "Folder/Moved.textpack", baseRevision: revision)
        let record = LocalVaultSharedRename.Record(rootHash: root, request: request, scope: scope, baselineHash: revision, generation: .observedAbsent)
        let context = LocalVaultSharedRename.Context(rootHash: root, scope: scope)
        let bytes = try LocalVaultSharedRename.archiveBytes(record)
        XCTAssertEqual(try LocalVaultSharedRename.decodeRecord(bytes, context: context), record)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(fields["version"] as? Int, 2); XCTAssertNil(fields["lifecycle"])
        XCTAssertEqual((fields["generation"] as? [String: String])?["kind"], "observed-absent")
        let receipt = LocalVaultProtectedRenameReceipt(request: request, scope: scope, status: "conflict", relativePath: request.source, revision: revision, deleted: false)
        guard case .rejected(let rejected) = try LocalVaultSharedRename.consume(receipt, for: record) else { return XCTFail("Expected exact typed rejection") }
        XCTAssertEqual(rejected.version, 2); XCTAssertEqual(rejected.request, request)
        let stopped = try LocalVaultSharedRename.stopped(rejected, resolution: .init(localPath: request.destination, remotePath: request.source,
            localGeneration: .observedAbsent, remoteGeneration: .observedAbsent))
        XCTAssertEqual(try LocalVaultSharedRename.decodeRecord(LocalVaultSharedRename.archiveBytes(stopped), context: context), stopped)
        XCTAssertFalse(LocalVaultSharedRename.matchesStoppedFacts(stopped, localPath: request.destination, remotePath: request.source,
            localLifecycle: nil, remoteLifecycle: nil, unique: true))
        XCTAssertTrue(LocalVaultSharedRename.matchesStoppedFacts(stopped, localPath: request.destination, remotePath: request.source,
            localLifecycle: nil, remoteLifecycle: nil, unique: true, localGeneration: .observedAbsent, remoteGeneration: .observedAbsent))
        XCTAssertThrowsError(try LocalVaultSharedRename.archiveBytes(.init(rootHash: root, request: request, scope: scope,
            baselineHash: revision, generation: .unknown)))
    }
    func testVersionOneKeepsOriginalStrictLifecycleShape() throws {
        let request = LocalVaultProtectedRenameRequest(operationId: "cd78d15b-1e08-4c44-8c71-2465c5e32c44", itemId: id,
            source: "Folder/Item.textpack", destination: "Folder/Moved.textpack", baseRevision: revision)
        let record = LocalVaultSharedRename.Record(rootHash: revision, request: request, scope: scope, baselineHash: revision, lifecycle: "existing")
        let bytes = try LocalVaultSharedRename.archiveBytes(record)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(fields["version"] as? Int, 1); XCTAssertEqual(fields["lifecycle"] as? String, "existing"); XCTAssertNil(fields["generation"])
        XCTAssertEqual(try LocalVaultSharedRename.decodeRecord(bytes, context: .init(rootHash: revision, scope: scope)), record)
    }
}
