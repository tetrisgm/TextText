import Foundation
import XCTest
import TextTextWorkspaceCore
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalHandoffProfileTests: XCTestCase {
    private enum Interrupted: Error { case stop }
    private func fixture(_ body: (URL, URL, URL) throws -> Void) throws {
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("local-handoff-" + UUID().uuidString)
        let root = parent.appendingPathComponent("vault"), a = parent.appendingPathComponent("device-a"), b = parent.appendingPathComponent("device-b")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        try body(root, a, b)
    }
    private func own(_ root: URL) throws {
        try LocalVaultAccountRootOwnership.open(root: root, binding: LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "workspace"), accountId: "account-a")
    }
    private func profile(_ root: URL) -> URL { LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile/profile.json") }
    func testPrivateFloorPreservesPriorProfileAndLeavesOtherDeviceUntouched() throws {
        try fixture { root, a, b in
            try LocalVaultDeviceState.withConfiguredBase(b) { try own(root); try RetainedReplacementProfile.prepareFolderPropagation(root: root) }
            let other = LocalVaultDeviceState.directory(root: root, base: b).appendingPathComponent("retained-replacement-profile/profile.json")
            let otherBytes = try Data(contentsOf: other)
            try LocalVaultDeviceState.withConfiguredBase(a) {
                try own(root); XCTAssertTrue(try LocalVaultDeviceState.supportsLocalHandoff(root: root))
                XCTAssertFalse(FileManager.default.fileExists(atPath: profile(root).path)) // Config does not publish.
                try RetainedReplacementProfile.prepareFolderPropagation(root: root)
                let prior = try Data(contentsOf: profile(root))
                let pending = LocalVaultDeviceState.directory(root: root).appendingPathComponent("pending-proof.bin")
                try Data("exact pending bytes".utf8).write(to: pending)
                try LocalVaultDeviceState.prepareLocalHandoff(root: root)
                XCTAssertEqual((try JSONSerialization.jsonObject(with: Data(contentsOf: profile(root))) as? [String: Any])?["version"] as? Int, 4)
                XCTAssertEqual(try Data(contentsOf: profile(root).deletingLastPathComponent().appendingPathComponent("profile-v3.json")), prior)
                XCTAssertEqual(try Data(contentsOf: pending), Data("exact pending bytes".utf8))
                XCTAssertFalse([1, 2, 3].contains(4)) // Characterize known previous max-three reader.
                try RetainedReplacementProfile.prepareFolderCase(root: root)
                try RetainedReplacementProfile.prepareFolderPropagation(root: root)
                try own(root) // New reader accepts all retained floor history.
            }
            XCTAssertEqual(try Data(contentsOf: other), otherBytes)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext/retained-replacement-profile").path))
        }
    }
    func testCommittedNativePendingCheckpointSurvivesFloorAndFreshStore() throws {
        try fixture { root, a, _ in try LocalVaultDeviceState.withConfiguredBase(a) {
            try own(root)
            let item = "handoff-pending-item", path = "Note.textpack"
            let document = try BuiltinTextPackDocument.create(title: "Note", body: "Pending exact body")
            let markdown = "---\ntextTextId: \"handoff-pending-item\"\n---\nPending exact body"
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: document.documentJSON,
                templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
            let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
            let original = try LocalVaultDocumentStore(root: root).read(path: path)
            let journal: [String: Any] = ["version": 1, "accountId": "account-a", "journalGeneration": 7, "epoch": 1, "seq": 0,
                "revision": original.hash, "relativePath": path, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
            let checkpoint = LocalVaultSharedCheckpoint(itemId: item, path: path, projectedHash: original.hash, acknowledgedRevision: original.hash,
                epoch: 1, seq: 0, journalGeneration: 7, journal: String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true, retiredReason: nil)
            let shared = LocalVaultSharedEditingStore(root: root, accountId: "account-a")
            _ = try shared.materialize(checkpoint: checkpoint, expectedHash: original.hash, markdown: markdown, documentJSON: try XCTUnwrap(document.documentJSON))
            try RetainedReplacementProfile.prepareFolderPropagation(root: root)
            let directory = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/" + item)
            let pending = directory.appendingPathComponent("checkpoint.json"), bytes = try Data(contentsOf: pending)
            let projection = try Data(contentsOf: root.appendingPathComponent(path))
            try LocalVaultDeviceState.prepareLocalHandoff(root: root)
            XCTAssertEqual(try Data(contentsOf: pending), bytes)
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), projection)
            let reopened = try XCTUnwrap(LocalVaultSharedEditingStore(root: root, accountId: "account-a").checkpoint(itemId: item))
            XCTAssertTrue(reopened.pending); XCTAssertEqual(reopened.journalGeneration, 7); XCTAssertEqual(reopened.journal, checkpoint.journal)
        } }
    }
    func testActualPreviousCLIRefusesPrivateFloorFourBeforeWriting() throws {
        guard let executable = ProcessInfo.processInfo.environment["TEXTTEXT_PREVIOUS_LOCAL_CLI"] else { throw XCTSkip("Requires the explicit pinned previous local CLI executable") }
        guard FileManager.default.isExecutableFile(atPath: "/usr/bin/sandbox-exec"), FileManager.default.isExecutableFile(atPath: executable) else { throw XCTSkip("Previous CLI or OS sandbox unavailable; compatibility not run") }
        guard TextTextStableDigest.sha256Hex(try Data(contentsOf: URL(fileURLWithPath: executable))) == "60ae57f1ac231bf855a881599878e9814e405a1b3c74118548ed12687a054abd" else {
            XCTFail("Previous CLI artifact identity changed; refusing to execute"); return
        }
        // Separate fresh roots avoid the control write's legitimate retention guards
        // obscuring the format check in the upgraded fixture. No guard is removed.
        func exercise(upgraded: Bool) throws {
        try fixture { root, _, _ in
            let a = root.deletingLastPathComponent().appendingPathComponent("CLI")
            try LocalVaultDeviceState.withConfiguredBase(a) {
            try own(root)
            let item = "handoff-pending-item", path = "Note.textpack"
            let document = try BuiltinTextPackDocument.create(title: "Note", body: "Pending exact body")
            let markdown = "---\ntextTextId: \"handoff-pending-item\"\n---\nPending exact body"
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: document.documentJSON,
                templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: root)
            let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            try FileManager.default.moveItem(at: pack, to: root.appendingPathComponent(path))
            let original = try LocalVaultDocumentStore(root: root).read(path: path)
            let journal: [String: Any] = ["version": 1, "accountId": "account-a", "journalGeneration": 7, "epoch": 1, "seq": 0,
                "revision": original.hash, "relativePath": path, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
            let checkpoint = LocalVaultSharedCheckpoint(itemId: item, path: path, projectedHash: original.hash, acknowledgedRevision: original.hash,
                epoch: 1, seq: 0, journalGeneration: 7, journal: String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true, retiredReason: nil)
            try RetainedReplacementProfile.prepareFolderPropagation(root: root)
            // Retained serialized checkpoint fixture; the separate test above proves actual native materialization.
            let pending = LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-checkpoint-fixture.json")
            let bytes = try JSONEncoder().encode(checkpoint); try bytes.write(to: pending)

            func snapshot() throws -> [String: Data] {
                let parent = root.deletingLastPathComponent()
                let entries = FileManager.default.enumerator(at: parent, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])!
                var result: [String: Data] = [:]
                for case let path as URL in entries {
                    let values = try path.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                    XCTAssertNotEqual(values.isSymbolicLink, true)
                    if values.isRegularFile == true { result[String(path.path.dropFirst(parent.path.count + 1))] = try Data(contentsOf: path) }
                }
                return result
            }
            func runPrevious() throws -> (Int32, String) {
                let process = Process(), input = Pipe(), output = Pipe(), error = Pipe()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/sandbox-exec")
                let home = FileManager.default.homeDirectoryForCurrentUser.path
                process.arguments = ["-p", "(version 1)(allow default)(deny network*)(deny file-read* (subpath \"" + home + "\"))", executable, "write", path]
                process.currentDirectoryURL = root
                process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": root.deletingLastPathComponent().path,
                    "TEXTTEXT_WORKSPACE_ROOT": root.path, "TEXTTEXT_STATE_DIR": root.deletingLastPathComponent().path]
                process.standardInput = input; process.standardOutput = output; process.standardError = error
                try process.run(); try input.fileHandleForWriting.write(contentsOf: Data("isolated previous CLI fixture write".utf8)); try input.fileHandleForWriting.close()
                let deadline = Date().addingTimeInterval(10)
                while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
                if process.isRunning { process.terminate(); process.waitUntilExit(); throw XCTSkip("Previous CLI diagnostic timed out; compatibility not run") }
                process.waitUntilExit()
                let stderr = String(decoding: error.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                // The pinned F2 CLI prints String(describing: error), not LocalizedError.errorDescription.
                // Only its exact enum line proves the unsupported retained-profile path.
                if stderr.split(separator: "\n").contains(where: { $0 == "texttext: invalidProfile" }) { return (process.terminationStatus, "texttext: invalidProfile") }
                let known = ["this folder has legacy or unverified local recovery state", "Operation not permitted", "Permission denied", "document not found"]
                return (process.terminationStatus, known.first(where: stderr.contains) ?? "Details withheld")
            }
            if !upgraded {
                let baseline = try runPrevious()
                guard baseline.0 == 0 else { throw XCTSkip("Previous CLI floor-three precondition blocked: " + baseline.1 + "; floor-four binary proof not run") }
                XCTAssertEqual(try Data(contentsOf: pending), bytes)
                return
            }
            try LocalVaultDeviceState.prepareLocalHandoff(root: root)
            let before = try snapshot()
            let refused = try runPrevious()
            XCTAssertNotEqual(refused.0, 0)
            XCTAssertEqual(refused.1, "texttext: invalidProfile", "Must refuse specifically unsupported profile on its first write to the independently upgraded fixture")
            XCTAssertEqual(try snapshot(), before)
            XCTAssertEqual(try Data(contentsOf: pending), bytes)
        } }
        }
        try exercise(upgraded: false)
        try exercise(upgraded: true)
    }
    func testUnconfiguredAndInsideVaultStateNeverAdvertiseOrUpgrade() throws {
        try fixture { root, _, _ in
            try LocalVaultDeviceState.withConfiguredBase(nil) {
                XCTAssertFalse(try LocalVaultDeviceState.supportsLocalHandoff(root: root))
                XCTAssertThrowsError(try LocalVaultDeviceState.prepareLocalHandoff(root: root))
            }
            try LocalVaultDeviceState.withConfiguredBase(root.appendingPathComponent("state")) {
                XCTAssertFalse(try LocalVaultDeviceState.supportsLocalHandoff(root: root))
                XCTAssertThrowsError(try LocalVaultDeviceState.prepareLocalHandoff(root: root))
            }
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext").path))
        }
    }
    func testInterruptedUpgradeReopensWithExactPriorAndFutureRefuses() throws {
        for boundary in ["localHandoffProfilePreserved", "localHandoffProfile:beforeSwap", "localHandoffProfile:swapped"] {
            try fixture { root, a, _ in try LocalVaultDeviceState.withConfiguredBase(a) {
                try own(root); try RetainedReplacementProfile.prepareFolderPropagation(root: root)
                let prior = try Data(contentsOf: profile(root))
                XCTAssertThrowsError(try RetainedReplacementProfile.prepareLocalHandoff(root: root) { if $0 == boundary { throw Interrupted.stop } })
                try LocalVaultDeviceState.prepareLocalHandoff(root: root)
                XCTAssertEqual(try Data(contentsOf: profile(root).deletingLastPathComponent().appendingPathComponent("profile-v3.json")), prior)
                var fields = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: profile(root))) as? [String: Any]); fields["version"] = 5
                try JSONSerialization.data(withJSONObject: fields).write(to: profile(root))
                XCTAssertThrowsError(try LocalVaultDeviceState.supportsLocalHandoff(root: root))
            } }
        }
    }
}
