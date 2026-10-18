import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultOpaqueReplacementTests: XCTestCase {
    private var root: URL!
    private var store: LocalVaultDocumentStore { .init(root: root) }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func hash(_ data: Data) -> String { TextTextStableDigest.sha256Hex(data) }
    private func pack(_ itemId: String) throws -> Data {
        let scratch = root.appendingPathComponent("." + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: itemId, body: "Retained body")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: Retained\n---\n\nRetained body",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    private func conflict(_ displaced: Data) throws -> LocalVaultDocumentStore.ReplacementRecoveryEntry {
        let target = root.appendingPathComponent("Note.textpack"), original = try pack("item-one"), prepared = try pack("item-one")
        try original.write(to: target)
        let operation = UUID()
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(original), prepared: prepared, operation: operation, observe: { stage in
            if stage == "prepared" { try ReplacementRecoveryRegistry(root: self.root).register(operation: operation, itemId: "item-one", path: "Note.textpack", expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
            if stage == "beforeSwap" { try displaced.write(to: target, options: .atomic) }
        }))
        return try XCTUnwrap(store.replacementRecoveryList().first)
    }
    func testInvalidDisplacedPackIsOpaqueAndExactBytesRemainResolvable() throws {
        let raw = Data([0, 255, 42]), entry = try conflict(raw)
        let snapshot = try store.replacementRecoveryRead(id: entry.id, version: "displaced")
        XCTAssertNil(snapshot.document)
        XCTAssertNotNil(snapshot.parseError)
        XCTAssertEqual(snapshot.data, raw)
        XCTAssertEqual(snapshot.hash, hash(raw))
        XCTAssertNotNil(try store.replacementRecoveryRead(id: entry.id, version: "prepared").document)
        try store.resolveReplacement(id: entry.id, path: entry.path, itemId: entry.itemId, currentHash: entry.currentHash, preparedHash: entry.preparedHash, displacedHash: entry.displacedHash)
        XCTAssertNoThrow(try store.read(path: entry.path))
        let reopened = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertTrue(reopened.resolved)
        XCTAssertEqual(try store.replacementRecoveryRead(id: reopened.id, version: "displaced").data, raw)
    }
    func testForeignDisplacedIdentityIsKeptWithoutInventingCurrentIdentity() throws {
        let foreign = try pack("other-item"), entry = try conflict(foreign)
        let snapshot = try store.replacementRecoveryRead(id: entry.id, version: "displaced")
        XCTAssertEqual(MarkdownIdentityCodec.extract(from: try XCTUnwrap(snapshot.document).contents.markdown)?.itemId, "other-item")
        XCTAssertEqual(snapshot.data, foreign)
        XCTAssertNil(snapshot.parseError)
    }
    func testLateDisplacedWriterReopensExplicitlyResolvedRecovery() throws {
        let entry = try conflict(Data([1, 2, 3]))
        try store.resolveReplacement(id: entry.id, path: entry.path, itemId: entry.itemId, currentHash: entry.currentHash, preparedHash: entry.preparedHash, displacedHash: entry.displacedHash)
        XCTAssertTrue(try XCTUnwrap(store.replacementRecoveryList().first).resolved)
        let retained = try XCTUnwrap(RetainedFileReplacement.inspect(root.appendingPathComponent(entry.path)).first)
        let writer = try FileHandle(forWritingTo: retained.displaced)
        try writer.truncate(atOffset: 0); try writer.write(contentsOf: Data([9, 8])); try writer.synchronize(); try writer.close()
        let reopened = try XCTUnwrap(store.replacementRecoveryList().first)
        XCTAssertFalse(reopened.resolved)
        XCTAssertEqual(try store.replacementRecoveryRead(id: reopened.id, version: "displaced").data, Data([9, 8]))
    }

}
