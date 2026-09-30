import Foundation
import XCTest
import ZIPFoundation
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultImportTests: XCTestCase {
    func fixture(_ run: (URL, LocalVaultDocumentStore) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let vault = root.appendingPathComponent("Vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        try run(root, LocalVaultDocumentStore(root: vault))
    }

    func testPackImportPreservesOpaqueEntriesAssetsSourceAndAllocatesIdentity() throws {
        try fixture { root, store in
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: original\n---\n\nHello ![](assets/photo.png)",
                assets: [.init(filename: "photo.png", data: Data([1, 2, 3]), remoteURL: "assets/photo.png")], sourceURL: "https://example.com", in: root)
            try Data([9, 8, 7]).write(to: package.url.appendingPathComponent("opaque.dat"))
            let packed = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            let original = try Data(contentsOf: packed)
            let first = try store.importFile(from: packed, newPath: "Notes/First.textpack")
            let second = try store.importFile(from: packed, newPath: "Second.textpack")
            XCTAssertNotEqual(MarkdownIdentityCodec.extract(from: first.contents.markdown)?.itemId, "original")
            XCTAssertNotEqual(MarkdownIdentityCodec.extract(from: first.contents.markdown)?.itemId, MarkdownIdentityCodec.extract(from: second.contents.markdown)?.itemId)
            XCTAssertEqual(first.contents.assets.first?.data, Data([1, 2, 3]))
            XCTAssertEqual(first.contents.sourceURL, "https://example.com")
            let archive = try Archive(url: store.url(for: first.path), accessMode: .read)
            let entry = try XCTUnwrap(archive.first { $0.path.hasSuffix("/opaque.dat") })
            var opaque = Data()
            _ = try archive.extract(entry) { opaque.append($0) }
            XCTAssertEqual(opaque, Data([9, 8, 7]))
            XCTAssertThrowsError(try store.importFile(from: packed, newPath: first.path))
            XCTAssertEqual(try store.read(path: first.path).hash, first.hash)
            XCTAssertEqual(try Data(contentsOf: packed), original)
        }
    }

    func testBundleImportPreservesOpaqueFilesAndRejectsSymlink() throws {
        try fixture { root, store in
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "A bundle", assets: [], sourceURL: nil, in: root)
            try Data("opaque".utf8).write(to: package.url.appendingPathComponent("extra.txt"))
            XCTAssertTrue(try store.importFile(from: package.url, newPath: "Bundle.textpack").contents.markdown.contains("A bundle"))
            try FileManager.default.createSymbolicLink(at: package.url.appendingPathComponent("link"), withDestinationURL: root)
            XCTAssertThrowsError(try store.importFile(from: package.url, newPath: "Unsafe.textpack"))
            XCTAssertEqual(try store.list(), ["Bundle.textpack"])
        }
    }

    func testMarkdownImportCarriesReferencedAssetsAndRejectsTraversal() throws {
        try fixture { root, store in
            let markdown = root.appendingPathComponent("Note.md")
            try Data([1, 255]).write(to: root.appendingPathComponent("photo.png"))
            try Data("# Note\n\n![Photo](photo.png)\n\nhttps://example.com".utf8).write(to: markdown)
            let imported = try store.importFile(from: markdown, newPath: "Note.textpack")
            XCTAssertEqual(imported.contents.assets.first?.data, Data([1, 255]))
            let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(imported.contents.documentJSON).utf8)) as? [String: Any])
            let content = try XCTUnwrap(snapshot["content"] as? [String: Any])
            XCTAssertEqual(snapshot["schemaVersion"] as? Int, 1)
            XCTAssertEqual(content["title"] as? String, "Note")
            XCTAssertTrue((content["body"] as? String ?? "").contains("assets/1-photo.png"))
            XCTAssertNotNil(imported.contents.templateJSON)
            XCTAssertTrue(imported.contents.markdown.contains("# Note"))
            XCTAssertTrue(imported.contents.markdown.contains("assets/1-photo.png"))
            XCTAssertNil(imported.contents.assets.first?.remoteURL)
            try Data("![Unsafe](../private.png)".utf8).write(to: markdown)
            XCTAssertThrowsError(try store.importFile(from: markdown, newPath: "Unsafe.textpack"))
            XCTAssertEqual(try store.list(), ["Note.textpack"])
        }
    }
    func testExistingSnapshotAndLookStayUnchanged() throws {
        try fixture { root, store in
            let snapshot = try BuiltinTextPackDocument.create(title: "Existing", body: "Body")
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "Body", documentJSON: snapshot.documentJSON,
                templateJSON: snapshot.templateJSON, assets: [], sourceURL: nil, in: root)
            let imported = try store.importFile(from: package.url, newPath: "Existing.textpack")
            let before = try TextTextTextBundlePackage.read(from: package.url, in: root)
            XCTAssertEqual(imported.contents.documentJSON, before.documentJSON)
            XCTAssertEqual(imported.contents.templateJSON, snapshot.templateJSON)
        }
    }

    func testInvalidPackNeverAppearsInVault() throws {
        try fixture { root, store in
            let invalid = root.appendingPathComponent("Invalid.textpack")
            try Data("not an archive".utf8).write(to: invalid)
            XCTAssertThrowsError(try store.importFile(from: invalid, newPath: "Invalid.textpack"))
            XCTAssertTrue(try store.list().isEmpty)
            XCTAssertThrowsError(try store.importFile(from: invalid, newPath: "../Outside.textpack"))
        }
    }

}
