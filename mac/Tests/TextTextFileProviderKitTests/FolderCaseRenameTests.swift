import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class FolderCaseRenameTests: XCTestCase {
    private var root: URL!
    private enum Interrupted: Error { case stopped }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("folder-case-" + UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func owned() throws {
        try LocalVaultAccountRootOwnership.open(root: root, binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace"), accountId: "account-a")
    }
    private func source() throws {
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Before"), withIntermediateDirectories: false)
        try Data("preserved contents".utf8).write(to: root.appendingPathComponent("Before/child.bin"))
    }
    func testUnownedCaseMutationRefusesWithoutChangingContentsOrSpelling() throws {
        try source()
        XCTAssertThrowsError(try LocalVaultDocumentStore(root: root).ensureFolders(["before"]))
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "Before/child.bin"))
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "before"))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Before/child.bin")), Data("preserved contents".utf8))
    }
    func testPendingBeforeRenameCancelsAndRetryCompletes() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" { throw Interrupted.stopped }
        })
        try FolderCaseRename(root: root).assertReadable()
        try LocalVaultDocumentStore(root: root).ensureFolders(["before"])
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "before/child.bin"))
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "Before"))
    }
    func testLostReplyAfterRenameClassifiesExactExpectedInodeAcrossRestart() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderRenamed" { throw Interrupted.stopped }
        })
        try FolderCaseRename(root: root).assertReadable()
        try LocalVaultDocumentStore(root: root).ensureFolders(["before"])
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "before/child.bin"))
    }
    func testForeignFinalGapFencesRestartAndExplicitConsentAllowsLaterRename() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Before"), to: self.root.appendingPathComponent("Preserved"))
                try FileManager.default.createDirectory(at: self.root.appendingPathComponent("Before"), withIntermediateDirectories: false)
                try Data("foreign bytes".utf8).write(to: self.root.appendingPathComponent("Before/foreign.bin"))
            }
        })
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
        XCTAssertThrowsError(try LocalVaultDocumentStore(root: root).ensureFolders(["before"]))
        let store = LocalVaultDocumentStore(root: root), row = try XCTUnwrap(store.folderRenameRecoveryList().first)
        XCTAssertFalse(row.from.present); XCTAssertTrue(row.to.present)
        XCTAssertNotEqual(row.to.identity, row.expectedIdentity)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Preserved/child.bin")), Data("preserved contents".utf8))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("before/foreign.bin")), Data("foreign bytes".utf8))
        XCTAssertThrowsError(try store.resolveFolderRename(id: row.id, fromPath: row.fromPath, toPath: row.toPath, inspection: row.inspection) { throw Interrupted.stopped })
        XCTAssertFalse(try XCTUnwrap(store.folderRenameRecoveryList().first).resolved)
        try store.resolveFolderRename(id: row.id, fromPath: row.fromPath, toPath: row.toPath, inspection: row.inspection)
        try store.ensureFolders(["BEFORE"])
        try Data("later edit".utf8).write(to: root.appendingPathComponent("BEFORE/later.bin"))
        try FolderCaseRename(root: root).assertReadable()
        XCTAssertTrue(try XCTUnwrap(store.folderRenameRecoveryList().first).resolved)
    }
    func testUnreadableOrTruncatedInspectionCannotBeConsentedAndFutureJournalIsUntouched() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Before"), to: self.root.appendingPathComponent("Preserved"))
                try FileManager.default.createDirectory(at: self.root.appendingPathComponent("Before"), withIntermediateDirectories: false)
                try FileManager.default.createSymbolicLink(atPath: self.root.appendingPathComponent("Before/unsafe").path, withDestinationPath: "/tmp")
            }
        })
        let store = LocalVaultDocumentStore(root: root), row = try XCTUnwrap(store.folderRenameRecoveryList().first)
        XCTAssertNotNil(row.resolutionBlocked)
        XCTAssertThrowsError(try store.resolveFolderRename(id: row.id, fromPath: row.fromPath, toPath: row.toPath, inspection: row.inspection))
        let journal = LocalVaultDeviceState.directory(root: root).appendingPathComponent("folder-case-renames/" + row.id + ".json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: journal)) as? [String: Any]); object["version"] = 999
        let future = try JSONSerialization.data(withJSONObject: object); try future.write(to: journal)
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
        XCTAssertThrowsError(try store.folderRenameRecoveryList())
        XCTAssertEqual(try Data(contentsOf: journal), future)
    }
    func testLiveCaptureCannotBeCancelledByAnotherStoreOrExplicitConsent() throws {
        try owned(); try source()
        try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" {
                XCTAssertThrowsError(try FolderCaseRename(root: self.root).assertReadable())
                let store = LocalVaultDocumentStore(root: self.root), row = try XCTUnwrap(store.folderRenameRecoveryList().first)
                XCTAssertThrowsError(try store.resolveFolderRename(id: row.id, fromPath: row.fromPath, toPath: row.toPath, inspection: row.inspection))
            }
        }
        try FolderCaseRename(root: root).assertReadable()
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "before/child.bin"))
    }
    func testForeignRegularEndpointIsInspectableAndSymlinkEndpointIsBlocked() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Before"), to: self.root.appendingPathComponent("Preserved"))
                try Data([0, 255, 1]).write(to: self.root.appendingPathComponent("Before"))
            }
        })
        let store = LocalVaultDocumentStore(root: root), regular = try XCTUnwrap(store.folderRenameRecoveryList().first)
        XCTAssertTrue(regular.to.present); XCTAssertNil(regular.resolutionBlocked)
        try FileManager.default.moveItem(at: root.appendingPathComponent("before"), to: root.appendingPathComponent("foreign-preserved.bin"))
        try FileManager.default.createSymbolicLink(atPath: root.appendingPathComponent("before").path, withDestinationPath: "/tmp")
        let symlink = try store.folderRenameRecoveryRead(id: regular.id)
        XCTAssertTrue(symlink.to.present); XCTAssertNotNil(symlink.resolutionBlocked)
        XCTAssertThrowsError(try store.resolveFolderRename(id: symlink.id, fromPath: symlink.fromPath, toPath: symlink.toPath, inspection: symlink.inspection))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("foreign-preserved.bin")), Data([0, 255, 1]))
    }
    func testConsentRechecksFilesystemMutationAndAuthorityAfterLongInspection() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderPrepared" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Before"), to: self.root.appendingPathComponent("Preserved"))
                try FileManager.default.createDirectory(at: self.root.appendingPathComponent("Before"), withIntermediateDirectories: false)
            }
        })
        let store = LocalVaultDocumentStore(root: root), first = try XCTUnwrap(store.folderRenameRecoveryList().first)
        var calls = 0
        XCTAssertThrowsError(try store.resolveFolderRename(id: first.id, fromPath: first.fromPath, toPath: first.toPath, inspection: first.inspection) {
            calls += 1
            if calls == 1 { try Data("late filesystem edit".utf8).write(to: self.root.appendingPathComponent("before/late.bin")) }
        })
        XCTAssertFalse(try store.folderRenameRecoveryRead(id: first.id).resolved)
        let current = try store.folderRenameRecoveryRead(id: first.id)
        calls = 0
        XCTAssertThrowsError(try store.resolveFolderRename(id: current.id, fromPath: current.fromPath, toPath: current.toPath, inspection: current.inspection) {
            calls += 1
            if calls == 2 { throw Interrupted.stopped }
        })
        XCTAssertEqual(calls, 2)
        XCTAssertFalse(try store.folderRenameRecoveryRead(id: first.id).resolved)
    }
    func testForeignSwapDuringProfilePreparationCannotBecomeNewExpectedDirectory() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderBeforeProfile" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Before"), to: self.root.appendingPathComponent("Preserved"))
                try FileManager.default.createDirectory(at: self.root.appendingPathComponent("Before"), withIntermediateDirectories: false)
                try Data("foreign during setup".utf8).write(to: self.root.appendingPathComponent("Before/foreign.bin"))
            }
        })
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "Before/foreign.bin"))
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "before"))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Preserved/child.bin")), Data("preserved contents".utf8))
    }
    func testForeignSwapBeforeParentPinCannotBecomeNewExpectedDirectory() throws {
        try owned(); try source()
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before") { stage in
            if stage == "folderBeforeParentPin" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Before"), to: self.root.appendingPathComponent("Preserved"))
                try FileManager.default.createDirectory(at: self.root.appendingPathComponent("Before"), withIntermediateDirectories: false)
                try Data("foreign during setup".utf8).write(to: self.root.appendingPathComponent("Before/foreign.bin"))
            }
        })
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "Before/foreign.bin"))
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "before"))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Preserved/child.bin")), Data("preserved contents".utf8))
    }
    func testUnsafeAncestorRemainsVisibleAsBlockedUnverifiedRecoveryMetadata() throws {
        try owned(); try source()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Parent"), withIntermediateDirectories: false)
        try FileManager.default.moveItem(at: root.appendingPathComponent("Before"), to: root.appendingPathComponent("Parent/Before"))
        XCTAssertThrowsError(try FolderCaseRename(root: root).rename(sourcePath: "Parent/Before", destinationPath: "Parent/before") { stage in
            if stage == "folderPrepared" {
                try FileManager.default.moveItem(at: self.root.appendingPathComponent("Parent/Before"), to: self.root.appendingPathComponent("Parent/Original"))
                try FileManager.default.createDirectory(at: self.root.appendingPathComponent("Parent/Before"), withIntermediateDirectories: false)
            }
        })
        try FileManager.default.moveItem(at: root.appendingPathComponent("Parent"), to: root.appendingPathComponent("PreservedParent"))
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Outside"), withIntermediateDirectories: false)
        try Data("untouched".utf8).write(to: root.appendingPathComponent("Outside/bytes.bin"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("Parent"), withDestinationURL: root.appendingPathComponent("Outside"))
        let store = LocalVaultDocumentStore(root: root), row = try XCTUnwrap(store.folderRenameRecoveryList().first)
        XCTAssertTrue(row.from.present); XCTAssertNil(row.from.identity)
        XCTAssertTrue(row.to.present); XCTAssertNil(row.to.identity)
        XCTAssertNotNil(row.resolutionBlocked)
        XCTAssertThrowsError(try store.resolveFolderRename(id: row.id, fromPath: row.fromPath, toPath: row.toPath, inspection: row.inspection))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Outside/bytes.bin")), Data("untouched".utf8))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("PreservedParent/Original/child.bin")), Data("preserved contents".utf8))
    }
    func testStreamingHistoryStillValidatesUnknownRecordsAndLaterConflicts() throws {
        try owned(); try source()
        try FolderCaseRename(root: root).rename(sourcePath: "Before", destinationPath: "before")
        let directory = LocalVaultDeviceState.directory(root: root).appendingPathComponent("folder-case-renames")
        let original = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first { $0.pathExtension == "json" })
        let template = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: original)) as? [String: Any])
        var last: URL!
        for _ in 0..<32 {
            let operation = UUID(), target = directory.appendingPathComponent(operation.uuidString + ".json")
            var object = template; object["operation"] = operation.uuidString
            try JSONSerialization.data(withJSONObject: object).write(to: target)
            last = target
        }
        try FolderCaseRename(root: root).assertReadable()
        XCTAssertTrue(try LocalVaultDocumentStore(root: root).folderRenameRecoveryList().isEmpty)
        var changed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: last)) as? [String: Any])
        changed["futureField"] = true
        let future = try JSONSerialization.data(withJSONObject: changed); try future.write(to: last)
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
        XCTAssertThrowsError(try LocalVaultDocumentStore(root: root).folderRenameRecoveryList())
        XCTAssertEqual(try Data(contentsOf: last), future)
        changed.removeValue(forKey: "futureField"); changed["state"] = "conflict"
        try JSONSerialization.data(withJSONObject: changed).write(to: last)
        XCTAssertThrowsError(try FolderCaseRename(root: root).assertReadable())
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).folderRenameRecoveryList().count, 1)
    }
    func testFullRelativePresenceRejectsParentAliasButAllowsExactDescendant() throws {
        try source()
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "Before/child.bin"))
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "before/child.bin"))
    }
}
