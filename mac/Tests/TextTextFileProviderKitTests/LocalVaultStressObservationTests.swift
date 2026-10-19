#if TEXTTEXT_STRESS_ACTOR
import Foundation
import XCTest
import TextTextSyncTestSupport
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultStressObservationTests: XCTestCase {
    private func inventory(_ base: URL) throws -> [String: Data] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: base.path) else { return [:] }
        let enumeration = try XCTUnwrap(fm.enumerator(at: base, includingPropertiesForKeys: [.isRegularFileKey]))
        var result = [String: Data]()
        for case let url as URL in enumeration where try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
            result[url.path] = try Data(contentsOf: url)
        }
        return result
    }
    func testAbsentPrivateDirectoryStaysAbsent() throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        let base = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(base)
        defer { _ = LocalVaultDeviceState.exchangeConfiguredBase(previous); try? fm.removeItem(at: root); try? fm.removeItem(at: base) }
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let state = LocalVaultDeviceState.directory(root: root)
        XCTAssertFalse(fm.fileExists(atPath: base.path))
        let proof = try LocalVaultSharedEditingStore(root: root, accountId: "account-a").stressProtectionSnapshot(itemId: "item")
        XCTAssertTrue(proof.fingerprints.isEmpty); XCTAssertFalse(proof.protected)
        XCTAssertFalse(fm.fileExists(atPath: state.path)); XCTAssertFalse(fm.fileExists(atPath: base.path))
    }
    func testCompletedFolderHistoryAttestsAndPendingRefusesWithoutCreatingLease() throws {
        for interrupt in [false, true] {
            let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
            let base = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
            let previous = LocalVaultDeviceState.exchangeConfiguredBase(base)
            defer { _ = LocalVaultDeviceState.exchangeConfiguredBase(previous); try? fm.removeItem(at: root); try? fm.removeItem(at: base) }
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
            let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
            // The real owner is published only on an empty root. Populate the
            // controlled folder afterward; never fabricate an adoption marker.
            try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
            try fm.createDirectory(at: root.appendingPathComponent("Before"), withIntermediateDirectories: true)
            try Data("owned bytes".utf8).write(to: root.appendingPathComponent("Before/file.bin"))
            var reachedStage = false
            do {
                try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
                    if stage == "folderPrepared" { reachedStage = true }
                    if interrupt && stage == "folderPrepared" { throw CocoaError(.userCancelled) }
                }
                XCTAssertFalse(interrupt)
            } catch { XCTAssertTrue(interrupt) }
            XCTAssertTrue(reachedStage)
            let state = LocalVaultDeviceState.directory(root: root), lease = state.appendingPathComponent("folder-case-renames.lock")
            if fm.fileExists(atPath: lease.path) { try fm.moveItem(at: lease, to: root.appendingPathComponent("retained-folder-lease")) }
            let before = try inventory(base), visible = try inventory(root)
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                from: Data(contentsOf: state.appendingPathComponent("account-owner.json")))
            let principal = try RetainedReplacementProfile.principalHash(owner)
            if interrupt {
                XCTAssertThrowsError(try LocalVaultSharedEditingStore(root: root, accountId: "account-a").stressProtectionSnapshot(itemId: "item", principalHash: principal))
            } else {
                let proof = try LocalVaultSharedEditingStore(root: root, accountId: "account-a").stressProtectionSnapshot(itemId: "item", principalHash: principal)
                XCTAssertFalse(proof.protected); XCTAssertTrue(proof.fingerprints.keys.contains { $0.hasPrefix("history/folder/") })
            }
            XCTAssertEqual(try inventory(base), before); XCTAssertEqual(try inventory(root), visible)
            XCTAssertFalse(fm.fileExists(atPath: lease.path))
        }
    }
    func testGenuineProfilePublicationNeverRepairsOrCreatesLease() throws {
        for interrupt in [false, true] {
            let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
            let base = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
            let previous = LocalVaultDeviceState.exchangeConfiguredBase(base)
            var fixtureFinished = false
            defer {
                _ = LocalVaultDeviceState.exchangeConfiguredBase(previous)
                if fixtureFinished { try? fm.removeItem(at: root); try? fm.removeItem(at: base) }
                else { print("ASSET_PROFILE_RETAINED_FIXTURE", root.path, base.path) }
            }
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
            let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
            try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
            var reachedStage = false
            do {
                try RetainedReplacementProfile.prepare(root: root) { stage in
                    if stage == "ownerStaged" { reachedStage = true }
                    if interrupt && stage == "ownerStaged" { throw CocoaError(.userCancelled) }
                }
                XCTAssertFalse(interrupt)
            } catch { XCTAssertTrue(interrupt) }
            XCTAssertTrue(reachedStage)
            // Normal setup may finish its own retained publication. The
            // readonly interval begins only after genuine stable admission;
            // interrupted setup intentionally receives no such repair.
            if !interrupt {
                let state = LocalVaultDeviceState.directory(root: root)
                let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                    from: Data(contentsOf: state.appendingPathComponent("account-owner.json")))
                try RetainedReplacementProfile.verify(root: root, owner: owner)
            }
            let state = LocalVaultDeviceState.directory(root: root), lease = state.appendingPathComponent("retained-replacement-profile.lock")
            if fm.fileExists(atPath: lease.path) { try fm.moveItem(at: lease, to: root.appendingPathComponent("retained-profile-lease")) }
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: Data(contentsOf: state.appendingPathComponent("account-owner.json")))
            let before = try inventory(base), visible = try inventory(root)
            if interrupt {
                XCTAssertThrowsError(try RetainedReplacementProfile.stressObservation(stateDirectory: state, owner: owner, expectedRootHash: owner.rootHash))
            } else {
                for target in [state.appendingPathComponent("account-owner.json"), state.appendingPathComponent("retained-replacement-profile/profile.json")] {
                    for record in try RetainedFileReplacement.inspect(target) {
                        print("ASSET_PROFILE_DIAGNOSTIC", target.lastPathComponent, record.record.state,
                            record.record.preparedFingerprint != nil, record.record.displacedFingerprint != nil,
                            record.record.preparedFingerprint == (try? RetainedFileReplacement.fingerprint(record.prepared)),
                            record.record.displacedFingerprint == (try? RetainedFileReplacement.fingerprint(record.displaced)))
                    }
                }
                let observed = try RetainedReplacementProfile.stressObservation(stateDirectory: state, owner: owner, expectedRootHash: owner.rootHash)
                XCTAssertFalse(observed.isEmpty)
                let layout = try RetainedFileReplacement.layout(target: state.appendingPathComponent("account-owner.json"))
                let operationBase = URL(fileURLWithPath: layout.basePath)
                let retainedBase = root.appendingPathComponent("retained-profile-operation-base")
                try fm.moveItem(at: operationBase, to: retainedBase)
                try fm.createSymbolicLink(at: operationBase, withDestinationURL: retainedBase)
                let linkedPrivate = try inventory(base), linkedVisible = try inventory(root)
                XCTAssertThrowsError(try RetainedReplacementProfile.stressObservation(stateDirectory: state, owner: owner, expectedRootHash: owner.rootHash))
                XCTAssertEqual(try inventory(base), linkedPrivate); XCTAssertEqual(try inventory(root), linkedVisible)
                XCTAssertFalse(fm.fileExists(atPath: lease.path))
                try fm.removeItem(at: operationBase)
                try fm.moveItem(at: retainedBase, to: operationBase)
                XCTAssertFalse(try RetainedReplacementProfile.stressObservation(stateDirectory: state, owner: owner, expectedRootHash: owner.rootHash).isEmpty)
            }
            XCTAssertEqual(try inventory(base), before); XCTAssertEqual(try inventory(root), visible)
            XCTAssertFalse(fm.fileExists(atPath: lease.path))
            fixtureFinished = true
        }
    }
    func testCompletedReplacementHistoryUsesOnlyExactStableRetainedRecords() throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        let base = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(base)
        var fixtureFinished = false
        defer {
            _ = LocalVaultDeviceState.exchangeConfiguredBase(previous)
            if fixtureFinished { try? fm.removeItem(at: root); try? fm.removeItem(at: base) }
            else { print("ASSET_REPLACEMENT_RETAINED_FIXTURE", root.path, base.path) }
        }
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let item = "e1111111-1111-4111-8111-111111111111", path = "Owned.textpack"
        let document = try BuiltinTextPackDocument.create(title: "Owned", body: "Body")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \(item)\n---\n\nBody", documentJSON: document.documentJSON,
            templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
        let temporary = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try fm.moveItem(at: temporary, to: root.appendingPathComponent(path))
        print("ASSET_REPLACEMENT_STAGE", "before-read")
        let store = LocalVaultDocumentStore(root: root), original = try store.read(path: path)
        print("ASSET_REPLACEMENT_STAGE", "before-write")
        let changedBody = "Body changed for retained history"
        let changed = try BuiltinTextPackDocument.create(title: "Owned", body: changedBody)
        let written = try store.write(path: path, expectedHash: original.hash,
            markdown: "---\ntextTextId: \(item)\n---\n\n" + changedBody,
            documentJSON: changed.documentJSON, templateJSON: changed.templateJSON,
            templateAuthoringSourceJSON: original.contents.templateAuthoringSourceJSON)
        XCTAssertNotEqual(written.hash, original.hash, "Fixture must actually publish a retained replacement, never an idempotent no-op")
        print("ASSET_REPLACEMENT_STAGE", "after-write")
        let state = LocalVaultDeviceState.directory(root: root)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
            from: Data(contentsOf: state.appendingPathComponent("account-owner.json")))
        try RetainedReplacementProfile.verify(root: root, owner: owner)
        let principal = try RetainedReplacementProfile.principalHash(owner), registry = ReplacementRecoveryRegistry(root: root)
        let records = try registry.entries(itemId: item)
        let entry = try XCTUnwrap(records.first); XCTAssertEqual(records.count, 1)
        let index = state.appendingPathComponent("replacement-index/" + entry.operation.uuidString + ".json")
        let operation = RetainedFileReplacement.operationDirectory(target: root.appendingPathComponent(entry.recoveryPath ?? entry.path), operation: entry.operation)
        let lease = state.appendingPathComponent("retained-replacement-profile.lock")
        if fm.fileExists(atPath: lease.path) { try fm.moveItem(at: lease, to: root.appendingPathComponent("retained-profile-lease")) }
        func snapshot() throws -> [String: Data] {
            var result = try inventory(base)
            for (key, value) in try inventory(root) {
                guard result[key] == nil else { throw CocoaError(.fileReadCorruptFile) }
                result[key] = value
            }
            return result
        }
        func refusesWithoutWrites() throws {
            let before = try snapshot()
            XCTAssertThrowsError(try registry.stressCompletedHistory(principalHash: principal))
            XCTAssertEqual(try snapshot(), before); XCTAssertFalse(fm.fileExists(atPath: lease.path))
        }
        print("ASSET_REPLACEMENT_STAGE", "before-readonly-history")
        let before = try snapshot(), proof = try registry.stressCompletedHistory(principalHash: principal)
        print("ASSET_REPLACEMENT_STAGE", "after-readonly-history")
        XCTAssertNotNil(proof[entry.operation.uuidString + "/prepared"])
        XCTAssertEqual(try snapshot(), before); XCTAssertFalse(fm.fileExists(atPath: lease.path))
        let raw = try Data(contentsOf: index)
        var duplicate = Data("{\"version\":1,".utf8); duplicate.append(raw.dropFirst())
        try duplicate.write(to: index); try refusesWithoutWrites(); try raw.write(to: index)
        let staged = state.appendingPathComponent("replacement-index/.staged-owned-test")
        try Data("{}".utf8).write(to: staged); try refusesWithoutWrites()
        try fm.moveItem(at: staged, to: root.appendingPathComponent("retained-unknown-index"))
        let relocated = root.appendingPathComponent("retained-relocated-operation")
        try fm.moveItem(at: operation, to: relocated); try refusesWithoutWrites()
        try fm.moveItem(at: relocated, to: operation)
        let prepared = operation.appendingPathComponent("prepared"), handle = try FileHandle(forWritingTo: prepared)
        try handle.seekToEnd(); try handle.write(contentsOf: Data("owned retained mutation".utf8)); try handle.close()
        try refusesWithoutWrites()
        fixtureFinished = true
    }
    func testActualSessionTokenAndReadonlyProtection() async throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        let state = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(state)
        defer { _ = LocalVaultDeviceState.exchangeConfiguredBase(previous); try? fm.removeItem(at: root); try? fm.removeItem(at: state) }
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let item = "e1111111-1111-4111-8111-111111111111", path = "Owned.textpack"
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
        let document = try BuiltinTextPackDocument.create(title: "Owned", body: "Body")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \(item)\n---\n\nBody", documentJSON: document.documentJSON,
            templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
        let temporary = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try fm.moveItem(at: temporary, to: root.appendingPathComponent(path))
        let engine = try makeTestSync(root: root, binding: binding, transport: ObservationTransport(), accountId: "account-a")
        _ = try await engine.sync()
        let original = try LocalVaultDocumentStore(root: root).read(path: path)
        let session = try await engine.beginSharedEditing(itemId: item, path: path, expectedHash: original.hash)
        func inventory() throws -> [String: Data] {
            var result = [String: Data]()
            for base in [root, state] {
                let enumeration = try XCTUnwrap(fm.enumerator(at: base, includingPropertiesForKeys: [.isRegularFileKey]))
                for case let url as URL in enumeration where try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
                    result[url.path] = try Data(contentsOf: url)
                }
            }
            return result
        }
        let before = try inventory()
        let first = try await engine.stressSessionObservation(sessionToken: session.sessionToken, itemId: item)
        XCTAssertEqual(first.path, path); XCTAssertEqual(first.accountId, "account-a")
        XCTAssertEqual(try inventory(), before)
        do { _ = try await engine.stressSessionObservation(sessionToken: "wrong", itemId: item); XCTFail("Wrong session accepted") } catch {}
        XCTAssertEqual(try inventory(), before)
        try await engine.endSharedEditing(sessionToken: session.sessionToken, itemId: item)
        do { _ = try await engine.stressSessionObservation(sessionToken: session.sessionToken, itemId: item); XCTFail("Closed session accepted") } catch {}
        let reopened = try await engine.beginSharedEditing(itemId: item, path: path, expectedHash: original.hash)
        let second = try await engine.stressSessionObservation(sessionToken: reopened.sessionToken, itemId: item)
        XCTAssertNotEqual(first.token, second.token, "Same path cannot conceal a new session")
        try await engine.endSharedEditing(sessionToken: reopened.sessionToken, itemId: item)
    }
}
private actor ObservationTransport: LocalVaultSyncTransport {
    func manifest() async throws -> [LocalVaultRemoteItem] { [] }
    func download(itemId: String) async throws -> LocalVaultRemotePack { throw LocalVaultSyncFailure.invalidResponse }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String { TextTextStableDigest.sha256Hex(data) }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws { throw LocalVaultSyncFailure.invalidResponse }
}
#endif
