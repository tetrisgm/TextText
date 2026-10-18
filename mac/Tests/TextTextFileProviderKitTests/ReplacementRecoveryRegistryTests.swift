import Foundation
import Darwin
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class ReplacementRecoveryRegistryTests: XCTestCase {
    private var root: URL!
    private var preserveBenchmark = false
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
    override func tearDownWithError() throws { if !preserveBenchmark { try? FileManager.default.removeItem(at: root) } }
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
    func testCompletedSaveFollowsCaseOnlyContainingFolderRename() throws {
        let before = root.appendingPathComponent("CaseFolder", isDirectory: true)
        try FileManager.default.createDirectory(at: before, withIntermediateDirectories: true)
        let original = try pack("original"), prepared = try pack("prepared"), next = try pack("next")
        let file = before.appendingPathComponent("Original.textpack"), operation = UUID()
        try original.write(to: file)
        _ = try RetainedFileReplacement.replace(file, expectedHash: hash(original), prepared: prepared, operation: operation) { phase in
            if phase == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "CaseFolder/Original.textpack", expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
        }
        let changed = root.appendingPathComponent("casefolder", isDirectory: true)
        XCTAssertEqual(rename(before.path, changed.path), 0)
        XCTAssertEqual(try store.read(path: "casefolder/Original.textpack").hash, hash(prepared))
        _ = try RetainedFileReplacement.replace(changed.appendingPathComponent("Original.textpack"), expectedHash: hash(prepared), prepared: next)
        XCTAssertEqual(try store.read(path: "casefolder/Original.textpack").hash, hash(next))
    }
    func testListingRetainedVersionsDoesNotWriteRecoveryCopies() throws {
        let (operation, _, _) = try stagedConflict()
        let destination = root.appendingPathComponent(".texttext/conflicts/" + operation.uuidString)
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        let shown = try XCTUnwrap(store.replacementRecoveryList().first)
        _ = try store.replacementRecoveryRead(id: shown.id, version: "displaced")
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: shown.currentHash, preparedHash: shown.preparedHash, displacedHash: shown.displacedHash)
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.path))
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
    func testIdentityIndexInvalidatesOnPublicationAndValidatesSelectedBytes() throws {
        let h = hash(Data("bytes".utf8))
        try registry.register(operation: UUID(), itemId: "first", path: "First.textpack", expectedHash: h, preparedHash: h)
        XCTAssertEqual(try registry.entries(itemId: "first").count, 1)
        let second = UUID()
        try registry.register(operation: second, itemId: "second", path: "Second.textpack", expectedHash: h, preparedHash: h)
        XCTAssertEqual(try registry.entries(itemId: "second").count, 1)
        let path = LocalVaultDeviceState.directory(root: root).appendingPathComponent("replacement-index/" + second.uuidString + ".json")
        var fields = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any])
        fields["version"] = 99
        try JSONSerialization.data(withJSONObject: fields).write(to: path)
        XCTAssertThrowsError(try registry.entries(itemId: "second"))
        XCTAssertEqual(try registry.entries(itemId: "first").count, 1)
        XCTAssertThrowsError(try registry.entries())
    }
    func testRecoveryListingDoesNotClassifyLostReplyOrWriteExports() throws {
        let original = try pack("original"), prepared = try pack("prepared")
        try original.write(to: target)
        let operation = UUID()
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(original), prepared: prepared, operation: operation) { stage in
            if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Original.textpack", expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
            if stage == "swapped" { throw Interrupted.stopped }
        })
        let retained = try RetainedFileReplacement.recovery(target: target, operation: operation)
        let manifest = retained.directory.appendingPathComponent("manifest.json")
        let before = try Data(contentsOf: manifest)
        XCTAssertTrue(try store.replacementRecoveryList().isEmpty)
        XCTAssertEqual(try Data(contentsOf: manifest), before)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext/conflicts").path))
    }
    func testMissingOwnerWithRetainedProfileRefusesEmptyIndex() throws {
        let state = LocalVaultDeviceState.directory(root: root)
        try FileManager.default.createDirectory(at: state.appendingPathComponent("retained-replacement-profile"), withIntermediateDirectories: true)
        XCTAssertThrowsError(try registry.assertReadable(itemId: "not-indexed"))
    }
    func testAlreadyOpenStoreRejectsUnattestedProfilesWithoutReplacementIndex() throws {
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let bytes = try pack("visible")
        try bytes.write(to: target)
        let opened = store
        XCTAssertEqual(try opened.read(path: "Original.textpack").hash, hash(bytes))
        let owner = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let before = try Data(contentsOf: owner)
        try RetainedReplacementProfile.prepare(root: root)
        let after = try Data(contentsOf: owner)
        let marker = owner.deletingLastPathComponent().appendingPathComponent("retained-replacement-profile/profile.json")
        var future = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? [String: Any])
        future["version"] = 999
        try JSONSerialization.data(withJSONObject: future).write(to: marker)
        for ownerBytes in [before, after] {
            try ownerBytes.write(to: owner, options: .atomic)
            XCTAssertThrowsError(try opened.read(path: "Original.textpack"))
            XCTAssertThrowsError(try opened.readMetadata(path: "Original.textpack"))
            XCTAssertThrowsError(try registry.assertReadable(itemId: "registry-item"))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: owner.deletingLastPathComponent().appendingPathComponent("replacement-index").path))
        XCTAssertEqual(try Data(contentsOf: target), bytes)
    }
    func testWorkspaceStagingAllowsManagedFolderPruneAndFollowsVisibleMove() throws {
        let folder = root.appendingPathComponent("Folder")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let visible = folder.appendingPathComponent("Document.textpack")
        let before = try pack("before"), after = try pack("after")
        try before.write(to: visible)
        let operation = UUID(), path = "Folder/Document.textpack"
        _ = try RetainedFileReplacement.replace(visible, expectedHash: hash(before), prepared: after,
            operation: operation, recoveryRoot: registry.recoveryRoot(path: path)) { stage in
            if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: path,
                expectedHash: self.hash(before), preparedHash: self.hash(after), workspaceStaging: true) }
        }
        try FileManager.default.moveItem(at: visible, to: target)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: folder.path).isEmpty)
        try FileManager.default.removeItem(at: folder)
        XCTAssertNoThrow(try registry.assertReadable(itemId: "registry-item"))
        XCTAssertEqual(try store.read(path: "Original.textpack").hash, hash(after))
        let retained = try registry.inspect(XCTUnwrap(try registry.entries().first))
        XCTAssertEqual(retained.displaced, before)
        XCTAssertEqual(retained.prepared, after)
    }
    func testProductionWriteRetainsFinalGapWriterAndFencesReplayUntilRecovery() throws {
        let original = try pack("original"), external = try pack("external final writer")
        try original.write(to: target)
        let observed = try store.read(path: "Original.textpack")
        var writer = store
        writer.writeObservationForTesting = { stage in
            if stage == "beforeSwap" { try external.write(to: self.target, options: .atomic) }
        }
        XCTAssertThrowsError(try writer.write(path: observed.path, expectedHash: observed.hash,
            markdown: observed.contents.markdown + "\nuser candidate", documentJSON: nil, templateJSON: nil,
            templateAuthoringSourceJSON: nil, mutationKey: "retained-final-gap", mutationFingerprint: hash(Data("request".utf8))))
        XCTAssertThrowsError(try store.read(path: observed.path))
        let entry = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertEqual(try store.replacementRecoveryRead(id: entry.id, version: "displaced").data, external)
        let current = try store.replacementRecoveryRead(id: entry.id, version: "current")
        XCTAssertThrowsError(try store.write(path: observed.path, expectedHash: XCTUnwrap(entry.currentHash),
            markdown: try XCTUnwrap(current.document).contents.markdown, documentJSON: nil, templateJSON: nil,
            templateAuthoringSourceJSON: nil, mutationKey: "retained-final-gap", mutationFingerprint: hash(Data("request".utf8))))
        try store.resolveReplacement(id: entry.id, path: entry.path, itemId: entry.itemId, currentHash: entry.currentHash,
            preparedHash: entry.preparedHash, displacedHash: entry.displacedHash)
        let replay = try store.write(path: observed.path, expectedHash: XCTUnwrap(entry.currentHash),
            markdown: try XCTUnwrap(current.document).contents.markdown, documentJSON: nil, templateJSON: nil,
            templateAuthoringSourceJSON: nil, mutationKey: "retained-final-gap", mutationFingerprint: hash(Data("request".utf8)))
        XCTAssertEqual(replay.hash, entry.currentHash)
        let saved = try store.write(path: observed.path, expectedHash: replay.hash, markdown: replay.contents.markdown + "\nnext save",
            documentJSON: nil, templateJSON: nil, templateAuthoringSourceJSON: nil)
        XCTAssertEqual(saved.hash, hash(try Data(contentsOf: target)))
    }
    func testProductionExactSwapLostReplyReconstructsAndPreservesMode() throws {
        let original = try pack("original"), prepared = try pack("prepared")
        try original.write(to: target)
        try FileManager.default.setAttributes([.posixPermissions: 0o640], ofItemAtPath: target.path)
        var writer = store
        writer.writeObservationForTesting = { if $0 == "swapped" { throw Interrupted.stopped } }
        XCTAssertThrowsError(try writer.replaceExact(path: "Original.textpack", expectedHash: hash(original), bytes: prepared))
        let reopened = try LocalVaultDocumentStore(root: root).read(path: "Original.textpack")
        XCTAssertEqual(reopened.hash, hash(prepared))
        XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: target.path)[.posixPermissions] as? Int, 0o640)
        XCTAssertTrue(try store.replacementRecoveryList().isEmpty)
        let saved = try store.replaceExact(path: "Original.textpack", expectedHash: hash(prepared), bytes: original)
        XCTAssertEqual(saved.hash, hash(original))
        XCTAssertEqual(try registry.entries().count, 2)
    }
    func testProductionOwnedSaveAttestsProfileBeforeExchange() throws {
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let original = try pack("original"), prepared = try pack("prepared")
        try original.write(to: target)
        let result = try store.replaceExact(path: "Original.textpack", expectedHash: hash(original), bytes: prepared)
        XCTAssertEqual(result.hash, hash(prepared))
        let ownerURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        XCTAssertEqual(try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: Data(contentsOf: ownerURL)).version, 2)
        XCTAssertNoThrow(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a"))
        XCTAssertThrowsError(try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-b"))
    }
    func testOneThousandDocumentIdentityLookupCampaign() throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_RETAINED_BENCHMARK"] == "1" else { throw XCTSkip("Opt-in many-document lookup campaign") }
        let before = Data("before".utf8), after = Data("after".utf8)
        for index in 0..<1000 {
            let path = "Document-\(index).textpack", operation = UUID()
            let visible = root.appendingPathComponent(path)
            try before.write(to: visible)
            _ = try RetainedFileReplacement.replace(visible, expectedHash: hash(before), prepared: after, operation: operation,
                recoveryRoot: registry.recoveryRoot(path: path)) { stage in
                if stage == "prepared" { try self.registry.register(operation: operation, itemId: "item-\(index)", path: path,
                    expectedHash: self.hash(before), preparedHash: self.hash(after), workspaceStaging: true) }
            }
        }
        let started = Date()
        for index in 0..<1000 { try registry.assertReadable(itemId: "item-\(index)") }
        print("Retained identity lookup probe: 1000 documents/normal read fences \(Date().timeIntervalSince(started)) seconds")
    }
    func testOneThousandRetainedSavesUsePersistedFingerprintAttestations() throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_RETAINED_BENCHMARK"] == "1" else { throw XCTSkip("Opt-in retained history performance campaign") }
        if let requested = ProcessInfo.processInfo.environment["TEXTTEXT_RETAINED_BENCHMARK_ROOT"] {
            let requestedURL = URL(fileURLWithPath: requested)
            guard let requestedParent = realpath(requestedURL.deletingLastPathComponent().path, nil),
                  let fixtureParent = realpath(root.deletingLastPathComponent().path, nil) else { throw Interrupted.stopped }
            defer { free(requestedParent); free(fixtureParent) }
            guard String(cString: requestedParent) == String(cString: fixtureParent),
                  requestedURL.lastPathComponent.hasPrefix("texttext-retained-benchmark-") else { throw Interrupted.stopped }
            let destination = URL(fileURLWithPath: String(cString: requestedParent)).appendingPathComponent(requestedURL.lastPathComponent)
            var existingInfo = stat()
            if lstat(destination.path, &existingInfo) == 0 {
                guard existingInfo.st_mode & S_IFMT == S_IFDIR else { throw Interrupted.stopped }
            } else if errno != ENOENT { throw Interrupted.stopped }
            let sentinel = destination.appendingPathComponent(".benchmark-owner")
            let proof = Data("TextText retained benchmark v2 workspace staging".utf8)
            if FileManager.default.fileExists(atPath: destination.path) {
                guard try StableFileSnapshot.read(sentinel, maximumBytes: 128) == proof else { throw Interrupted.stopped }
            } else {
                try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false)
                try RetainedFileReplacement.create(proof, at: sentinel)
            }
            try FileManager.default.removeItem(at: root) // Only this test's fresh temporary fixture.
            root = destination; preserveBenchmark = true
        }
        let existing = try registry.entries().count
        guard existing == 0 || existing == 1000 else { throw Interrupted.stopped }
        var previous = Data(repeating: 0, count: 128 * 1024)
        if existing == 0 { try previous.write(to: target) }
        else {
            previous = Data(repeating: UInt8(1000 % 251), count: previous.count)
            previous.replaceSubrange(0..<8, with: withUnsafeBytes(of: UInt64(1000).littleEndian) { Data($0) })
            XCTAssertEqual(try Data(contentsOf: target), previous)
        }
        let started = Date()
        for generation in (existing == 0 ? Array(1...1000) : []) {
            var prepared = Data(repeating: UInt8(generation % 251), count: previous.count)
            prepared.replaceSubrange(0..<8, with: withUnsafeBytes(of: UInt64(generation).littleEndian) { Data($0) })
            let operation = UUID(), expected = hash(previous)
            _ = try RetainedFileReplacement.replace(target, expectedHash: expected, prepared: prepared, operation: operation, recoveryRoot: registry.recoveryRoot(path: "Original.textpack")) { stage in
                if stage == "prepared" { try self.registry.register(operation: operation, itemId: "registry-item", path: "Original.textpack", expectedHash: expected, preparedHash: self.hash(prepared), workspaceStaging: true) }
            }
            previous = prepared
        }
        let readStarted = Date()
        try registry.assertReadable(itemId: "registry-item")
        let readElapsed = Date().timeIntervalSince(readStarted)
        let cachedStarted = Date()
        try registry.assertReadable(itemId: "registry-item")
        let cachedElapsed = Date().timeIntervalSince(cachedStarted)
        print("Retained replacement probe: \(existing == 0 ? "built 1000 workspace-staged saves of 128 KiB" : "reused 1000-save workspace fixture; guards only"), campaign \(Date().timeIntervalSince(started)) seconds; first registry read \(readElapsed) seconds; cached read \(cachedElapsed) seconds")
        XCTAssertLessThan(readElapsed, 3)
        XCTAssertEqual(try registry.entries().count, 1000)
        for recovery in try RetainedFileReplacement.inspect(registry.recoveryRoot(path: "Original.textpack").appendingPathComponent("Original.textpack")) {
            XCTAssertNotNil(recovery.record.preparedFingerprint)
            XCTAssertNotNil(recovery.record.displacedFingerprint)
        }
        XCTAssertEqual(try Data(contentsOf: target), previous)
    }
}
