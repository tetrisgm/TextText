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
    func testFullRelativePresenceRejectsParentAliasButAllowsExactDescendant() throws {
        try source()
        XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "Before/child.bin"))
        XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "before/child.bin"))
    }
}
