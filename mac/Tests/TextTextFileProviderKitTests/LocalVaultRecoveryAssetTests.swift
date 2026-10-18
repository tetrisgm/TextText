import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultRecoveryAssetTests: XCTestCase {
    private var root: URL!
    private var store: LocalVaultDocumentStore { .init(root: root) }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func asset(_ operation: String, bytes: Data) throws -> URL {
        let directory = root.appendingPathComponent(".texttext/conflicts/" + operation)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("local-asset.bin")
        try bytes.write(to: file)
        return file
    }
    func testRawSubmittedBytesAreReadIndependentlyAndChangedHashRefused() throws {
        let bytes = Data([0, 255, 42]), file = try asset("operation-one", bytes: bytes)
        try Data("not a pack".utf8).write(to: file.deletingLastPathComponent().appendingPathComponent("local.textpack"))
        let entry = try XCTUnwrap(store.recoveryAssets().entries.first)
        XCTAssertEqual(entry.byteLength, bytes.count)
        XCTAssertEqual(entry.hash, TextTextStableDigest.sha256Hex(bytes))
        XCTAssertEqual(try store.recoveryAssetRead(id: entry.id, hash: entry.hash), bytes)
        XCTAssertEqual(try Data(contentsOf: file), bytes)
        try Data([1, 2, 3]).write(to: file, options: .atomic)
        XCTAssertThrowsError(try store.recoveryAssetRead(id: entry.id, hash: entry.hash))
        XCTAssertThrowsError(try store.recoveryAssetRead(id: entry.id, hash: String(repeating: "a", count: 64)))
    }
    func testKnownRawSymlinkIsRefusedAndUnknownFilesAreNotExported() throws {
        let file = try asset("operation-one", bytes: Data([1]))
        let outside = root.appendingPathComponent("outside.bin")
        try Data([9]).write(to: outside)
        let entry = try XCTUnwrap(store.recoveryAssets().entries.first)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: outside)
        XCTAssertThrowsError(try store.recoveryAssets())
        XCTAssertThrowsError(try store.recoveryAssetRead(id: entry.id, hash: entry.hash))
        try FileManager.default.removeItem(at: file)
        try Data([5]).write(to: file.deletingLastPathComponent().appendingPathComponent("unrelated.bin"))
        XCTAssertTrue(try store.recoveryAssets().entries.isEmpty)
    }
    func testCountAndAggregateScanLimitsAreExplicit() throws {
        for index in 0..<201 { _ = try asset("operation-\(index)", bytes: Data()) }
        let page = try store.recoveryAssets()
        XCTAssertEqual(page.entries.count, 200)
        XCTAssertTrue(page.truncated)
    }
    func testOversizedRawCopyIsNotReturnedAsAnEmptySuccess() throws {
        let file = try asset("large-operation", bytes: Data())
        let handle = try FileHandle(forWritingTo: file)
        try handle.truncate(atOffset: 16 * 1024 * 1024 + 1); try handle.close()
        XCTAssertThrowsError(try store.recoveryAssets())
    }
    func testValidOriginIsShownButCorruptOriginDoesNotBlockExactDownload() throws {
        let bytes = Data([7, 8]), file = try asset("bound-operation", bytes: bytes)
        let hash = TextTextStableDigest.sha256Hex(bytes)
        let provenance: [String: Any] = ["version": 1, "operationId": "bound-operation", "itemId": "item-one", "path": "Notes/Note.textpack", "entryPath": "assets/picture.png", "payloadHash": hash, "rawFilename": "local-asset.bin", "rawHash": hash]
        let sidecar = file.deletingLastPathComponent().appendingPathComponent("asset-provenance.json")
        try JSONSerialization.data(withJSONObject: provenance).write(to: sidecar)
        let entry = try XCTUnwrap(store.recoveryAssets().entries.first)
        XCTAssertEqual(entry.entryPath, "assets/picture.png")
        XCTAssertEqual(entry.itemPath, "Notes/Note.textpack")
        XCTAssertNil(entry.provenanceError)
        try Data("malformed origin".utf8).write(to: sidecar, options: .atomic)
        let damaged = try XCTUnwrap(store.recoveryAssets().entries.first)
        XCTAssertNil(damaged.entryPath)
        XCTAssertNotNil(damaged.provenanceError)
        XCTAssertEqual(try store.recoveryAssetRead(id: damaged.id, hash: damaged.hash), bytes)
    }
    func testAggregateByteLimitIsExplicit() throws {
        for index in 0..<5 {
            let file = try asset("large-\(index)", bytes: Data())
            let handle = try FileHandle(forWritingTo: file)
            try handle.truncate(atOffset: 16 * 1024 * 1024); try handle.close()
        }
        let page = try store.recoveryAssets()
        XCTAssertEqual(page.entries.count, 4)
        XCTAssertTrue(page.truncated)
    }

}
