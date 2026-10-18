import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit
@testable import TextTextCLICore

final class CLIWorkspaceRootFenceTests: XCTestCase {
    private func fixture() throws -> (URL, CLIWorkspace, CLIDocumentReference, String, String) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("cli-root-fence-" + UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        let store = DocumentStore(root: root)
        let target = try store.create(title: "Nested fixture", body: "## Scope\nOriginal body", folder: "Notes", kind: "note")
        let relative = store.relativePath(of: target), original = try LocalVaultDocumentStore(root: root).read(path: relative)
        let itemId = try XCTUnwrap(store.itemId(at: target)), operation = UUID()
        let bytes = try Data(contentsOf: target), prepared = bytes + Data([1]), displaced = bytes + Data([2])
        let registry = ReplacementRecoveryRegistry(root: root)
        try registry.register(operation: operation, itemId: itemId, path: relative,
            expectedHash: original.hash, preparedHash: TextTextStableDigest.sha256Hex(prepared), workspaceStaging: true)
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: original.hash, prepared: prepared,
            operation: operation, recoveryRoot: registry.recoveryRoot(path: relative), observe: { stage in
                if stage == "beforeSwap" { try displaced.write(to: target, options: .atomic) }
            }))
        XCTAssertThrowsError(try LocalVaultDocumentStore(root: root).read(path: relative))
        return (root, .local(store), .local(target), original.contents.markdown, itemId)
    }
    func testNestedLegacyUnownedWritePreservesAbsentIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("cli-legacy-root-" + UUID().uuidString)
        let scratch = root.appendingPathComponent(".scratch"), notes = root.appendingPathComponent("Notes")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: notes, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "# Legacy\nOriginal", assets: [], sourceURL: nil, in: scratch)
        let packed = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch)
        let target = notes.appendingPathComponent("Legacy.textpack")
        try FileManager.default.copyItem(at: packed, to: target)
        let workspace = CLIWorkspace.local(DocumentStore(root: root)), reference = CLIDocumentReference.local(target)
        let before = try await workspace.readContent(at: reference)
        try await workspace.writeMarkdown("# Legacy\nChanged", to: reference, ifMatchHash: before.hash)
        let after = try await workspace.readContent(at: reference)
        XCTAssertEqual(after.markdown, "# Legacy\nChanged")
        let identity = await workspace.itemId(at: reference)
        XCTAssertNil(identity)
        XCTAssertFalse(after.markdown.contains("textTextId"))
    }
    func testNestedReadAndIdentityLookupHonorSelectedWorkspaceFence() async throws {
        let (root, workspace, reference, _, _) = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        do { _ = try await workspace.readContent(at: reference); XCTFail("Nested reads must use the selected root's unresolved operation") }
        catch { }
        let identity = await workspace.itemId(at: reference)
        XCTAssertNil(identity, "Identity lookup must not bypass a fenced normal read")
    }
    func testNestedWriteAppendAndSectionHonorSelectedWorkspaceFence() async throws {
        for operation in ["write", "append", "section"] {
            let (root, workspace, reference, markdown, _) = try fixture()
            defer { try? FileManager.default.removeItem(at: root) }
            guard case .local(let target) = reference else { return XCTFail("Expected local fixture") }
            let before = try Data(contentsOf: target), hash = TextTextStableDigest.sha256Hex(before)
            do {
                switch operation {
                case "write": try await workspace.writeMarkdown("Changed", to: reference, ifMatchHash: hash)
                case "append": try await workspace.appendMarkdown("Append", to: reference, idempotencyKey: "cli-nested-append")
                default:
                    let section = try XCTUnwrap(DocumentSections.find("## Scope", in: markdown))
                    try await workspace.replaceSectionBody("Replacement", section: section, in: reference, ifMatchHash: hash)
                }
                XCTFail("Nested \(operation) must not escape the selected workspace fence")
            } catch { }
            XCTAssertEqual(try Data(contentsOf: target), before, "Rejected \(operation) must preserve the visible archive")
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/.texttext").path),
                "Nested operations must not fork private state beneath Notes")
        }
    }
}
