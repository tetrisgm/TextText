import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultAccountRootOwnershipTests: XCTestCase {
    func testRootOwnershipSurvivesMissingSyncStateAndRefusesAnotherAccount() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let marker = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let saved = try Data(contentsOf: marker)
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-b"))
        XCTAssertEqual(try Data(contentsOf: marker), saved)
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root,
            binding: LocalVaultSyncBinding(origin: binding.origin, workspaceId: "another"), accountId: "account-a"))
        var future = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: saved)
        future.version = 999
        let unknown = try JSONEncoder().encode(future); try unknown.write(to: marker, options: .atomic)
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
        XCTAssertEqual(try Data(contentsOf: marker), unknown)
    }
    func testNonemptyLegacyRootRequiresExplicitAdoptionAndPendingAdoptionBlocksOpening() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("Pending.txt"), bytes = Data("Original retained work".utf8)
        try bytes.write(to: file)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
        XCTAssertEqual(try Data(contentsOf: file), bytes)
        let directory = LocalVaultDeviceState.directory(root: root)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(LocalVaultAccountRootOwnership.fileName).path))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("pending adoption".utf8).write(to: directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption))
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
    }
}
