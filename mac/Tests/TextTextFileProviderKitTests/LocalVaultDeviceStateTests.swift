import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultDeviceStateTests: XCTestCase {
    func testMigratesLegacyJournalsWithoutRemovingOrReimportingThem() throws {
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("vault-device-state-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: scratch) }
        let root = scratch.appendingPathComponent("workspace")
        let base = scratch.appendingPathComponent("device")
        let legacySync = root.appendingPathComponent(".texttext/sync")
        let legacyShared = root.appendingPathComponent(".texttext/shared-editing/item-1")
        try FileManager.default.createDirectory(at: legacySync.appendingPathComponent("outbox"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: legacyShared, withIntermediateDirectories: true)
        let state = Data("saved-sync-state".utf8)
        try state.write(to: legacySync.appendingPathComponent("state.json"))
        try Data([0, 1, 255]).write(to: legacySync.appendingPathComponent("outbox/pending.textpack"))
        try Data("retained-edit".utf8).write(to: legacyShared.appendingPathComponent("checkpoint.json"))

        try LocalVaultDeviceState.migrate(root: root, base: base)
        let device = LocalVaultDeviceState.directory(root: root, base: base)
        XCTAssertEqual(try Data(contentsOf: device.appendingPathComponent("sync/state.json")), state)
        XCTAssertEqual(try Data(contentsOf: device.appendingPathComponent("sync/outbox/pending.textpack")), Data([0, 1, 255]))
        XCTAssertEqual(try Data(contentsOf: device.appendingPathComponent("shared-editing/item-1/checkpoint.json")), Data("retained-edit".utf8))
        XCTAssertEqual(try Data(contentsOf: legacySync.appendingPathComponent("state.json")), state)

        try Data("late-cloud-copy".utf8).write(to: legacySync.appendingPathComponent("state.json"))
        try LocalVaultDeviceState.migrate(root: root, base: base)
        XCTAssertEqual(try Data(contentsOf: device.appendingPathComponent("sync/state.json")), state)
        XCTAssertNotEqual(LocalVaultDeviceState.directory(root: root, base: base),
                          LocalVaultDeviceState.directory(root: scratch.appendingPathComponent("other"), base: base))
    }

    func testPreservesDivergentLocalAndLegacyState() throws {
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("vault-device-divergence-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: scratch) }
        let root = scratch.appendingPathComponent("workspace")
        let base = scratch.appendingPathComponent("device")
        let legacy = root.appendingPathComponent(".texttext/sync")
        let local = LocalVaultDeviceState.directory(root: root, base: base).appendingPathComponent("sync")
        try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true)
        try Data("legacy".utf8).write(to: legacy.appendingPathComponent("state.json"))
        try Data("local".utf8).write(to: local.appendingPathComponent("state.json"))
        XCTAssertThrowsError(try LocalVaultDeviceState.migrate(root: root, base: base))
        XCTAssertEqual(try Data(contentsOf: legacy.appendingPathComponent("state.json")), Data("legacy".utf8))
        XCTAssertEqual(try Data(contentsOf: local.appendingPathComponent("state.json")), Data("local".utf8))
    }
}
