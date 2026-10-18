import Foundation
import Darwin
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class ReplacementRecoveryRegistryTests: XCTestCase {
    private var root: URL!
    private var target: URL { root.appendingPathComponent("Original.textpack") }
    private var registry: ReplacementRecoveryRegistry { .init(root: root) }
    private var store: LocalVaultDocumentStore { .init(root: root) }
    private func hash(_ bytes: Data) -> String { TextTextStableDigest.sha256Hex(bytes) }
    private enum Interrupted: Error { case stopped }
    override func setUpWithError() throws {
        let path = try XCTUnwrap(realpath(FileManager.default.temporaryDirectory.path, nil)); defer { free(path) }
        root = URL(fileURLWithPath: String(cString: path)).appendingPathComponent("replacement-registry-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func pack(_ body: String) throws -> Data {
        let scratch = root.appendingPathComponent("." + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Registry", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"registry-item\"\ntitle: Registry\n---\n\n" + body,
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    private func stagedConflict() throws -> (UUID, Data, Data) {
        let original = try pack("original"), prepared = try pack("prepared"), external = try pack("external")
        try original.write(to: target)
        let operation = UUID()
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(original), prepared: prepared, operation: operation) { stage in
            if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Original.textpack", expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
            if stage == "beforeSwap" { try external.write(to: self.target, options: .atomic) }
        }) { error in
            guard case RetainedFileReplacement.Failure.unresolved = error else { return XCTFail("Unexpected staging error: \(error)") }
        }
        return (operation, prepared, external)
    }
    func testRenamedCandidateCannotBypassReadOrLostReplyFence() throws {
        let (_, prepared, _) = try stagedConflict()
        let renamed = root.appendingPathComponent("renamed.textpack")
        try FileManager.default.moveItem(at: target, to: renamed)
        XCTAssertEqual(try Data(contentsOf: renamed), prepared)
        XCTAssertThrowsError(try store.read(path: "renamed.textpack"))
        XCTAssertThrowsError(try store.readMetadata(path: "renamed.textpack"))
        // Even a matching visible hash cannot turn retained conflict into ACK.
        XCTAssertThrowsError(try store.replaceExact(path: "renamed.textpack", expectedHash: hash(prepared), bytes: prepared))
        XCTAssertThrowsError(try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "registry-item"))
    }
    func testExplicitRecoveryFollowsIdentityRetainsBothAndKeepsCurrent() throws {
        let (operation, prepared, external) = try stagedConflict()
        try FileManager.default.moveItem(at: target, to: root.appendingPathComponent("Moved.textpack"))
        let entry = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertEqual(entry.path, "Moved.textpack")
        XCTAssertEqual(entry.id, operation.uuidString)
        XCTAssertNoThrow(try store.recoveryList(path: entry.path))
        XCTAssertEqual(try store.replacementRecoveryRead(id: entry.id, version: "prepared").data, prepared)
        XCTAssertEqual(try store.replacementRecoveryRead(id: entry.id, version: "displaced").data, external)
        XCTAssertThrowsError(try store.resolveReplacement(id: entry.id, path: entry.path, itemId: "wrong-item", currentHash: entry.currentHash, preparedHash: entry.preparedHash, displacedHash: entry.displacedHash))
        try store.resolveReplacement(id: entry.id, path: entry.path, itemId: entry.itemId, currentHash: entry.currentHash, preparedHash: entry.preparedHash, displacedHash: entry.displacedHash)
        XCTAssertEqual(try store.read(path: entry.path).hash, hash(prepared))
        XCTAssertEqual(try store.recoveryList().entries.count, 2)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(entry.path)), prepared)
        // A stale descriptor's further edit must reopen the explicit fence.
        let registered = try XCTUnwrap(registry.entries().first)
        let inspection = try registry.inspect(registered)
        try Data("late bytes".utf8).write(to: inspection.recovery.displaced)
        XCTAssertThrowsError(try store.read(path: entry.path))
    }
    func testFutureRegistryAndWorkspaceCopyRefuseWithoutChangingBytes() throws {
        _ = try stagedConflict()
        let index = root.appendingPathComponent(".texttext/replacement-index")
        let manifest = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: index, includingPropertiesForKeys: nil).first)
        let original = try Data(contentsOf: manifest)
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: original) as? [String: Any])
        value["version"] = 999
        try JSONSerialization.data(withJSONObject: value).write(to: manifest)
        let changed = try Data(contentsOf: target)
        XCTAssertThrowsError(try registry.assertReadable(itemId: "registry-item"))
        XCTAssertThrowsError(try store.read(path: "Original.textpack"))
        XCTAssertEqual(try Data(contentsOf: target), changed)
        try original.write(to: manifest)
        let other = root.appendingPathComponent("Other", isDirectory: true)
        try FileManager.default.createDirectory(at: other.appendingPathComponent(".texttext/replacement-index"), withIntermediateDirectories: true)
        try original.write(to: other.appendingPathComponent(".texttext/replacement-index/" + manifest.lastPathComponent))
        XCTAssertThrowsError(try ReplacementRecoveryRegistry(root: other).entries())
    }
    func testExplicitResolutionAllowsNextSamePathSaveAndStillDetectsLateWriter() throws {
        let (oldOperation, prepared, _) = try stagedConflict()
        let entry = try XCTUnwrap(store.replacementRecoveryList().first)
        try store.resolveReplacement(id: entry.id, path: entry.path, itemId: entry.itemId, currentHash: entry.currentHash, preparedHash: entry.preparedHash, displacedHash: entry.displacedHash)
        let next = try pack("next edit"), operation = UUID()
        _ = try RetainedFileReplacement.replace(target, expectedHash: hash(prepared), prepared: next, operation: operation) { stage in
            if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Original.textpack", expectedHash: self.hash(prepared), preparedHash: self.hash(next)) }
        }
        XCTAssertEqual(try store.read(path: "Original.textpack").hash, hash(next))
        let old = try XCTUnwrap(registry.entries().first(where: { $0.operation == oldOperation }))
        try Data("later retained edit".utf8).write(to: registry.inspect(old).recovery.displaced)
        XCTAssertThrowsError(try store.read(path: "Original.textpack"))
    }
    func testInterruptedResolutionRemainsDiscoverableAndCompletesBeforeNextSave() throws {
        let (operation, prepared, _) = try stagedConflict()
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertThrowsError(try registry.resolve(operation: operation, visible: target, itemId: shown.itemId,
            observed: .init(visibleHash: shown.currentHash, preparedHash: shown.preparedHash, displacedHash: shown.displacedHash)) { stage in
                if stage == "resolutionPreserved" { throw Interrupted.stopped }
            })
        let persisted = try XCTUnwrap(registry.entries().first)
        XCTAssertNotNil(persisted.resolution)
        XCTAssertEqual(try registry.inspect(persisted).recovery.record.state, .conflict)
        XCTAssertEqual(try store.read(path: "Original.textpack").hash, hash(prepared))
        let reopened = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertTrue(reopened.resolved)
        XCTAssertEqual(try registry.inspect(persisted).recovery.record.acknowledgedDisplacedHash, shown.displacedHash)
        _ = try RetainedFileReplacement.replace(target, expectedHash: hash(prepared), prepared: pack("another save"))
    }
    func testCompletedSaveFollowsFileThenFolderMoveAndAllowsAnotherSave() throws {
        let before = root.appendingPathComponent("Before", isDirectory: true)
        try FileManager.default.createDirectory(at: before, withIntermediateDirectories: true)
        let original = try pack("original"), prepared = try pack("prepared"), next = try pack("next")
        let oldTarget = before.appendingPathComponent("Original.textpack"), operation = UUID()
        try original.write(to: oldTarget)
        _ = try RetainedFileReplacement.replace(oldTarget, expectedHash: hash(original), prepared: prepared, operation: operation) { stage in
            if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Before/Original.textpack", expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
        }
        try FileManager.default.moveItem(at: oldTarget, to: before.appendingPathComponent("Renamed.textpack"))
        XCTAssertEqual(try store.read(path: "Before/Renamed.textpack").hash, hash(prepared))
        let after = root.appendingPathComponent("After", isDirectory: true)
        try FileManager.default.moveItem(at: before, to: after)
        XCTAssertEqual(try store.read(path: "After/Renamed.textpack").hash, hash(prepared))
        let nextOperation = UUID()
        _ = try RetainedFileReplacement.replace(after.appendingPathComponent("Renamed.textpack"), expectedHash: hash(prepared), prepared: next, operation: nextOperation) { stage in
            if stage == "prepared" { try self.registry.register(operation: nextOperation, itemId: "registry-item", path: "After/Renamed.textpack", expectedHash: self.hash(prepared), preparedHash: self.hash(next)) }
        }
        XCTAssertEqual(try store.read(path: "After/Renamed.textpack").hash, hash(next))
        let old = try XCTUnwrap(registry.entries().first(where: { $0.operation == operation }))
        XCTAssertEqual(old.recoveryPath, "After/Original.textpack")
        let retained = try registry.inspect(old)
        XCTAssertEqual(retained.prepared, prepared)
        try Data("old descriptor changed".utf8).write(to: retained.recovery.displaced)
        XCTAssertThrowsError(try store.read(path: "After/Renamed.textpack"))
    }
    func testLostReplyAfterSuccessfulSwapReconstructsExactCompletion() throws {
        let original = try pack("original"), prepared = try pack("prepared")
        try original.write(to: target)
        let operation = UUID()
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(original), prepared: prepared, operation: operation) { stage in
            if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Original.textpack", expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
            if stage == "swapped" { throw Interrupted.stopped }
        })
        XCTAssertNoThrow(try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: "registry-item"))
        XCTAssertEqual(try store.read(path: "Original.textpack").hash, hash(prepared))
    }
    func testOneThousandRetainedSavesUsePersistedFingerprintAttestations() throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_RETAINED_BENCHMARK"] == "1" else { throw XCTSkip("Opt-in retained history performance campaign") }
        var previous = Data(repeating: 0, count: 128 * 1024)
        try previous.write(to: target)
        let started = Date()
        for generation in 1...1000 {
            var prepared = Data(repeating: UInt8(generation % 251), count: previous.count)
            prepared.replaceSubrange(0..<8, with: withUnsafeBytes(of: UInt64(generation).littleEndian) { Data($0) })
            let operation = UUID(), expected = hash(previous)
            _ = try RetainedFileReplacement.replace(target, expectedHash: expected, prepared: prepared, operation: operation) { stage in
                if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Original.textpack", expectedHash: expected, preparedHash: self.hash(prepared)) }
            }
            previous = prepared
        }
        let readStarted = Date()
        try registry.assertReadable(itemId: "registry-item")
        let readElapsed = Date().timeIntervalSince(readStarted)
        let cachedStarted = Date()
        try registry.assertReadable(itemId: "registry-item")
        let cachedElapsed = Date().timeIntervalSince(cachedStarted)
        print("Retained replacement probe: 1000 saves of 128 KiB, total \(Date().timeIntervalSince(started)) seconds; first registry read \(readElapsed) seconds; cached read \(cachedElapsed) seconds")
        XCTAssertLessThan(readElapsed, 3)
        XCTAssertEqual(try registry.entries().count, 1000)
        for recovery in try RetainedFileReplacement.inspect(target) {
            XCTAssertNotNil(recovery.record.preparedFingerprint)
            XCTAssertNotNil(recovery.record.displacedFingerprint)
        }
        XCTAssertEqual(try Data(contentsOf: target), previous)
    }
}
