#if TEXTTEXT_STRESS_ACTOR
import XCTest
import WebKit
import ZIPFoundation
import TextTextWorkspaceCore
@testable import TextTextApp

final class NativeStressAssetProofTests: XCTestCase {
    let item = "e1111111-1111-4111-8111-111111111111"
    func pack(body: String = "Body", markdownBody: String = "Body", asset: Bool = true, assetName: String = "assets/test.bin") throws -> Data {
        let archive = try Archive(accessMode: .create)
        func add(_ name: String, _ bytes: Data) throws {
            try archive.addEntry(with: name, type: .file, uncompressedSize: Int64(bytes.count)) { position, size in
                bytes.subdata(in: Int(position)..<min(bytes.count, Int(position) + size))
            }
        }
        try add("text.md", Data("---\ntextTextId: \(item)\n---\n\n\(markdownBody)".utf8))
        try add("document.json", JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "content": ["title": "Title", "body": body], "hidden": ["notSchemaCertified": true]]))
        if asset { try add(assetName, Data([0,255,128,31])) }
        return try XCTUnwrap(archive.data)
    }
    func testStrictRequestBeforeReads() throws {
        XCTAssertEqual(try NativeStressAssetProof.request(["version": 1, "sampleId": item]), item)
        for value: [String: Any] in [["version": true, "sampleId": item], ["version": 2, "sampleId": item],
                                   ["version": 1, "sampleId": item.uppercased()], ["version": 1, "sampleId": item, "future": true]] {
            XCTAssertThrowsError(try NativeStressAssetProof.request(value))
        }
    }
    func testActualBytesAssetsAndNoSchemaDuplication() throws {
        let bytes = try pack(), observed = try NativeStressAssetProof.inspect(bytes, itemId: item)
        XCTAssertEqual(observed.archiveHash, NativeStressAssetProof.hash(bytes))
        XCTAssertEqual(observed.assets, ["assets/test.bin": NativeStressAssetProof.hash(Data([0,255,128,31]))])
        XCTAssertTrue(String(decoding: observed.canonicalDocument, as: UTF8.self).contains("notSchemaCertified"))
        XCTAssertThrowsError(try NativeStressAssetProof.inspect(bytes, itemId: UUID().uuidString.lowercased()))
        XCTAssertThrowsError(try NativeStressAssetProof.inspect(pack(markdownBody: "Different"), itemId: item))
        XCTAssertThrowsError(try NativeStressAssetProof.inspect(pack(asset: false), itemId: item))
        XCTAssertThrowsError(try NativeStressAssetProof.inspect(pack(assetName: "assets/../escape"), itemId: item))
    }
    func testMalformedUTF8ArchiveNamesRefuseBeforeIdentity() throws {
        var bytes = try pack()
        let name = Data("assets/test.bin".utf8)
        var cursor = bytes.startIndex
        while cursor < bytes.endIndex, let range = bytes.range(of: name, in: cursor..<bytes.endIndex) {
            bytes[range.upperBound - 1] = 255; cursor = range.upperBound
        }
        XCTAssertThrowsError(try NativeStressAssetProof.inspect(bytes, itemId: item))
    }
    func testECMAScriptCanonicalRetainsAbsenceAndNumericSemantics() throws {
        let raw = Data(#"{"2":1.0,"10":-0,"a":1e-7,"content":{"title":"café/漢字","body":"Body"}}"#.utf8)
        let canonical = String(decoding: try NativeStressLeafMove.canonicalDocument(raw), as: UTF8.self)
        XCTAssertEqual(canonical, #"{"2":1,"10":0,"a":1e-7,"content":{"body":"Body","title":"café/漢字"}}"#)
        XCTAssertFalse(canonical.contains("subtitle"))
    }
    func testReadonlyReadRefusesLinksAndPreservesBytes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let bytes = try pack(), path = root.appendingPathComponent("Owned.textpack")
        try bytes.write(to: path)
        XCTAssertEqual(try NativeStressAssetProof.read(root: root, relativePath: "Owned.textpack"), bytes)
        XCTAssertEqual(try Data(contentsOf: path), bytes)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("Link.textpack"), withDestinationURL: path)
        XCTAssertThrowsError(try NativeStressAssetProof.read(root: root, relativePath: "Link.textpack"))
        XCTAssertThrowsError(try NativeStressAssetProof.read(root: root, relativePath: "../Owned.textpack"))
    }
    @MainActor
    func testActualWKProductSchemaRejectsHiddenInvalidFields() async throws {
        guard let directory = ProcessInfo.processInfo.environment["TEXTTEXT_ASSET_INSPECTION_FIXTURE"], directory.hasPrefix("/") else {
            XCTFail("Build the genuine schema fixture and supply its absolute private path"); return
        }
        let root = URL(fileURLWithPath: directory), html = try Data(contentsOf: root.appendingPathComponent("inspection.html"))
        let manifest = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("manifest.json"))) as? [String: Any])
        XCTAssertEqual(manifest["htmlSha256"] as? String, NativeStressAssetProof.hash(html))
        XCTAssertEqual(manifest["testOnly"] as? Bool, true)
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 300), configuration: configuration)
        view.loadHTMLString(try XCTUnwrap(String(data: html, encoding: .utf8)), baseURL: nil)
        var ready = false
        for _ in 0..<200 {
            if (try? await view.evaluateJavaScript("window.assetInspectionFixtureReady===true")) as? Bool == true { ready = true; break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(ready)
        let valid = try await view.evaluateJavaScript("(()=>{const f=window.assetInspectionFixture,d=window.texttextDocumentInspection.read(f.item);return d.content.title==='Title'&&!Object.hasOwn(d.content,'subtitle')})()")
        XCTAssertEqual(valid as? Bool, true)
        let script = try NativeStressDocumentInspection.script(itemId: item, workspaceId: "fixture-workspace", title: "Title")
        let inspected = try await view.evaluateJavaScript(script)
        let value = try XCTUnwrap(inspected as? [String: Any])
        XCTAssertEqual((value["content"] as? [String: Any])?["body"] as? String, "Body")
        let numeric = #"{"2":1.0,"10":-0,"a":1e-7,"content":{"title":"café/漢字","body":"Body"}}"#
        let webCanonical = try await view.callAsyncJavaScript(
            "const sort = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(sort) : Object.fromEntries(Object.keys(v).sort().map(k => [k,sort(v[k])])) : v; return JSON.stringify(sort(JSON.parse(raw)));",
            arguments: ["raw": numeric], in: nil, contentWorld: .page)
        XCTAssertEqual(webCanonical as? String, String(decoding: try NativeStressLeafMove.canonicalDocument(Data(numeric.utf8)), as: UTF8.self))
        for change in ["d.content.fields=[]", "d.content.tags=[5]", "d.content.assets=[{id:'a',kind:'image',src:5}]", "d.presentation.theme={unknown:true}"] {
            let refused = try await view.evaluateJavaScript("(()=>{const f=window.assetInspectionFixture;f.reset();const d=f.raw();" + change + ";f.setRaw(d);try{window.texttextDocumentInspection.read(f.item);return false}catch{return true}})()")
            XCTAssertEqual(refused as? Bool, true, change)
        }
    }

}
#endif
