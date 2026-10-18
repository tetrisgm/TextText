import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultSharedReplacementFenceTests: XCTestCase {
    private var root: URL!
    private let itemId = "shared-replacement-item"
    private let path = "Note.textpack"
    private var shared: LocalVaultSharedEditingStore { .init(root: root) }
    private var files: LocalVaultDocumentStore { .init(root: root) }
    private func hash(_ bytes: Data) -> String { TextTextStableDigest.sha256Hex(bytes) }
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func pack(_ body: String) throws -> Data {
        let scratch = root.appendingPathComponent("." + UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: Note\n---\n\n" + body,
            documentJSON: document.documentJSON, templateJSON: document.templateJSON, assets: [], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    private func checkpoint(_ document: LocalVaultDocumentStore.Document) throws -> LocalVaultSharedCheckpoint {
        let journal: [String: Any] = ["version": 1, "journalGeneration": 1, "epoch": 1, "seq": 0, "revision": document.hash,
            "relativePath": path, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
        return .init(itemId: itemId, path: path, projectedHash: document.hash, acknowledgedRevision: document.hash,
            epoch: 1, seq: 0, journalGeneration: 1, journal: String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true, retiredReason: nil)
    }
    private func fixture() throws -> LocalVaultDocumentStore.Document {
        try pack("Original").write(to: root.appendingPathComponent(path))
        return try files.read(path: path)
    }
    private func conflict() throws {
        let target = root.appendingPathComponent(path), original = try Data(contentsOf: target)
        let prepared = try pack("Prepared"), external = try pack("Outside"), operation = UUID()
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: hash(original), prepared: prepared, operation: operation) { stage in
            if stage == "prepared" { try ReplacementRecoveryRegistry(root: self.root).register(operation: operation, itemId: self.itemId, path: self.path, expectedHash: self.hash(original), preparedHash: self.hash(prepared)) }
            if stage == "beforeSwap" { try external.write(to: target, options: .atomic) }
        })
        XCTAssertThrowsError(try ReplacementRecoveryRegistry(root: root).assertReadable(itemId: itemId))
    }
    private func journalBytes() throws -> [String: Data] {
        let directory = LocalVaultDeviceState.directory(root: root).appendingPathComponent("shared-editing/" + itemId)
        return try Dictionary(uniqueKeysWithValues: FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).map { ($0.lastPathComponent, try Data(contentsOf: $0)) })
    }
    func testAlreadyOpenCheckpointCannotAcknowledgeReplacementConflict() throws {
        let document = try fixture(), checkpoint = try checkpoint(document)
        _ = try shared.materialize(checkpoint: checkpoint, expectedHash: document.hash, markdown: document.contents.markdown, documentJSON: XCTUnwrap(document.contents.documentJSON))
        let before = try journalBytes()
        try conflict()
        XCTAssertThrowsError(try shared.checkpoint(itemId: itemId, recoverIntents: false))
        XCTAssertThrowsError(try shared.checkpoint(itemId: itemId))
        XCTAssertThrowsError(try shared.materialize(checkpoint: checkpoint, expectedHash: document.hash, markdown: document.contents.markdown, documentJSON: XCTUnwrap(document.contents.documentJSON)))
        XCTAssertEqual(try journalBytes(), before)
        XCTAssertNoThrow(try shared.checkpoint(itemId: "unrelated-item"))
    }
    func testInterruptedIntentIsNotRetiredWhenReplacementBecomesUnresolved() throws {
        let document = try fixture(), checkpoint = try checkpoint(document)
        XCTAssertThrowsError(try shared.materialize(checkpoint: checkpoint, expectedHash: document.hash, markdown: document.contents.markdown, documentJSON: XCTUnwrap(document.contents.documentJSON), interruptAfterIntent: true))
        let before = try journalBytes()
        XCTAssertNotNil(before["intent.json"])
        try conflict()
        XCTAssertThrowsError(try shared.checkpoint(itemId: itemId))
        XCTAssertThrowsError(try shared.checkpoint(itemId: itemId, recoverIntents: false))
        XCTAssertEqual(try journalBytes(), before)
    }
}
