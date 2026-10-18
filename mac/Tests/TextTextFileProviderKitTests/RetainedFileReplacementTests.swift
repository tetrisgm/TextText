import Foundation
import Darwin
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class RetainedFileReplacementTests: XCTestCase {
    private var root: URL!
    private var target: URL { root.appendingPathComponent("document.textpack") }
    private let baseline = Data("baseline".utf8), candidate = Data("candidate".utf8), external = Data("external".utf8)
    private func hash(_ bytes: Data) -> String { TextTextStableDigest.sha256Hex(bytes) }
    private enum Interruption: Error { case stopped }
    override func setUpWithError() throws {
        let canonical = try XCTUnwrap(realpath(FileManager.default.temporaryDirectory.path, nil))
        defer { free(canonical) }
        root = URL(fileURLWithPath: String(cString: canonical)).appendingPathComponent("retained-replace-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try baseline.write(to: target)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    func testMatchingDisplacementRetainsBothVersions() throws {
        let recovery = try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate)
        XCTAssertEqual(recovery.record.state, .completed)
        XCTAssertEqual(try Data(contentsOf: target), candidate)
        XCTAssertEqual(try Data(contentsOf: recovery.prepared), candidate)
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), baseline)
        XCTAssertNoThrow(try RetainedFileReplacement.assertReadable(target))
    }
    func testInsufficientReserveRefusesBeforeStagingOrMutation() throws {
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate, availableBytes: { 0 })) { error in
            guard case RetainedFileReplacement.Failure.insufficientSpace = error else { return XCTFail("Unexpected failure: \(error)") }
        }
        XCTAssertEqual(try Data(contentsOf: target), baseline)
        XCTAssertTrue(try RetainedFileReplacement.inspect(target).isEmpty)
    }
    func testExchangePreservesPermissionsExtendedAttributesAndResourceFork() throws {
        XCTAssertEqual(chmod(target.path, 0o640), 0)
        let attributes = ["net.texttext.replacement-test": Data("metadata".utf8), "com.apple.ResourceFork": Data("resource fork".utf8)]
        for (name, value) in attributes {
            XCTAssertEqual(value.withUnsafeBytes { setxattr(target.path, name, $0.baseAddress, $0.count, 0, 0) }, 0)
        }
        let recovery = try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate)
        var information = stat()
        XCTAssertEqual(lstat(target.path, &information), 0)
        XCTAssertEqual(information.st_mode & 0o777, 0o640)
        for (name, value) in attributes {
            var bytes = [UInt8](repeating: 0, count: value.count)
            let count = bytes.withUnsafeMutableBytes { getxattr(target.path, name, $0.baseAddress, $0.count, 0, 0) }
            XCTAssertEqual(count, value.count)
            XCTAssertEqual(Data(bytes), value)
        }
        XCTAssertEqual(try Data(contentsOf: target), candidate)
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), baseline)
    }

    func testLastMomentExternalReplacementIsRetainedAndFencesReplay() throws {
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate) { stage in
            if stage == "beforeSwap" { try self.external.write(to: self.target, options: .atomic) }
        })
        let recovery = try XCTUnwrap(RetainedFileReplacement.inspect(target).first)
        XCTAssertEqual(recovery.record.state, .conflict)
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), external)
        XCTAssertEqual(try Data(contentsOf: recovery.prepared), candidate)
        XCTAssertEqual(try Data(contentsOf: target), candidate)
        XCTAssertThrowsError(try RetainedFileReplacement.assertReadable(target))
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(candidate), prepared: baseline))
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), external)
    }

    func testCrashAfterSwapClassifiesWithoutReplaying() throws {
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate) { stage in
            if stage == "swapped" { throw Interruption.stopped }
        })
        XCTAssertThrowsError(try RetainedFileReplacement.assertReadable(target))
        let recovery = try XCTUnwrap(RetainedFileReplacement.inspect(target).first)
        XCTAssertEqual(recovery.record.state, .pending)
        XCTAssertEqual(try RetainedFileReplacement.classify(recovery, target: target).record.state, .completed)
        XCTAssertNoThrow(try RetainedFileReplacement.assertReadable(target))
        XCTAssertEqual(try Data(contentsOf: target), candidate)
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), baseline)
    }

    func testCrashBeforeSwapAndLaterWriterNeverRollBack() throws {
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate) { stage in
            if stage == "prepared" { throw Interruption.stopped }
        })
        try external.write(to: target, options: .atomic)
        let recovery = try XCTUnwrap(RetainedFileReplacement.inspect(target).first)
        XCTAssertEqual(try RetainedFileReplacement.classify(recovery, target: target).record.state, .conflict)
        XCTAssertEqual(try Data(contentsOf: target), external)
        XCTAssertEqual(try Data(contentsOf: recovery.prepared), candidate)
        XCTAssertThrowsError(try RetainedFileReplacement.assertReadable(target))
    }

    func testThirdWriterAfterSwapSurvivesConflictClassification() throws {
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate) { stage in
            if stage == "swapped" { try self.external.write(to: self.target, options: .atomic) }
        })
        let recovery = try XCTUnwrap(RetainedFileReplacement.inspect(target).first)
        XCTAssertEqual(recovery.record.state, .conflict)
        XCTAssertEqual(try Data(contentsOf: target), external)
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), baseline)
        XCTAssertEqual(try Data(contentsOf: recovery.prepared), candidate)
    }

    func testExternalDescriptorCanKeepWritingRetainedInode() throws {
        let writer = try FileHandle(forWritingTo: target)
        defer { try? writer.close() }
        let recovery = try RetainedFileReplacement.replace(target, expectedHash: hash(baseline), prepared: candidate)
        try writer.truncate(atOffset: 0)
        try writer.write(contentsOf: external)
        try writer.synchronize()
        XCTAssertEqual(try Data(contentsOf: recovery.displaced), external)
        XCTAssertEqual(try Data(contentsOf: target), candidate)
        XCTAssertThrowsError(try RetainedFileReplacement.assertReadable(target))
        XCTAssertEqual(try RetainedFileReplacement.inspect(target).first?.record.state, .conflict)
    }
}
