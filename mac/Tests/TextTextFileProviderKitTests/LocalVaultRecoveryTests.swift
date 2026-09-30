import Foundation
import XCTest
import ZIPFoundation
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultRecoveryTests: XCTestCase {
    func fixture(_ run: (URL, LocalVaultDocumentStore, LocalVaultDocumentStore.Document) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalVaultDocumentStore(root: root.appendingPathComponent("Vault"))
        let pack = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "# Original\n\nBody", assets: [], sourceURL: nil, in: root)
        let zip = try TextTextTextBundlePackage.zipToTextPack(packageURL: pack.url, in: root)
        let document = try store.importFile(from: zip, newPath: "Notes/Original.textpack")
        try run(root, store, document)
    }

    func testDeletedPackReadIsExactAndDoesNotChangeHistory() throws {
        try fixture { _, store, document in
            let original = try Data(contentsOf: store.url(for: document.path))
            try store.delete(path: document.path, expectedHash: document.hash)
            let page = try store.recoveryList()
            XCTAssertFalse(page.truncated)
            XCTAssertEqual(page.entries.count, 1)
            let entry = try XCTUnwrap(page.entries.first)
            XCTAssertEqual(entry.kind, "deleted")
            XCTAssertTrue(entry.path.contains("Original"))
            let history = store.root.appendingPathComponent(".texttext/history")
            try FileManager.default.removeItem(at: history.appendingPathComponent(document.hash + ".textpack"))
            let before = try FileManager.default.contentsOfDirectory(atPath: history.path)
            let recovered = try store.recoveryRead(id: entry.id)
            XCTAssertEqual(recovered.data, original)
            XCTAssertEqual(recovered.document.hash, document.hash)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: history.path), before)
            XCTAssertFalse(FileManager.default.fileExists(atPath: try store.url(for: document.path).path))
        }
    }

    func testRecoveryImportPreservesOpaqueAssetBytesAndMakesNewIdentity() throws {
        try fixture { root, store, _ in
            let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "# Photo\n\n![](assets/picture.png)",
                assets: [.init(filename: "picture.png", data: Data([1, 2, 3]), remoteURL: "assets/picture.png")], sourceURL: nil, in: root)
            try Data([8, 7, 6]).write(to: package.url.appendingPathComponent("opaque.dat"))
            let zip = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
            let original = try store.importFile(from: zip, newPath: "Photo.textpack")
            try store.delete(path: original.path, expectedHash: original.hash)
            let entry = try XCTUnwrap(store.recoveryList().entries.first)
            let recovered = try store.recoveryRead(id: entry.id)
            let source = root.appendingPathComponent("retained.textpack")
            try recovered.data.write(to: source)
            let copy = try store.importFile(from: source, newPath: "Recovered Photo.textpack")
            XCTAssertNotEqual(MarkdownIdentityCodec.extract(from: copy.contents.markdown)?.itemId,
                MarkdownIdentityCodec.extract(from: original.contents.markdown)?.itemId)
            XCTAssertEqual(copy.contents.assets.first?.data, Data([1, 2, 3]))
            let archive = try Archive(url: store.url(for: copy.path), accessMode: .read)
            let opaque = try XCTUnwrap(archive.first { $0.path.hasSuffix("/opaque.dat") || $0.path == "opaque.dat" })
            var data = Data()
            _ = try archive.extract(opaque) { data.append($0) }
            XCTAssertEqual(data, Data([8, 7, 6]))
            XCTAssertEqual(try store.recoveryRead(id: entry.id).data, recovered.data)
        }
    }

    func testNormalFrontmatterOnlyTitleAndUnsafeTitleBecomeSafeDisplayNames() throws {
        try fixture { root, store, _ in
            for (index, title) in ["An ordinary app note", "Folder/Unsafe\\Name:part\nline"].enumerated() {
                let encoded = String(decoding: try JSONSerialization.data(withJSONObject: title, options: .fragmentsAllowed), as: UTF8.self)
                let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntitle: \(encoded)\n---\n\nBody without heading", assets: [], sourceURL: nil, in: root)
                let zip = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
                let document = try store.importFile(from: zip, newPath: "Source-\(index).textpack")
                try store.delete(path: document.path, expectedHash: document.hash)
            }
            let page = try store.recoveryList()
            XCTAssertFalse(page.truncated)
            XCTAssertEqual(Set(page.entries.map(\.path)), ["An ordinary app note.textpack", "Folder-Unsafe-Name-part line.textpack"])
            for entry in page.entries { XCTAssertNoThrow(try store.recoveryRead(id: entry.id)) }
        }
    }

    func testHistoryMatchesIdentityAndRejectsModifiedSavedBytes() throws {
        try fixture { _, store, document in
            _ = try store.clone(path: document.path, newPath: "Other.textpack")
            _ = try store.write(path: document.path, expectedHash: document.hash, markdown: document.contents.markdown + "\nChanged", documentJSON: nil, templateJSON: nil, templateAuthoringSourceJSON: nil)
            let page = try store.recoveryList(path: document.path)
            XCTAssertEqual(page.entries.count, 2)
            XCTAssertTrue(page.entries.allSatisfy { $0.path == document.path && $0.kind == "revision" })
            let entry = try XCTUnwrap(page.entries.first { $0.hash == document.hash })
            XCTAssertEqual(try store.recoveryRead(id: entry.id).document.hash, document.hash)
            try Data("tampered".utf8).write(to: store.root.appendingPathComponent(".texttext/history/\(document.hash).textpack"))
            XCTAssertThrowsError(try store.recoveryRead(id: entry.id))
            XCTAssertTrue(try store.recoveryList(path: document.path).truncated)
        }
    }

    func testOversizedAndExcessRetainedEntriesReportTruncation() throws {
        try fixture { _, store, _ in
            let trash = store.root.appendingPathComponent(".texttext/trash")
            try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
            let large = trash.appendingPathComponent("oversized.textpack")
            XCTAssertTrue(FileManager.default.createFile(atPath: large.path, contents: nil))
            let handle = try FileHandle(forWritingTo: large)
            try handle.truncate(atOffset: 33 * 1024 * 1024)
            try handle.close()
            let page = try store.recoveryList()
            XCTAssertTrue(page.truncated)
            XCTAssertTrue(page.entries.isEmpty)
            for index in 0..<2050 {
                try Data().write(to: trash.appendingPathComponent("ignored-\(index).txt"))
            }
            XCTAssertTrue(try store.recoveryList().truncated)
        }
    }

    func testTraversalAndSymlinkRecoveryAreRejected() throws {
        try fixture { root, store, document in
            let conflict = store.root.appendingPathComponent(".texttext/conflicts/op")
            try FileManager.default.createDirectory(at: conflict, withIntermediateDirectories: true)
            let target = conflict.appendingPathComponent("local-Original.textpack")
            try FileManager.default.copyItem(at: store.url(for: document.path), to: target)
            let entry = try XCTUnwrap(store.recoveryList().entries.first)
            XCTAssertEqual(entry.kind, "conflict")
            try FileManager.default.removeItem(at: target)
            try FileManager.default.createSymbolicLink(at: target, withDestinationURL: store.url(for: document.path))
            XCTAssertThrowsError(try store.recoveryRead(id: entry.id))
            XCTAssertTrue(try store.recoveryList().entries.isEmpty)
            for location in [".texttext/trash/../../outside.textpack", ".texttext/trash//outside.textpack", "Notes/Original.textpack"] {
                let token = try JSONSerialization.data(withJSONObject: ["location": location, "path": document.path, "hash": document.hash]).base64EncodedString()
                XCTAssertThrowsError(try store.recoveryRead(id: token))
            }
            XCTAssertThrowsError(try store.recoveryRead(id: String(repeating: "a", count: 8193)))
            XCTAssertThrowsError(try store.recoveryList(path: "../outside.textpack"))
            _ = root
        }
    }
}
