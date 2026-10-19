import Foundation
import Darwin
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class SharedRenameProfileTests: XCTestCase {
    private enum Interrupted: Error { case stopped }
    private func fixture(_ body: (URL, URL) throws -> Void) throws {
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("shared-rename-profile-" + UUID().uuidString)
        let root = parent.appendingPathComponent("vault"), base = parent.appendingPathComponent("device")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        try LocalVaultDeviceState.withConfiguredBase(base) {
            try LocalVaultAccountRootOwnership.open(root: root, binding: .init(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
            try RetainedReplacementProfile.prepareLocalHandoff(root: root)
            try LocalVaultDeviceState.migrate(root: root)
            try body(root, base)
        }
    }
    private func folder(_ root: URL) -> URL { LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile") }
    func testFloorFivePreservesExactFourAndPendingBytesWithoutDowngrade() throws {
        try fixture { root, _ in
            let profile = folder(root).appendingPathComponent("profile.json"), prior = try Data(contentsOf: profile)
            let owner = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
            let ownerBytes = try Data(contentsOf: owner)
            let pending = LocalVaultDeviceState.directory(root: root).appendingPathComponent("pending.bin"), bytes = Data([0, 255, 1, 3])
            try bytes.write(to: pending)
            try RetainedReplacementProfile.prepareSharedRenames(root: root)
            XCTAssertEqual(try Data(contentsOf: folder(root).appendingPathComponent("profile-v4.json")), prior)
            XCTAssertEqual(try Data(contentsOf: owner), ownerBytes)
            XCTAssertEqual(try Data(contentsOf: pending), bytes)
            let published = try Data(contentsOf: profile)
            XCTAssertEqual((try JSONSerialization.jsonObject(with: published) as? [String: Any])?["version"] as? Int, 5)
            try RetainedFileRemoval.withLease(at: LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile.lock"), exclusive: false) {
                try RetainedReplacementProfile.prepareLocalHandoff(root: root)
                try RetainedReplacementProfile.prepareSharedRenames(root: root)
            }
            XCTAssertEqual(try Data(contentsOf: profile), published)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext").path))
        }
    }
    func testActualPendingCheckpointSurvivesFiveAndFreshStore() throws {
        try fixture { root, _ in
            let item = "floor-five-pending", path = "Note.textpack"
            let document = try BuiltinTextPackDocument.create(title: "Note", body: "Pending exact body")
            let markdown = "---\ntextTextId: \"floor-five-pending\"\n---\nPending exact body"
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
            let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
            let original = try LocalVaultDocumentStore(root: root).read(path: path)
            let journalObject: [String: Any] = ["version": 1, "accountId": "account-a", "journalGeneration": 7, "epoch": 1, "seq": 0, "revision": original.hash, "relativePath": path, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
            let journal = String(decoding: try JSONSerialization.data(withJSONObject: journalObject), as: UTF8.self)
            let shared = LocalVaultSharedEditingStore(root: root, accountId: "account-a")
            _ = try shared.materialize(checkpoint: .init(itemId: item, path: path, projectedHash: original.hash, acknowledgedRevision: original.hash, epoch: 1, seq: 0, journalGeneration: 7, journal: journal, pending: true), expectedHash: original.hash, markdown: markdown, documentJSON: try XCTUnwrap(document.documentJSON))
            let target = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/" + item + "/checkpoint.json")
            let before = try Data(contentsOf: target), projection = try Data(contentsOf: root.appendingPathComponent(path))
            try RetainedReplacementProfile.prepareSharedRenames(root: root)
            XCTAssertEqual(try Data(contentsOf: target), before)
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), projection)
            let reopened = try XCTUnwrap(LocalVaultSharedEditingStore(root: root, accountId: "account-a").checkpoint(itemId: item))
            XCTAssertTrue(reopened.pending); XCTAssertEqual(reopened.journalGeneration, 7); XCTAssertEqual(reopened.journal, journal)
        }
    }
    func testForeignPriorBackupRefusesWithoutOverwritingAnything() throws {
        try fixture { root, _ in
            let profile = folder(root).appendingPathComponent("profile.json"), prior = try Data(contentsOf: profile)
            let backup = folder(root).appendingPathComponent("profile-v4.json"), foreign = Data("foreign retained bytes".utf8)
            try foreign.write(to: backup, options: .withoutOverwriting)
            XCTAssertThrowsError(try RetainedReplacementProfile.prepareSharedRenames(root: root))
            XCTAssertEqual(try Data(contentsOf: profile), prior)
            XCTAssertEqual(try Data(contentsOf: backup), foreign)
        }
    }
    func testFolderCaseRenameStillWorksAtFloorFive() throws {
        try fixture { root, _ in
            try RetainedReplacementProfile.prepareSharedRenames(root: root)
            try FileManager.default.createDirectory(at: root.appendingPathComponent("Before"), withIntermediateDirectories: false)
            try FileManager.default.createDirectory(at: root.appendingPathComponent("Before/Empty"), withIntermediateDirectories: false)
            let bytes = Data([3, 2, 1, 0]); try bytes.write(to: root.appendingPathComponent("Before/bytes.bin"))
            try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before")
            try FolderCaseRename(root: root).assertReadable()
            let names = try FileManager.default.contentsOfDirectory(atPath: root.path)
            XCTAssertTrue(names.contains("before")); XCTAssertFalse(names.contains("Before"))
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("before/bytes.bin")), bytes)
            XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("before/Empty").path))
        }
    }
    func testOtherDeviceProfileRemainsFourForSameVault() throws {
        try fixture { root, base in
            let other = base.deletingLastPathComponent().appendingPathComponent("other-device")
            let otherProfile = LocalVaultDeviceState.directory(root: root, base: other).appendingPathComponent("retained-replacement-profile/profile.json")
            try LocalVaultDeviceState.withConfiguredBase(other) {
                try LocalVaultAccountRootOwnership.open(root: root, binding: .init(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
                try RetainedReplacementProfile.prepareLocalHandoff(root: root)
            }
            let bytes = try Data(contentsOf: otherProfile)
            try RetainedReplacementProfile.prepareSharedRenames(root: root)
            XCTAssertEqual(try Data(contentsOf: otherProfile), bytes)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext/retained-replacement-profile").path))
        }
    }
    func testInterruptedPublicationRetainsFourAndRecoversBeforeReady() throws {
        for boundary in ["sharedRenameMigrationReady", "sharedRenameProfileBeforeBackup", "sharedRenameProfilePreserved", "sharedRenameProfile:beforeSwap", "sharedRenameProfile:swapped", "sharedRenameProfileReady"] {
            try fixture { root, _ in
                let prior = try Data(contentsOf: folder(root).appendingPathComponent("profile.json"))
                let pending = LocalVaultDeviceState.directory(root: root).appendingPathComponent("pending.bin")
                try Data("pending operation unchanged".utf8).write(to: pending)
                XCTAssertThrowsError(try RetainedReplacementProfile.prepareSharedRenames(root: root) { if $0 == boundary { throw Interrupted.stopped } })
                try RetainedReplacementProfile.prepareSharedRenames(root: root)
                XCTAssertEqual(try Data(contentsOf: folder(root).appendingPathComponent("profile-v4.json")), prior)
                XCTAssertEqual(try Data(contentsOf: pending), Data("pending operation unchanged".utf8))
                try LocalVaultAccountRootOwnership.open(root: root, binding: .init(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
            }
        }
    }
    func testUnmigratedLegacyStateRefusesWithoutImportOrOverwrite() throws {
        try fixture { root, base in
            let otherRoot = root.deletingLastPathComponent().appendingPathComponent("unmigrated-vault")
            let otherBase = base.deletingLastPathComponent().appendingPathComponent("unmigrated-device")
            try FileManager.default.createDirectory(at: otherRoot, withIntermediateDirectories: true)
            try LocalVaultDeviceState.withConfiguredBase(otherBase) {
                try LocalVaultAccountRootOwnership.open(root: otherRoot, binding: .init(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
                try RetainedReplacementProfile.prepareLocalHandoff(root: otherRoot)
                let profile = folder(otherRoot).appendingPathComponent("profile.json"), before = try Data(contentsOf: profile)
                let legacy = otherRoot.appendingPathComponent(".texttext/sync/pending.bin")
                try FileManager.default.createDirectory(at: legacy.deletingLastPathComponent(), withIntermediateDirectories: true)
                let bytes = Data([255, 8, 0, 7]); try bytes.write(to: legacy)
                XCTAssertThrowsError(try RetainedReplacementProfile.prepareSharedRenames(root: otherRoot))
                XCTAssertEqual(try Data(contentsOf: profile), before)
                XCTAssertEqual(try Data(contentsOf: legacy), bytes)
                XCTAssertFalse(FileManager.default.fileExists(atPath: LocalVaultDeviceState.directory(root: otherRoot).appendingPathComponent("sync").path))
                XCTAssertFalse(FileManager.default.fileExists(atPath: folder(otherRoot).appendingPathComponent("profile-v4.json").path))
            }
        }
    }
    func testUnconfiguredOrPortableBaseRefusesBeforePublication() throws {
        try fixture { root, _ in
            let prior = try Data(contentsOf: folder(root).appendingPathComponent("profile.json"))
            try LocalVaultDeviceState.withConfiguredBase(nil) { XCTAssertThrowsError(try RetainedReplacementProfile.prepareSharedRenames(root: root)) }
            try LocalVaultDeviceState.withConfiguredBase(root.appendingPathComponent("unsafe")) { XCTAssertThrowsError(try RetainedReplacementProfile.prepareSharedRenames(root: root)) }
            XCTAssertEqual(try Data(contentsOf: folder(root).appendingPathComponent("profile.json")), prior)
        }
    }
    func testOwnedPublicationProcess() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let parentPath = environment["TEXTTEXT_SHARED_RENAME_PARENT"], let nonce = environment["TEXTTEXT_SHARED_RENAME_NONCE"],
              let boundary = environment["TEXTTEXT_SHARED_RENAME_BOUNDARY"] else { throw XCTSkip("Owned publication interruption helper") }
        let parent = URL(fileURLWithPath: parentPath).standardizedFileURL
        guard parent.lastPathComponent.hasPrefix("shared-rename-profile-"),
              try String(contentsOf: parent.appendingPathComponent("owner-nonce"), encoding: .utf8) == nonce else { return XCTFail("Invalid owned fixture") }
        try LocalVaultDeviceState.withConfiguredBase(parent.appendingPathComponent("device")) {
            try RetainedReplacementProfile.prepareSharedRenames(root: parent.appendingPathComponent("vault")) {
                if $0 == boundary { _exit(73) }
            }
        }
        if boundary != "recover" { XCTFail("Publication boundary was not reached") }
    }
    func testFreshProcessInterruptionRetainsBackupPendingAndRecovers() throws {
        for boundary in ["sharedRenameMigrationReady", "sharedRenameProfileBeforeBackup", "sharedRenameProfilePreserved", "sharedRenameProfile:beforeSwap", "sharedRenameProfile:swapped", "sharedRenameProfileReady"] {
            try fixture { root, _ in
                let parent = root.deletingLastPathComponent(), nonce = UUID().uuidString
                try nonce.write(to: parent.appendingPathComponent("owner-nonce"), atomically: true, encoding: .utf8)
                let prior = try Data(contentsOf: folder(root).appendingPathComponent("profile.json"))
                let pending = LocalVaultDeviceState.directory(root: root).appendingPathComponent("pending.bin"), bytes = Data([9, 0, 255, 8])
                try bytes.write(to: pending)
                let child = Process(), output = Pipe()
                child.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
                child.arguments = ["xctest", "-XCTest", "TextTextFileProviderKitTests.SharedRenameProfileTests/testOwnedPublicationProcess", Bundle(for: Self.self).bundleURL.path]
                var environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TEXTTEXT_STORE": "1", "TEXTTEXT_SHARED_RENAME_PARENT": parent.path, "TEXTTEXT_SHARED_RENAME_NONCE": nonce, "TEXTTEXT_SHARED_RENAME_BOUNDARY": boundary]
                for key in ["DEVELOPER_DIR", "DYLD_FRAMEWORK_PATH", "DYLD_LIBRARY_PATH", "SDKROOT"] { environment[key] = ProcessInfo.processInfo.environment[key] }
                child.environment = environment; child.standardOutput = output; child.standardError = output
                try child.run()
                let deadline = Date().addingTimeInterval(20)
                while child.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
                if child.isRunning { _ = kill(child.processIdentifier, SIGKILL) }
                child.waitUntilExit()
                XCTAssertEqual(child.terminationStatus, 73, "Boundary: \(boundary)")
                let recovery = Process(), recoveryOutput = Pipe()
                recovery.executableURL = child.executableURL; recovery.arguments = child.arguments
                environment["TEXTTEXT_SHARED_RENAME_BOUNDARY"] = "recover"
                recovery.environment = environment; recovery.standardOutput = recoveryOutput; recovery.standardError = recoveryOutput
                try recovery.run()
                let recoveryDeadline = Date().addingTimeInterval(20)
                while recovery.isRunning && Date() < recoveryDeadline { Thread.sleep(forTimeInterval: 0.02) }
                if recovery.isRunning { _ = kill(recovery.processIdentifier, SIGKILL) }
                recovery.waitUntilExit()
                XCTAssertEqual(recovery.terminationStatus, 0, "Fresh process must finish recovery")
                XCTAssertEqual(try Data(contentsOf: folder(root).appendingPathComponent("profile-v4.json")), prior)
                XCTAssertEqual(try Data(contentsOf: pending), bytes)
            }
        }
    }

    func testProducePreviousFactoryFixtures() throws {
        guard let path = ProcessInfo.processInfo.environment["TEXTTEXT_SHARED_RENAME_FACTORY_PARENT"] else { throw XCTSkip("Explicit previous-factory fixture producer") }
        let parent = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        guard parent.lastPathComponent.hasPrefix("shared-rename-old-factory-"),
              try FileManager.default.contentsOfDirectory(atPath: parent.path).isEmpty else { return XCTFail("Producer requires fresh owned empty directory") }
        for version in [4, 5] {
            let fixture = parent.appendingPathComponent("floor-\(version)"), root = fixture.appendingPathComponent("vault"), base = fixture.appendingPathComponent("device")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try LocalVaultDeviceState.withConfiguredBase(base) {
                let binding = try LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace")
                try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: "account-a")
                try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
                try RetainedReplacementProfile.prepareLocalHandoff(root: root)
                try LocalVaultDeviceState.migrate(root: root)
                if version == 5 { try RetainedReplacementProfile.prepareSharedRenames(root: root) }
                let state = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
                try FileManager.default.createDirectory(at: state.deletingLastPathComponent(), withIntermediateDirectories: true)
                let object: [String: Any] = ["version": 1, "binding": try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding)), "accountId": "account-a", "baselines": [:], "outbox": [:], "conflicts": [:], "cursor": 0, "identities": [:], "sharedRenames": ["invalid-future-map-sentinel"]]
                try JSONSerialization.data(withJSONObject: object, options: .sortedKeys).write(to: state, options: .withoutOverwriting)
            }
        }
    }

}
