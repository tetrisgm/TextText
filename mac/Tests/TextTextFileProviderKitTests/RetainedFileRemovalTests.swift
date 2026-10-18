import Foundation
import Darwin
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class RetainedFileRemovalTests: XCTestCase {
    private var root: URL!
    private var target: URL { root.appendingPathComponent("Original.textpack") }
    private var store: LocalVaultDocumentStore { .init(root: root) }
    private var registry: ReplacementRecoveryRegistry { .init(root: root) }
    private enum Interrupted: Error { case stopped }
    private func hash(_ bytes: Data) -> String { TextTextStableDigest.sha256Hex(bytes) }
    override func setUpWithError() throws {
        let physical = try XCTUnwrap(realpath(FileManager.default.temporaryDirectory.path, nil)); defer { free(physical) }
        root = URL(fileURLWithPath: String(cString: physical)).appendingPathComponent("retained-removal-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func pack(_ body: String, id: String = "removal-item") throws -> Data {
        let scratch = root.appendingPathComponent("." + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Removal", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Removal\n---\n\n" + body,
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    func testFinalGapRetainsActualExternalBytesAndExplicitAbsentRecovery() throws {
        let before = try pack("before"), external = Data([0, 2, 4, 8])
        try before.write(to: target)
        var writer = store
        let path = target
        writer.writeObservationForTesting = { stage in if stage == "beforeCapture" { try external.write(to: path, options: .atomic) } }
        XCTAssertThrowsError(try writer.removeRetaining(path: "Original.textpack", expectedHash: hash(before)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertThrowsError(try registry.assertReadable(itemId: "removal-item"))
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertEqual(shown.kind, "removal"); XCTAssertFalse(shown.currentPresent); XCTAssertNil(shown.currentHash)
        XCTAssertTrue(try store.replacementRecoveryRead(id: shown.id, version: "current").absent)
        XCTAssertEqual(try store.replacementRecoveryRead(id: shown.id, version: "prepared").data, before)
        let displaced = try store.replacementRecoveryRead(id: shown.id, version: "displaced")
        XCTAssertEqual(displaced.data, external); XCTAssertNil(displaced.document)
        try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: nil,
            preparedHash: shown.preparedHash, displacedHash: shown.displacedHash, kind: "removal", currentPresent: false)
        XCTAssertNoThrow(try registry.assertReadable(itemId: "removal-item"))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(".texttext/history/" + hash(before) + ".textpack")), before)
    }
    func testRecreatedForeignCurrentIsNeverRemovedAndRequiresFreshConsent() throws {
        let before = try pack("before"), foreign = try pack("foreign", id: "foreign-item")
        try before.write(to: target)
        var writer = store; let path = target
        writer.writeObservationForTesting = { stage in if stage == "captured" { try foreign.write(to: path, options: .atomic) } }
        XCTAssertThrowsError(try writer.removeRetaining(path: "Original.textpack", expectedHash: hash(before)))
        XCTAssertEqual(try Data(contentsOf: target), foreign)
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertTrue(shown.currentPresent); XCTAssertEqual(shown.currentHash, hash(foreign))
        XCTAssertEqual(try store.replacementRecoveryRead(id: shown.id, version: "current").data, foreign)
        XCTAssertThrowsError(try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: nil,
            preparedHash: shown.preparedHash, displacedHash: shown.displacedHash, kind: "removal", currentPresent: false))
        try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: shown.currentHash,
            preparedHash: shown.preparedHash, displacedHash: shown.displacedHash, kind: "removal", currentPresent: true)
        XCTAssertEqual(try Data(contentsOf: target), foreign)
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: shown.path, hash: hash(before)))
    }
    func testCrashBeforeCaptureCancelsWithoutMarkerAndAllowsNextSave() throws {
        let before = try pack("before"), after = try pack("after")
        try before.write(to: target)
        var writer = store
        writer.writeObservationForTesting = { if $0 == "removalPrepared" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(before)))
        let entry = try XCTUnwrap(registry.entries().first)
        let operation = RetainedFileReplacement.operationDirectory(target: registry.recoveryRoot(path: entry.path).appendingPathComponent("Original.textpack"), operation: entry.operation)
        let manifest = operation.appendingPathComponent("manifest.json"), originalManifest = try Data(contentsOf: manifest)
        XCTAssertTrue(try store.replacementRecoveryList().isEmpty)
        XCTAssertEqual(try Data(contentsOf: manifest), originalManifest)
        XCTAssertNoThrow(try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item"))
        XCTAssertEqual(try RetainedFileReplacement.recovery(target: registry.recoveryRoot(path: entry.path).appendingPathComponent("Original.textpack"), operation: entry.operation).record.state, .cancelled)
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: entry.path, hash: hash(before)))
        XCTAssertEqual(try store.replaceExact(path: entry.path, expectedHash: hash(before), bytes: after).hash, hash(after))
    }
    func testMarkerReconstructsOnceAfterLostReplyAndNeverResurrectsAfterConsumption() throws {
        let before = try pack("before")
        try before.write(to: target)
        var writer = store
        writer.writeObservationForTesting = { if $0 == "beforeDeletionMarker" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(before)))
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(before)))
        XCTAssertEqual(try store.replacementRecoveryList().count, 1, "Captured deletion without its marker must remain inspectable.")
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(before)))
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertTrue(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(before)))
        XCTAssertTrue(try store.recoveryList().entries.contains(where: { $0.hash == hash(before) && $0.kind == "deleted" }))
        try LocalVaultDeviceState.clearDeletion(root: root, itemId: "removal-item")
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(before)))
    }
    func testRestoredUnissuedIntentCannotOverwriteLaterDeletionLifetime() throws {
        let first = try pack("first lifetime"), second = try pack("restored second lifetime")
        try first.write(to: target)
        var interrupted = store
        interrupted.writeObservationForTesting = { if $0 == "beforeDeletionMarker" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try interrupted.delete(path: "Original.textpack", expectedHash: hash(first)))
        try second.write(to: target)
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertTrue(try XCTUnwrap(registry.entries().first).deletionIntentCancelled == true)
        try store.delete(path: "Original.textpack", expectedHash: hash(second))
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertTrue(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(second)))
        XCTAssertFalse(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(first)))
        try LocalVaultDeviceState.clearDeletion(root: root, itemId: "removal-item")
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"))
    }
    func testLateOldDescriptorWriteReopensCompletedRemovalFence() throws {
        let before = try pack("before")
        try before.write(to: target)
        let fd = open(target.path, O_WRONLY | O_APPEND); XCTAssertGreaterThanOrEqual(fd, 0); defer { close(fd) }
        try store.removeRetaining(path: "Original.textpack", expectedHash: hash(before))
        XCTAssertNoThrow(try registry.assertReadable(itemId: "removal-item"))
        let changed = Data([7, 7, 7]); _ = changed.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }; XCTAssertEqual(fsync(fd), 0)
        XCTAssertThrowsError(try registry.assertReadable(itemId: "removal-item"))
        XCTAssertEqual(try store.replacementRecoveryList().count, 1)
    }
    func testRemovedIdentityElsewhereRefusesAmbiguousResolution() throws {
        let before = try pack("before"), external = Data([2])
        try before.write(to: target)
        var writer = store; let path = target
        writer.writeObservationForTesting = { stage in if stage == "beforeCapture" { try external.write(to: path, options: .atomic) } }
        XCTAssertThrowsError(try writer.removeRetaining(path: "Original.textpack", expectedHash: hash(before)))
        try before.write(to: root.appendingPathComponent("Elsewhere.textpack"))
        XCTAssertThrowsError(try store.replacementRecoveryList())
    }
}
