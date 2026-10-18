import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class RetainedReplacementProfileTests: XCTestCase {
    private var root: URL!
    private var binding: LocalVaultSyncBinding!
    private var marker: URL { LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName) }
    private enum Interrupted: Error { case stopped }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("replacement-profile-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func oldFactory(_ bytes: Data) throws {
        // The supported version-one factory's actual persisted-format check.
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: bytes)
        guard owner.version == 1 else { throw LocalVaultAccountRootOwnership.Failure.future }
    }
    func testOwnedProfilePreservesExactOldBytesAndOldFactoryRefusesNewVersion() throws {
        let before = try Data(contentsOf: marker)
        try oldFactory(before)
        try RetainedReplacementProfile.prepare(root: root)
        let after = try Data(contentsOf: marker)
        XCTAssertThrowsError(try oldFactory(after))
        XCTAssertEqual(try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: after).version, 2)
        XCTAssertEqual(try Data(contentsOf: marker.deletingLastPathComponent().appendingPathComponent("retained-replacement-profile/owner-v1.json")), before)
        XCTAssertNoThrow(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-b"))
        try RetainedReplacementProfile.prepare(root: root)
        XCTAssertEqual(try Data(contentsOf: marker), after)
        let originalOwner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: before)
        try LocalVaultAccountRootOwnership.publish(originalOwner, root: root)
        XCTAssertEqual(try Data(contentsOf: marker), after, "Publishing a legacy expected owner must never downgrade the format floor.")
    }
    func testEveryInterruptedMigrationStageResumesFromExactRetainedOwner() throws {
        for stage in ["ownerPreserved", "profilePrepared", "ownerStaged", "ownerBeforePublish", "ownerSwapped", "ownerPublished"] {
            let isolated = root.appendingPathComponent(stage)
            try FileManager.default.createDirectory(at: isolated, withIntermediateDirectories: true)
            try LocalVaultAccountRootOwnership.open(root: isolated, binding: binding, accountId: "account-a")
            let ownerURL = LocalVaultDeviceState.directory(root: isolated).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
            let before = try Data(contentsOf: ownerURL)
            XCTAssertThrowsError(try RetainedReplacementProfile.prepare(root: isolated) { observed in if observed == stage { throw Interrupted.stopped } })
            XCTAssertNoThrow(try LocalVaultAccountRootOwnership.open(root: isolated, binding: binding, accountId: "account-a"), "Normal startup must reconstruct an interrupted attested migration.")
            try RetainedReplacementProfile.prepare(root: isolated)
            let current = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: Data(contentsOf: ownerURL))
            XCTAssertEqual(current.version, 2)
            XCTAssertEqual(try Data(contentsOf: ownerURL.deletingLastPathComponent().appendingPathComponent("retained-replacement-profile/owner-v1.json")), before)
            XCTAssertNoThrow(try LocalVaultAccountRootOwnership.open(root: isolated, binding: binding, accountId: "account-a"))
        }
    }
    func testFutureMarkerAndMissingOwnerCannotBeRepairedByDowngrade() throws {
        try RetainedReplacementProfile.prepare(root: root)
        let after = try Data(contentsOf: marker)
        let profile = marker.deletingLastPathComponent().appendingPathComponent("retained-replacement-profile/profile.json")
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: profile)) as? [String: Any])
        value["version"] = 999
        let future = try JSONSerialization.data(withJSONObject: value)
        try future.write(to: profile)
        XCTAssertThrowsError(try RetainedReplacementProfile.prepare(root: root))
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
        XCTAssertEqual(try Data(contentsOf: marker), after)
        XCTAssertEqual(try Data(contentsOf: profile), future)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: after)
        try FileManager.default.removeItem(at: marker)
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.publish(owner, root: root))
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
    }
    func testPrincipalChangeDuringMigrationIsNeverOverwritten() throws {
        let before = try Data(contentsOf: marker)
        var changed = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: before)
        changed = .init(version: 1, binding: changed.binding, accountId: "account-b", rootHash: changed.rootHash)
        let replacement = try JSONEncoder().encode(changed)
        XCTAssertThrowsError(try RetainedReplacementProfile.prepare(root: root) { stage in
            if stage == "ownerStaged" { try replacement.write(to: self.marker, options: .atomic) }
        })
        XCTAssertEqual(try Data(contentsOf: marker), replacement)
        XCTAssertEqual(try Data(contentsOf: marker.deletingLastPathComponent().appendingPathComponent("retained-replacement-profile/owner-v1.json")), before)
    }
    func testRegistryPrincipalBindingSurvivesOnlyAttestedFormatMigration() throws {
        let registry = ReplacementRecoveryRegistry(root: root)
        let operation = UUID(), hash = String(repeating: "a", count: 64)
        try registry.register(operation: operation, itemId: "item", path: "item.textpack", expectedHash: hash, preparedHash: hash)
        let before = try registry.entries()
        try RetainedReplacementProfile.prepare(root: root)
        XCTAssertEqual(try registry.entries(), before)
        var owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: Data(contentsOf: marker))
        owner.version = 999
        let future = try JSONEncoder().encode(owner)
        try future.write(to: marker)
        XCTAssertThrowsError(try registry.entries())
        XCTAssertEqual(try Data(contentsOf: marker), future)
    }
    func testFinalPublicationRaceRetainsActualChangedOwnerAndFencesBothPrincipals() throws {
        let before = try Data(contentsOf: marker)
        let oldOwner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: before)
        let changed = LocalVaultAccountRootOwnership.Owner(version: 1, binding: oldOwner.binding, accountId: "account-b", rootHash: oldOwner.rootHash)
        let changedBytes = try JSONEncoder().encode(changed)
        XCTAssertThrowsError(try RetainedReplacementProfile.prepare(root: root) { stage in
            if stage == "ownerBeforePublish" { try changedBytes.write(to: self.marker, options: .atomic) }
        })
        let retained = try XCTUnwrap(RetainedFileReplacement.inspect(marker).first)
        XCTAssertEqual(retained.record.state, .conflict)
        XCTAssertEqual(try Data(contentsOf: retained.displaced), changedBytes)
        XCTAssertEqual(try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: Data(contentsOf: marker)).accountId, "account-a")
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-b"))
        XCTAssertEqual(try Data(contentsOf: marker.deletingLastPathComponent().appendingPathComponent("retained-replacement-profile/owner-v1.json")), before)
    }
    func testRegistryRefusesAChangedAccountWithoutRebindingSavedOperations() throws {
        let registry = ReplacementRecoveryRegistry(root: root), hash = String(repeating: "b", count: 64)
        try registry.register(operation: UUID(), itemId: "item", path: "item.textpack", expectedHash: hash, preparedHash: hash)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: Data(contentsOf: marker))
        let changed = LocalVaultAccountRootOwnership.Owner(version: 1, binding: owner.binding, accountId: "account-b", rootHash: owner.rootHash)
        let newBytes = try JSONEncoder().encode(changed)
        try newBytes.write(to: marker)
        XCTAssertThrowsError(try registry.entries())
        XCTAssertEqual(try Data(contentsOf: marker), newBytes)
    }
}
