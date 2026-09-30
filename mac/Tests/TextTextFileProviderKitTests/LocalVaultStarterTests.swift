import Foundation
import XCTest
import ZIPFoundation
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultStarterTests: XCTestCase {
    private var bundled: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("presets/builtin")
    }
    private func fixture(_ body: (URL) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(root)
    }
    func testRealPresetsHaveAllFoldersDistinctIdentitiesAndExactTemplatePayloads() throws {
        try fixture { root in
            let result = try LocalVaultStarter.seed(root: root, presets: bundled)
            XCTAssertEqual(result.createdPaths.count, 22)
            XCTAssertEqual(try LocalVaultStarter.listFolders(root: root), LocalVaultStarter.folders.sorted())
            let store = LocalVaultDocumentStore(root: root)
            var identities: Set<String> = []
            for preset in LocalVaultStarter.presets {
                let original = try Archive(url: bundled.appendingPathComponent(preset.id + ".textpack"), accessMode: .read)
                let path = "Templates/\(preset.name).textpack"
                let installed = try Archive(url: store.url(for: path), accessMode: .read)
                // Every entry except identity-bearing Markdown is byte-for-byte
                // preserved: source definitions, media, opaque future metadata.
                for entry in original where !entry.path.hasSuffix("/text.md") && entry.path != "text.md" {
                    let copy = try XCTUnwrap(installed[entry.path])
                    var expected = Data(), actual = Data()
                    _ = try original.extract(entry) { expected.append($0) }
                    _ = try installed.extract(copy) { actual.append($0) }
                    XCTAssertEqual(actual, expected, entry.path)
                }
                for file in [path, preset.example] {
                    let document = try store.read(path: file)
                    let id = try XCTUnwrap(MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId)
                    XCTAssertTrue(identities.insert(id).inserted)
                    XCTAssertNotNil(document.contents.documentJSON)
                    XCTAssertNotNil(document.contents.templateJSON)
                }
            }
            XCTAssertEqual(identities.count, 22)
        }
    }
    func testCompletedSeedDoesNotResurrectDeletedFilesOrFolders() throws {
        try fixture { root in
            _ = try LocalVaultStarter.seed(root: root, presets: bundled)
            try FileManager.default.removeItem(at: root.appendingPathComponent("Notes"))
            try FileManager.default.removeItem(at: root.appendingPathComponent("Templates/Note.textpack"))
            let result = try LocalVaultStarter.seed(root: root, presets: bundled)
            XCTAssertTrue(result.alreadyComplete)
            XCTAssertTrue(result.createdPaths.isEmpty)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes").path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("Templates/Note.textpack").path))
        }
    }
    func testInterruptedSeedPreservesProcessedDeletionAndOccupiedUserPath() throws {
        try fixture { root in
            let fm = FileManager.default
            try fm.createDirectory(at: root.appendingPathComponent(".texttext"), withIntermediateDirectories: false)
            try fm.createDirectory(at: root.appendingPathComponent("Templates"), withIntermediateDirectories: false)
            let userData = Data("user-owned file".utf8)
            try userData.write(to: root.appendingPathComponent("Templates/Bookmark.textpack"))
            try Data("{\"version\":1,\"complete\":false,\"processed\":[\"Templates/Note.textpack\"]}".utf8)
                .write(to: root.appendingPathComponent(".texttext/starter-v1.json"))
            let result = try LocalVaultStarter.seed(root: root, presets: bundled)
            XCTAssertEqual(result.createdPaths.count, 20)
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("Templates/Bookmark.textpack")), userData)
            XCTAssertFalse(fm.fileExists(atPath: root.appendingPathComponent("Templates/Note.textpack").path))
        }
    }
    func testRefusesSymlinkFoldersStateAndDestination() throws {
        for relative in ["Templates", ".texttext", "Templates/Note.textpack"] {
            try fixture { root in
                let outside = root.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false)
                defer { try? FileManager.default.removeItem(at: outside) }
                if relative.contains("/") { try FileManager.default.createDirectory(at: root.appendingPathComponent("Templates"), withIntermediateDirectories: false) }
                try FileManager.default.createSymbolicLink(at: root.appendingPathComponent(relative), withDestinationURL: outside)
                XCTAssertThrowsError(try LocalVaultStarter.seed(root: root, presets: bundled))
                XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: outside.path), [])
            }
        }
    }
    func testFolderListKeepsEmptyFoldersAndSkipsMetadataPackagesAndLinks() throws {
        try fixture { root in
            let fm = FileManager.default
            for path in ["Empty/Nested", ".texttext/internal", "Bundle.textbundle/inside"] {
                try fm.createDirectory(at: root.appendingPathComponent(path), withIntermediateDirectories: true)
            }
            try fm.createSymbolicLink(at: root.appendingPathComponent("Linked"), withDestinationURL: root.appendingPathComponent("Empty"))
            XCTAssertEqual(try LocalVaultStarter.listFolders(root: root), ["Empty", "Empty/Nested"])
        }
    }
}
