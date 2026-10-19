import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class ObservedAbsenceProfileTests: XCTestCase {
    private enum Interrupted: Error { case boundary }
    private func fixture(_ body: (URL, URL) throws -> Void) throws {
        let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("absence-profile-" + UUID().uuidString)
        let root = parent.appendingPathComponent("vault"), device = parent.appendingPathComponent("device")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        try LocalVaultDeviceState.withConfiguredBase(device) {
            try LocalVaultAccountRootOwnership.open(root: root, binding: .init(origin: URL(string: "https://absence.test")!, workspaceId: "workspace"), accountId: "account-a")
            try RetainedReplacementProfile.prepareLocalHandoff(root: root)
            try LocalVaultDeviceState.migrate(root: root)
            try RetainedReplacementProfile.prepareSharedRenames(root: root)
            try body(root, LocalVaultDeviceState.directory(root: root))
        }
    }
    func testSixPreservesExactFiveAndNeverDowngrades() throws {
        try fixture { root, state in
            let profile = state.appendingPathComponent("retained-replacement-profile/profile.json")
            let five = try Data(contentsOf: profile), owner = try Data(contentsOf: state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName))
            let pending = state.appendingPathComponent("pending-owned-test.bin"), bytes = Data([0, 1, 255, 4])
            try bytes.write(to: pending, options: .withoutOverwriting)
            try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root)
            XCTAssertEqual(try Data(contentsOf: state.appendingPathComponent("retained-replacement-profile/profile-v5.json")), five)
            let six = try Data(contentsOf: profile)
            XCTAssertEqual((try JSONSerialization.jsonObject(with: six) as? [String: Any])?["version"] as? Int, 6)
            try RetainedReplacementProfile.prepareSharedRenames(root: root)
            try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root)
            XCTAssertEqual(try Data(contentsOf: profile), six)
            XCTAssertEqual(try Data(contentsOf: state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)), owner)
            XCTAssertEqual(try Data(contentsOf: pending), bytes)
        }
    }
    func testInterruptedSixPublicationRetainsFiveAndPendingBytes() throws {
        for boundary in ["observedAbsenceProfilePreserved", "observedAbsenceProfile:beforeSwap", "observedAbsenceProfile:swapped", "observedAbsenceProfileReady"] {
            try fixture { root, state in
                let prior = try Data(contentsOf: state.appendingPathComponent("retained-replacement-profile/profile.json"))
                let pending = state.appendingPathComponent("pending-owned-test.bin"), bytes = Data("immutable operation fixture".utf8)
                try bytes.write(to: pending, options: .withoutOverwriting)
                XCTAssertThrowsError(try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root) { if $0 == boundary { throw Interrupted.boundary } })
                try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root)
                XCTAssertEqual(try Data(contentsOf: state.appendingPathComponent("retained-replacement-profile/profile-v5.json")), prior)
                XCTAssertEqual(try Data(contentsOf: pending), bytes)
            }
        }
    }
    func testForeignFiveBackupCannotBeOverwritten() throws {
        try fixture { root, state in
            let profile = state.appendingPathComponent("retained-replacement-profile/profile.json"), before = try Data(contentsOf: profile)
            let retained = state.appendingPathComponent("retained-replacement-profile/profile-v5.json"), foreign = Data("foreign retained data".utf8)
            try foreign.write(to: retained, options: .withoutOverwriting)
            XCTAssertThrowsError(try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root))
            XCTAssertEqual(try Data(contentsOf: profile), before); XCTAssertEqual(try Data(contentsOf: retained), foreign)
        }
    }
    func testFloorSixStillPermitsOwnedFolderCaseRename() throws {
        try fixture { root, state in
            try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root)
            let source = root.appendingPathComponent("CaseFolder")
            try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
            let bytes = Data("retained folder child".utf8)
            try bytes.write(to: source.appendingPathComponent("child.bin"), options: .withoutOverwriting)
            try FolderCaseRename(root: root).rename(sourcePath: "CaseFolder", destinationPath: "casefolder")
            XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "CaseFolder"))
            XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "casefolder"))
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("casefolder/child.bin")), bytes)
            let profile = state.appendingPathComponent("retained-replacement-profile/profile.json")
            let before = try Data(contentsOf: profile)
            XCTAssertEqual((try JSONSerialization.jsonObject(with: before) as? [String: Any])?["version"] as? Int, 6)
        }
    }
    func testPublicationRejectsForeignProfileAtReadyWithoutRepair() throws {
        try fixture { root, state in
            let profile = state.appendingPathComponent("retained-replacement-profile/profile.json")
            let five = try Data(contentsOf: profile)
            var foreign = Data()
            XCTAssertThrowsError(try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root) { phase in
                if phase == "observedAbsenceProfileReady" {
                    var marker = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: profile)) as? [String: Any])
                    marker["principalHash"] = String(repeating: "f", count: 64)
                    foreign = try JSONSerialization.data(withJSONObject: marker, options: .sortedKeys)
                    try foreign.write(to: profile)
                }
            })
            XCTAssertFalse(foreign.isEmpty); XCTAssertEqual(try Data(contentsOf: profile), foreign)
            XCTAssertEqual(try Data(contentsOf: state.appendingPathComponent("retained-replacement-profile/profile-v5.json")), five)
        }
    }
    func testDuplicateProfileAuthorityFilesRefuseWithoutRepair() throws {
        for name in ["profile.json", "owner-v1.json", "profile-v5.json"] {
            try fixture { root, state in
                try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root)
                let url = state.appendingPathComponent("retained-replacement-profile/" + name)
                let original = try Data(contentsOf: url)
                let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: original) as? [String: Any])
                let key = "version"
                let duplicate = Data(("{\"" + key + "\":" + String(describing: fields[key]!) + "," + String(decoding: original, as: UTF8.self).dropFirst()).utf8)
                try duplicate.write(to: url)
                let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                    from: Data(contentsOf: state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)))
                XCTAssertThrowsError(try RetainedReplacementProfile.verify(root: root, owner: owner) {})
                XCTAssertEqual(try Data(contentsOf: url), duplicate)
            }
        }
    }
#if TEXTTEXT_STRESS_ACTOR
    func testReadonlyProducerAttestsSixAndRefusesFutureProfileWithoutWrites() throws {
        try fixture { root, state in
            try RetainedReplacementProfile.prepareObservedAbsenceRenames(root: root)
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                from: Data(contentsOf: state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)))
            let profile = state.appendingPathComponent("retained-replacement-profile/profile.json")
            let six = try Data(contentsOf: profile)
            let proof = try RetainedReplacementProfile.stressObservation(stateDirectory: state, owner: owner, expectedRootHash: owner.rootHash)
            XCTAssertNotNil(proof["profile-v5.json"]); XCTAssertEqual(try Data(contentsOf: profile), six)
            var marker = try XCTUnwrap(JSONSerialization.jsonObject(with: six) as? [String: Any]); marker["version"] = 7
            let future = try JSONSerialization.data(withJSONObject: marker, options: .sortedKeys)
            try future.write(to: profile)
            XCTAssertThrowsError(try RetainedReplacementProfile.stressObservation(stateDirectory: state, owner: owner, expectedRootHash: owner.rootHash))
            XCTAssertEqual(try Data(contentsOf: profile), future)
        }
    }
#endif

}
