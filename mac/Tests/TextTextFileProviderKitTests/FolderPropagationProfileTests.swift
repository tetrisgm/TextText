import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class FolderPropagationProfileTests: XCTestCase {
    private enum Interrupted: Error { case stopped }
    private func fixture() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folder-propagation-profile-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try LocalVaultAccountRootOwnership.open(root: root,
            binding: LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
        return root
    }
    private func profile(_ root: URL) -> URL {
        LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json")
    }
    func testPropagationFloorPreservesBothPriorMarkersAndStableOwner() throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        try RetainedReplacementProfile.prepareFolderCase(root: root)
        let path = profile(root), prior = try Data(contentsOf: path)
        let ownerPath = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let ownerBytes = try Data(contentsOf: ownerPath)
        try RetainedReplacementProfile.prepareFolderPropagation(root: root)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])
        XCTAssertEqual(fields["version"] as? Int, 3)
        // The supported immediately prior marker reader accepted only one/two.
        XCTAssertFalse([1, 2].contains(fields["version"] as? Int ?? 0))
        XCTAssertEqual(try Data(contentsOf: path.deletingLastPathComponent().appendingPathComponent("profile-v2.json")), prior)
        XCTAssertEqual(try Data(contentsOf: ownerPath), ownerBytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: path.deletingLastPathComponent().appendingPathComponent("profile-v1.json").path))
        try LocalVaultAccountRootOwnership.open(root: root,
            binding: LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
        let published = try Data(contentsOf: path)
        try RetainedReplacementProfile.prepareFolderCase(root: root) // Never downgrade.
        XCTAssertEqual(try Data(contentsOf: path), published)
    }
    func testInterruptedPropagationPublicationReopensWithoutChangingPreservedMarker() throws {
        for boundary in ["folderPropagationProfilePreserved", "folderPropagationProfile:beforeSwap", "folderPropagationProfile:swapped"] {
            let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
            try RetainedReplacementProfile.prepareFolderCase(root: root)
            let path = profile(root), prior = try Data(contentsOf: path)
            XCTAssertThrowsError(try RetainedReplacementProfile.prepareFolderPropagation(root: root) { stage in
                if stage == boundary { throw Interrupted.stopped }
            })
            try RetainedReplacementProfile.prepareFolderPropagation(root: root)
            XCTAssertEqual(try Data(contentsOf: path.deletingLastPathComponent().appendingPathComponent("profile-v2.json")), prior)
            XCTAssertEqual((try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])?["version"] as? Int, 3)
        }
    }
    func testChangedPriorMarkerRefusesAndCompletedLocalRenameHistoryStillReads() throws {
        let root = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Before"), withIntermediateDirectories: false)
        try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before")
        try RetainedReplacementProfile.prepareFolderPropagation(root: root)
        try FolderCaseRename(root: root).assertReadable()
        let prior = profile(root).deletingLastPathComponent().appendingPathComponent("profile-v2.json")
        try Data("unknown".utf8).write(to: prior)
        XCTAssertThrowsError(try RetainedReplacementProfile.prepareFolderPropagation(root: root))
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
    }
}
