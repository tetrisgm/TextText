import XCTest
import ZIPFoundation
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class TextTextProjectionBaselineTests: XCTestCase {
    private var root: URL!
    private let itemId = "e2222222-2222-4222-8222-222222222222"
    private let path = "Notes/Note.textpack"
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    private func markdown(_ body: String) -> String { "---\ntextTextId: \"\(itemId)\"\ntitle: Note\n---\n\n\(body)" }
    private func documentJSON(_ body: String) throws -> String {
        let created = try BuiltinTextPackDocument.create(title: "Note", body: body)
        var json = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(created.documentJSON.utf8)) as? [String: Any])
        var content = try XCTUnwrap(json["content"] as? [String: Any]); content["body"] = body; json["content"] = content
        return String(decoding: try JSONSerialization.data(withJSONObject: json), as: UTF8.self)
    }
    private func entries(_ document: LocalVaultDocumentStore.Document) throws -> [String: Data] {
        let archive = try Archive(url: root.appendingPathComponent(document.path), accessMode: .read)
        var result: [String: Data] = [:]
        for entry in archive where !entry.path.hasSuffix("/") {
            var data = Data(); _ = try archive.extract(entry) { data.append($0) }
            result[String(entry.path.split(separator: "/").last!)] = data
        }
        return result
    }
    private func fixture(stamped: Bool, path: String? = nil) throws -> LocalVaultDocumentStore.Document {
        let path = path ?? self.path
        let created = try BuiltinTextPackDocument.create(title: "Note", body: "Original")
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown("Original"), documentJSON: try documentJSON("Original"),
            templateJSON: created.templateJSON, projectionJSON: stamped ? "" : nil, assets: [], sourceURL: nil, in: root)
        try Data("opaque original".utf8).write(to: package.url.appendingPathComponent("extra.dat"))
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: pack, to: url)
        try FileManager.default.removeItem(at: pack)
        return try LocalVaultDocumentStore(root: root).read(path: path)
    }
    private func sidecar(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testStampDigestsTheWrittenBytesAndRefusesIncoherentPairs() throws {
        let json = try documentJSON("Body")
        let stamp = try XCTUnwrap(TextTextProjectionBaseline.stamp(itemId: itemId, markdown: Data(markdown("Body").utf8), documentJSON: Data(json.utf8)))
        let value = try sidecar(stamp)
        XCTAssertEqual(value["version"] as? Int, 1)
        XCTAssertEqual(value["itemId"] as? String, itemId)
        XCTAssertEqual(value["markdownSha256"] as? String, TextTextStableDigest.sha256Hex(markdown("Body")))
        XCTAssertEqual(value["documentSha256"] as? String, TextTextStableDigest.sha256Hex(json))
        XCTAssertEqual(((value["document"] as? [String: Any])?["content"] as? [String: Any])?["body"] as? String, "Body")
        XCTAssertNil(TextTextProjectionBaseline.stamp(itemId: itemId, markdown: Data(markdown("Other").utf8), documentJSON: Data(json.utf8)))
        XCTAssertNil(TextTextProjectionBaseline.stamp(itemId: itemId, markdown: Data(markdown("Body").utf8), documentJSON: Data("{}".utf8)))
    }

    func testSharedCoherenceFixture() throws {
        // sync/fixtures/projection-coherence.json is also run by
        // pack-projection-baseline.test.ts: both implementations must agree
        // on every item-template projection and every true frontmatter conflict.
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: repository.appendingPathComponent("sync/fixtures/projection-coherence.json"))) as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 10)
        for value in cases {
            let name = try XCTUnwrap(value["name"] as? String)
            let markdown = Data(try XCTUnwrap(value["markdown"] as? String).utf8)
            let document = try JSONSerialization.data(withJSONObject: XCTUnwrap(value["document"]), options: [.sortedKeys, .withoutEscapingSlashes])
            let stamp = TextTextProjectionBaseline.stamp(itemId: itemId, markdown: markdown, documentJSON: document)
            XCTAssertEqual(stamp != nil, try XCTUnwrap(value["coherent"] as? Bool), name)
            if let stamp {
                let decoded = try sidecar(stamp)
                XCTAssertEqual(decoded["documentSha256"] as? String, TextTextStableDigest.sha256Hex(document), name)
                XCTAssertEqual(decoded["markdownSha256"] as? String, TextTextStableDigest.sha256Hex(markdown), name)
            }
        }
    }

    func testStampMirrorsTheSharedOverlayEdgeCases() throws {
        let json = try documentJSON("Body")
        func markdown(_ lines: String) -> Data { Data("---\ntextTextId: \"\(itemId)\"\n\(lines)\n---\n\nBody".utf8) }
        let stamp = { (lines: String) in TextTextProjectionBaseline.stamp(itemId: self.itemId, markdown: markdown(lines), documentJSON: Data(json.utf8)) }
        XCTAssertNotNil(stamp("title: Note"))
        XCTAssertNotNil(stamp("title: \"Note\"\nexcerpt: \"\"\nkind: \"note\""))
        // A later duplicate key wins, as in the shared parser.
        XCTAssertNotNil(stamp("title: Other\ntitle: Note"))
        XCTAssertNil(stamp("title: Note\ntitle: Other"))
        XCTAssertNil(stamp("title: Note\nexcerpt: \"Sub\""))
        XCTAssertNil(stamp("title: Note\ncover: \"https://example.com/c.png\""))
        XCTAssertNil(stamp("title: Note\naccent: \"#112233\""))
        XCTAssertNil(stamp("title: Note\naccent: \"blue\""))
        XCTAssertNil(stamp("title: Note\ncoverHeight: \"tall\""))
        XCTAssertNil(stamp("title: Note\npinned: \"yes\""))
        // Empty lists remove what the snapshot does not hold, so they agree.
        XCTAssertNotNil(stamp("title: Note\nlinks: []\ngallery: []\ntags: []"))
        XCTAssertNil(TextTextProjectionBaseline.stamp(itemId: itemId, markdown: Data("---\ntitle: Note\n---\n\n###### Sub\nBody".utf8), documentJSON: Data(json.utf8)))
        XCTAssertEqual(MarkdownProjection.subtitle(ofBody: "\n###### *Dawn* [link](x) ##\nBody"), "Dawn link")
        XCTAssertEqual(MarkdownProjection.normalizeTags("Alpha, #beta ,alpha"), ["alpha", "beta"])
        XCTAssertFalse(MarkdownProjection.isSafeLinkHref("javascript:alert(1)"))
        XCTAssertTrue(MarkdownProjection.isSafeLinkHref("mailto:a@b.c"))
    }

    func testMaterializedPackageCarriesAReadableStamp() throws {
        let document = try fixture(stamped: true)
        let files = try entries(document)
        let stamp = try sidecar(try XCTUnwrap(files[TextTextProjectionBaseline.entryName]))
        XCTAssertEqual(stamp["markdownSha256"] as? String, TextTextStableDigest.sha256Hex(try XCTUnwrap(files["text.md"])))
        XCTAssertEqual(stamp["documentSha256"] as? String, TextTextStableDigest.sha256Hex(try XCTUnwrap(files["document.json"])))
        XCTAssertNotNil(document.contents.projectionJSON)
        XCTAssertNil(try fixture(stamped: false, path: "Notes/Legacy.textpack").contents.projectionJSON)
    }

    func testCoherentWriteRestampsAndMarkdownOnlyWriteKeepsTheEarlierStamp() throws {
        let original = try fixture(stamped: false)
        let store = LocalVaultDocumentStore(root: root)
        let saved = try store.write(path: path, expectedHash: original.hash, markdown: markdown("Original\nApp"),
            documentJSON: try documentJSON("Original\nApp"), templateJSON: original.contents.templateJSON,
            templateAuthoringSourceJSON: nil, projectionJSON: "")
        let afterSave = try entries(saved)
        let stamp = try sidecar(try XCTUnwrap(afterSave[TextTextProjectionBaseline.entryName]))
        XCTAssertEqual(stamp["markdownSha256"] as? String, TextTextStableDigest.sha256Hex(try XCTUnwrap(afterSave["text.md"])))
        XCTAssertEqual(stamp["documentSha256"] as? String, TextTextStableDigest.sha256Hex(try XCTUnwrap(afterSave["document.json"])))
        XCTAssertEqual(afterSave["extra.dat"], Data("opaque original".utf8))
        // An unchanged save stays a no-op even when a stamp is requested.
        let repeated = try store.write(path: path, expectedHash: saved.hash, markdown: saved.contents.markdown,
            documentJSON: saved.contents.documentJSON, templateJSON: saved.contents.templateJSON, templateAuthoringSourceJSON: nil, projectionJSON: "")
        XCTAssertEqual(repeated.hash, saved.hash)
        // A CLI-style Markdown-only write leaves the stamp, so its digests still
        // show that only text.md moved.
        let appended = try store.write(path: path, expectedHash: saved.hash, markdown: markdown("Original\nApp\nCLI"),
            documentJSON: saved.contents.documentJSON, templateJSON: saved.contents.templateJSON, templateAuthoringSourceJSON: nil)
        let afterAppend = try entries(appended)
        XCTAssertEqual(afterAppend[TextTextProjectionBaseline.entryName], afterSave[TextTextProjectionBaseline.entryName])
        XCTAssertEqual(afterAppend["document.json"], afterSave["document.json"])
        XCTAssertNotEqual(afterAppend["text.md"], afterSave["text.md"])
        XCTAssertEqual(stamp["documentSha256"] as? String, TextTextStableDigest.sha256Hex(try XCTUnwrap(afterAppend["document.json"])))
        XCTAssertNotEqual(stamp["markdownSha256"] as? String, TextTextStableDigest.sha256Hex(try XCTUnwrap(afterAppend["text.md"])))
    }
}
