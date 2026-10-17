import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class StableFileSnapshotTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-stable-read-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testStableReadRetriesInPlaceAndAtomicReplacement() throws {
        for atomic in [false, true] {
            let file = root.appendingPathComponent(atomic ? "atomic" : "in-place")
            let original = Data("original bytes".utf8), next = Data("external bytes".utf8)
            try original.write(to: file)
            let captured = try StableFileSnapshot.read(file) { attempt in
                if attempt == 0 { try next.write(to: file, options: atomic ? .atomic : []) }
            }
            XCTAssertEqual(captured, next)
            XCTAssertEqual(try Data(contentsOf: file), next)
        }
    }

    func testUnstableReadRefusesAfterExactlyThreeAttempts() throws {
        let file = root.appendingPathComponent("changing")
        try Data("version 0".utf8).write(to: file)
        XCTAssertThrowsError(try StableFileSnapshot.read(file) { attempt in
            try Data("version \(attempt + 1)".utf8).write(to: file, options: .atomic)
        }) { error in
            guard case LocalVaultDocumentStore.Failure.changed = error else { return XCTFail("Unexpected failure: \(error)") }
        }
        XCTAssertEqual(try Data(contentsOf: file), Data("version 3".utf8))
    }

    func testTruncationAndRepairReturnOnlyTheCurrentCapturedVersion() throws {
        let file = root.appendingPathComponent("partial")
        let original = Data(repeating: 65, count: 128_000), repaired = Data(repeating: 66, count: 128_000)
        try original.write(to: file)
        let captured = try StableFileSnapshot.read(file) { attempt in
            if attempt == 0 {
                let handle = try FileHandle(forWritingTo: file)
                try handle.truncate(atOffset: 3); try handle.close()
            } else if attempt == 1 { try repaired.write(to: file, options: .atomic) }
        }
        XCTAssertEqual(captured, repaired)
    }

    func testSizeLimitAppliesBeforeAllocationAndAfterGrowth() throws {
        let file = root.appendingPathComponent("bounded")
        try Data(repeating: 1, count: 9).write(to: file)
        XCTAssertThrowsError(try StableFileSnapshot.read(file, maximumBytes: 8)) { error in
            guard case LocalVaultDocumentStore.Failure.tooLarge = error else { return XCTFail("Unexpected failure: \(error)") }
        }
        try Data(repeating: 1, count: 4).write(to: file)
        XCTAssertThrowsError(try StableFileSnapshot.read(file, maximumBytes: 8) { _ in
            try Data(repeating: 2, count: 9).write(to: file, options: .atomic)
        }) { error in
            guard case LocalVaultDocumentStore.Failure.tooLarge = error else { return XCTFail("Unexpected failure: \(error)") }
        }
        XCTAssertEqual(try Data(contentsOf: file), Data(repeating: 2, count: 9))
    }

    func testSymlinksAndDirectoriesAreNotReadableSnapshots() throws {
        let file = root.appendingPathComponent("regular"), link = root.appendingPathComponent("linked")
        try Data("kept".utf8).write(to: file)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
        XCTAssertThrowsError(try StableFileSnapshot.read(link))
        XCTAssertThrowsError(try StableFileSnapshot.read(root))
        XCTAssertEqual(try Data(contentsOf: file), Data("kept".utf8))
    }

    private func pack(_ body: String) throws -> (Data, String, String) {
        let scratch = root.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Stable", body: body)
        let markdown = "---\ntextTextId: \"stable-file\"\ntitle: Stable\n---\n\n" + body
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: document.documentJSON,
            templateJSON: document.templateJSON, assets: [.init(filename: "opaque.bin", data: Data([1, 2, 255]), remoteURL: "assets/opaque.bin")], sourceURL: nil, in: scratch)
        let zipped = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch)
        return (try Data(contentsOf: zipped), markdown, document.documentJSON)
    }

    func testSamePathRenameStillChecksExpectedVersion() throws {
        let path = "Stable.textpack", store = LocalVaultDocumentStore(root: root)
        let original = try pack("original"), changed = try pack("external edit")
        let target = root.appendingPathComponent(path)
        try original.0.write(to: target)
        let baseline = try store.read(path: path)
        try changed.0.write(to: target, options: .atomic)
        XCTAssertThrowsError(try store.rename(path: path, expectedHash: baseline.hash, newPath: path)) { error in
            guard case LocalVaultDocumentStore.Failure.changed = error else { return XCTFail("Unexpected failure: \(error)") }
        }
        XCTAssertEqual(try Data(contentsOf: target), changed.0)
        let current = try store.read(path: path)
        let result = try store.rename(path: path, expectedHash: current.hash, newPath: path)
        XCTAssertEqual(result.hash, current.hash)
        XCTAssertEqual(result.path, path)
        XCTAssertEqual(try Data(contentsOf: target), changed.0)
    }

    func testPreparedWriteRejectsInPlaceAndRenameOverChanges() throws {
        for exact in [false, true] {
            for atomic in [false, true] {
                let file = root.appendingPathComponent("Race.textpack")
                let original = try pack("original"), pending = try pack("pending"), external = try pack("external")
                try original.0.write(to: file)
                var store = LocalVaultDocumentStore(root: root)
                let observed = try store.read(path: "Race.textpack")
                store.writeObservationForTesting = { stage in
                    if stage == "prepared" { try external.0.write(to: file, options: atomic ? .atomic : []) }
                }
                XCTAssertThrowsError(try exact
                    ? store.replaceExact(path: "Race.textpack", expectedHash: observed.hash, bytes: pending.0)
                    : store.write(path: "Race.textpack", expectedHash: observed.hash, markdown: pending.1, documentJSON: pending.2,
                        templateJSON: observed.contents.templateJSON, templateAuthoringSourceJSON: observed.contents.templateAuthoringSourceJSON)) { error in
                    guard case LocalVaultDocumentStore.Failure.changed = error else { return XCTFail("Unexpected failure: \(error)") }
                }
                XCTAssertEqual(try Data(contentsOf: file), external.0)
                store.writeObservationForTesting = nil
                let fresh = try store.read(path: "Race.textpack")
                XCTAssertEqual(fresh.contents.markdown, external.1)
                XCTAssertEqual(fresh.contents.assets.first?.data, Data([1, 2, 255]))
            }
        }
    }

    func testPostCommitExternalWriteIsNotReturnedAsTheCallersProjection() throws {
        for exact in [false, true] {
            let file = root.appendingPathComponent("PostCommit.textpack")
            let original = try pack("original"), pending = try pack("accepted local intent"), external = try pack("later external")
            try original.0.write(to: file)
            var store = LocalVaultDocumentStore(root: root)
            let observed = try store.read(path: "PostCommit.textpack")
            store.writeObservationForTesting = { stage in
                if stage == "replaced" { try external.0.write(to: file, options: .atomic) }
            }
            let returned = try exact
                ? store.replaceExact(path: "PostCommit.textpack", expectedHash: observed.hash, bytes: pending.0)
                : store.write(path: "PostCommit.textpack", expectedHash: observed.hash, markdown: pending.1, documentJSON: pending.2,
                    templateJSON: observed.contents.templateJSON, templateAuthoringSourceJSON: observed.contents.templateAuthoringSourceJSON)
            XCTAssertEqual(returned.contents.markdown, pending.1)
            XCTAssertNotEqual(returned.hash, TextTextStableDigest.sha256Hex(external.0))
            XCTAssertEqual(try Data(contentsOf: file), external.0)
            // The shared materialization caller's existing post-write hash
            // comparison now refuses this race, retaining its durable intent.
            XCTAssertNotEqual(TextTextStableDigest.sha256Hex(try Data(contentsOf: file)), returned.hash)
        }
    }

    func testMalformedArchiveThenRepairKeepsPriorCapturedDocument() throws {
        let file = root.appendingPathComponent("Repair.textpack"), valid = try pack("kept")
        try valid.0.write(to: file)
        let store = LocalVaultDocumentStore(root: root), prior = try store.read(path: "Repair.textpack")
        let partial = valid.0.prefix(valid.0.count / 2)
        try partial.write(to: file)
        XCTAssertThrowsError(try store.read(path: "Repair.textpack"))
        XCTAssertThrowsError(try store.readMetadata(path: "Repair.textpack"))
        XCTAssertEqual(try Data(contentsOf: file), partial)
        XCTAssertEqual(prior.contents.markdown, valid.1)
        try valid.0.write(to: file, options: .atomic)
        let repaired = try store.read(path: "Repair.textpack")
        XCTAssertEqual(repaired.hash, prior.hash)
        XCTAssertEqual(try store.readMetadata(path: "Repair.textpack").hash, prior.hash)
        XCTAssertEqual(repaired.contents.assets.first?.data, Data([1, 2, 255]))
    }
}
