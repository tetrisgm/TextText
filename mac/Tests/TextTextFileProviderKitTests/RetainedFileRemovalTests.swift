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
    func testActiveCaptureCannotBeCancelledBySecondStoreGuard() throws {
        let bytes = try pack("active capture")
        try bytes.write(to: target)
        let other = ReplacementRecoveryRegistry(root: root)
        var writer = store
        writer.writeObservationForTesting = { stage in
            if stage == "removalPrepared" {
                XCTAssertThrowsError(try other.assertReadable(itemId: "removal-item"), "Another store must refuse while capture owns its operation lease.")
            }
        }
        try writer.delete(path: "Original.textpack", expectedHash: hash(bytes))
        XCTAssertTrue(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(bytes)))
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
    func testOperationBoundMarkerAcknowledgedBeforeConsumptionCannotReissueAfterRestart() throws {
        let bytes = try pack("operation-bound marker")
        for mode in ["matching-ack", "clear", "restored-clear"] {
            let isolated = root.appendingPathComponent(mode)
            try FileManager.default.createDirectory(at: isolated, withIntermediateDirectories: true)
            let original = isolated.appendingPathComponent("Original.textpack")
            try bytes.write(to: original)
            var writer = LocalVaultDocumentStore(root: isolated)
            writer.writeObservationForTesting = { if $0 == "deletionMarkerWritten" { throw Interrupted.stopped } }
            XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(bytes)))
            let index = ReplacementRecoveryRegistry(root: isolated)
            let before = try XCTUnwrap(index.entries().first)
            XCTAssertNotEqual(before.deletionMarkerPublished, true)
            let marker = try XCTUnwrap(LocalVaultDeviceState.deletionSnapshot(root: isolated, itemId: "removal-item"))
            let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: marker) as? [String: Any])
            XCTAssertEqual(fields["operationId"] as? String, before.operation.uuidString)
            if mode == "matching-ack" { try LocalVaultDeviceState.clearDeletion(root: isolated, itemId: "removal-item", matching: marker) }
            if mode == "clear" { try LocalVaultDeviceState.clearDeletion(root: isolated, itemId: "removal-item") }
            if mode == "restored-clear" {
                try bytes.write(to: original)
                try LocalVaultDeviceState.clearDeletionIfRestored(root: isolated, itemId: "removal-item", path: "Original.textpack")
            }
            XCTAssertEqual(try XCTUnwrap(ReplacementRecoveryRegistry(root: isolated).entries().first).deletionMarkerPublished, true)
            XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: isolated, itemId: "removal-item"))
            try ReplacementRecoveryRegistry(root: isolated).assertReadable(itemId: "removal-item")
            XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: isolated, itemId: "removal-item"), mode)
        }
    }
    func testOlderRestorationObserverCannotConsumeOrOverwriteNewerSameBytesMarker() throws {
        let bytes = try pack("same bytes across two deletions")
        try bytes.write(to: target)
        var interrupted = store
        interrupted.writeObservationForTesting = { if $0 == "beforeDeletionMarker" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try interrupted.delete(path: "Original.textpack", expectedHash: hash(bytes)))
        let older = try XCTUnwrap(registry.entries().first), newer = UUID()
        try bytes.write(to: target)
        var marker: Data?
        var interleaved = false
        try registry.assertReadable(itemId: "removal-item") { stage in
            guard stage == "restorationObserved", !interleaved else { return }
            interleaved = true
            _ = try RetainedFileRemoval.capture(self.target, expectedHash: self.hash(bytes), recoveryRoot: self.registry.recoveryRoot(path: "Original.textpack"),
                operation: newer, lease: self.registry.captureLease(operation: newer)) { phase in
                if phase == "prepared" { try self.registry.register(operation: newer, itemId: "removal-item", path: "Original.textpack",
                    expectedHash: self.hash(bytes), preparedHash: self.hash(bytes), workspaceStaging: true, kind: "removal", userDeletion: true) }
            }
            try LocalVaultDeviceState.recordDeletion(root: self.root, itemId: "removal-item", path: "Original.textpack", hash: self.hash(bytes), operationId: newer)
            try self.registry.acknowledgeDeletionPublication(operation: newer, itemId: "removal-item", path: "Original.textpack", hash: self.hash(bytes))
            marker = try LocalVaultDeviceState.deletionSnapshot(root: self.root, itemId: "removal-item")
        }
        XCTAssertTrue(interleaved)
        XCTAssertEqual(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"), marker)
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertEqual(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"), marker)
        XCTAssertEqual(try XCTUnwrap(registry.entries().first(where: { $0.operation == older.operation })).supersededBy, newer)
    }
    func testNewDeletionClearsPriorBoundRestoredMarkerBeforePublishingFreshHash() throws {
        let first = try pack("first content"), latest = try pack("latest restored content")
        try first.write(to: target)
        try store.delete(path: "Original.textpack", expectedHash: hash(first))
        let oldMarker = try XCTUnwrap(LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"))
        try latest.write(to: target)
        try store.delete(path: "Original.textpack", expectedHash: hash(latest))
        let newMarker = try XCTUnwrap(LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"))
        XCTAssertNotEqual(newMarker, oldMarker)
        try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item")
        XCTAssertTrue(try LocalVaultDeviceState.hasDeletion(root: root, itemId: "removal-item", path: "Original.textpack", hash: hash(latest)))
        XCTAssertEqual(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"), newMarker)
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
    func testUncapturedUniqueRenameCancelsIntentAndAllowsNormalReadAndSave() throws {
        let before = try pack("before"), after = try pack("after")
        try before.write(to: target)
        let renamed = root.appendingPathComponent("Renamed.textpack"), source = target
        var writer = store
        writer.writeObservationForTesting = { stage in
            if stage == "removalPrepared" {
                try FileManager.default.moveItem(at: source, to: renamed)
                throw Interrupted.stopped
            }
        }
        XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(before)))
        let observed = try LocalVaultDocumentStore(root: root).read(path: "Renamed.textpack")
        XCTAssertEqual(observed.hash, hash(before))
        let entry = try XCTUnwrap(registry.entries().first)
        XCTAssertTrue(entry.deletionIntentCancelled == true)
        XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"))
        XCTAssertEqual(try store.replaceExact(path: "Renamed.textpack", expectedHash: observed.hash, bytes: after).hash, hash(after))
        XCTAssertEqual(try Data(contentsOf: renamed), after)
    }
    func testUncapturedRenameRefusesDuplicateChangedOrForeignOriginal() throws {
        let before = try pack("before"), changed = try pack("changed"), foreign = try pack("foreign", id: "foreign-item")
        for mode in ["duplicate", "changed", "foreign-original"] {
            let isolated = root.appendingPathComponent(mode)
            try FileManager.default.createDirectory(at: isolated, withIntermediateDirectories: true)
            let source = isolated.appendingPathComponent("Original.textpack"), renamed = isolated.appendingPathComponent("Renamed.textpack")
            try before.write(to: source)
            var writer = LocalVaultDocumentStore(root: isolated)
            writer.writeObservationForTesting = { stage in
                if stage == "removalPrepared" {
                    try FileManager.default.moveItem(at: source, to: renamed)
                    throw Interrupted.stopped
                }
            }
            XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(before)))
            if mode == "duplicate" { try before.write(to: isolated.appendingPathComponent("Duplicate.textpack")) }
            if mode == "changed" { try changed.write(to: renamed, options: .atomic) }
            if mode == "foreign-original" { try foreign.write(to: source) }
            let index = ReplacementRecoveryRegistry(root: isolated)
            XCTAssertThrowsError(try index.assertReadable(itemId: "removal-item"), mode)
            XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: isolated, itemId: "removal-item"))
            XCTAssertEqual(try Data(contentsOf: renamed), mode == "changed" ? changed : before)
            if mode == "foreign-original" { XCTAssertEqual(try Data(contentsOf: source), foreign) }
        }
    }
    func testUncapturedForeignOriginalRemainsPendingUntilExpectedRestored() throws {
        let before = try pack("before"), foreign = try pack("foreign", id: "foreign-item")
        try before.write(to: target)
        var writer = store
        writer.writeObservationForTesting = { if $0 == "removalPrepared" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(before)))
        try foreign.write(to: target, options: .atomic)
        XCTAssertThrowsError(try registry.assertReadable(itemId: "removal-item"))
        let entry = try XCTUnwrap(registry.entries().first)
        let reference = registry.recoveryRoot(path: entry.path).appendingPathComponent("Original.textpack")
        XCTAssertEqual(try RetainedFileReplacement.recovery(target: reference, operation: entry.operation).record.state, .pending)
        XCTAssertEqual(try Data(contentsOf: target), foreign)
        try before.write(to: target, options: .atomic)
        XCTAssertNoThrow(try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "removal-item"))
        XCTAssertEqual(try RetainedFileReplacement.recovery(target: reference, operation: entry.operation).record.state, .cancelled)
        XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"))
    }
    func testUncapturedExplicitCancelPreservesObservedVersionsAndRejectsRevokedScope() throws {
        let before = try pack("before"), foreign = try pack("foreign current", id: "foreign-item")
        try before.write(to: target)
        var writer = store
        writer.writeObservationForTesting = { if $0 == "removalPrepared" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try writer.delete(path: "Original.textpack", expectedHash: hash(before)))
        try foreign.write(to: target, options: .atomic)
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertFalse(shown.captured); XCTAssertNil(shown.displacedHash)
        XCTAssertEqual(try store.replacementRecoveryRead(id: shown.id, version: "prepared").data, before)
        XCTAssertEqual(try store.replacementRecoveryRead(id: shown.id, version: "current").data, foreign)
        XCTAssertTrue(try store.replacementRecoveryRead(id: shown.id, version: "displaced").absent)
        XCTAssertThrowsError(try store.cancelUncapturedDeletion(id: shown.id, path: shown.path, itemId: shown.itemId,
            preparedHash: shown.preparedHash, currentPresent: true, currentHash: shown.currentHash,
            beforeAcknowledge: { throw Interrupted.stopped }))
        XCTAssertNil(try XCTUnwrap(registry.entries().first).explicitCancellation)
        XCTAssertEqual(try Data(contentsOf: target), foreign)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext/conflicts/" + shown.id + "/" + hash(before) + ".textpack").path))
        try store.cancelUncapturedDeletion(id: shown.id, path: shown.path, itemId: shown.itemId, preparedHash: shown.preparedHash,
            currentPresent: true, currentHash: shown.currentHash)
        let reopened = try XCTUnwrap(LocalVaultDocumentStore(root: root).replacementRecoveryList().first)
        XCTAssertTrue(reopened.resolved); XCTAssertFalse(reopened.captured)
        XCTAssertEqual(try store.replacementRecoveryRead(id: reopened.id, version: "prepared").data, before)
        XCTAssertEqual(try Data(contentsOf: target), foreign)
        XCTAssertNoThrow(try registry.assertReadable(itemId: "removal-item"))
        XCTAssertNil(try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: "removal-item"))
    }
    func testCapturedKeepCurrentRejectsRevokedScopeAfterPreservingExports() throws {
        let before = try pack("before"), external = Data([8, 6, 4])
        try before.write(to: target)
        var writer = store; let original = target
        writer.writeObservationForTesting = { stage in if stage == "beforeCapture" { try external.write(to: original, options: .atomic) } }
        XCTAssertThrowsError(try writer.removeRetaining(path: "Original.textpack", expectedHash: hash(before)))
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertThrowsError(try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: nil,
            preparedHash: shown.preparedHash, displacedHash: shown.displacedHash, kind: "removal", currentPresent: false,
            beforeAcknowledge: { throw Interrupted.stopped }))
        XCTAssertNil(try XCTUnwrap(registry.entries().first).resolution)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext/conflicts/" + shown.id + "/" + hash(external) + ".textpack").path))
        XCTAssertThrowsError(try registry.assertReadable(itemId: "removal-item"))
    }
    func testRemovedIdentityElsewhereRefusesAmbiguousResolution() throws {
        let before = try pack("before"), external = Data([2])
        try before.write(to: target)
        var writer = store; let path = target
        writer.writeObservationForTesting = { stage in if stage == "beforeCapture" { try external.write(to: path, options: .atomic) } }
        XCTAssertThrowsError(try writer.removeRetaining(path: "Original.textpack", expectedHash: hash(before)))
        try before.write(to: root.appendingPathComponent("Elsewhere.textpack"))
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertNotNil(shown.resolutionBlocked)
        XCTAssertEqual(try store.replacementRecoveryRead(id: shown.id, version: "prepared").data, before)
        XCTAssertEqual(try store.replacementRecoveryRead(id: shown.id, version: "displaced").data, external)
        XCTAssertThrowsError(try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: shown.currentHash,
            preparedHash: shown.preparedHash, displacedHash: shown.displacedHash, kind: "removal", currentPresent: shown.currentPresent))
    }
}
