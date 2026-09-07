import Foundation
import zlib
import TextTextShareCore
import XCTest
import TextTextFileProviderKit
import TextTextQuickLookCore

final class TextPackPreviewTests: XCTestCase {
    func testTextPackPreviewShowsContentAndEscapesHTML() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "# Hello\n\n<script>alert(1)</script>", assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        let html = try QuickLookMarkdownPreview.html(forFile: pack)
        XCTAssertTrue(html.contains("Hello"))
        XCTAssertFalse(html.contains("<script>alert"))
        XCTAssertTrue(html.contains("CanvasText"))
        XCTAssertTrue(html.contains("color-scheme: light dark"))
    }
    func testPlainTextPreviewHasTheSameTextLimitAsPackages() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".md")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("# Plain preview".utf8).write(to: url)
        XCTAssertTrue(try QuickLookMarkdownPreview.html(forFile: url).contains("Plain preview"))
        try Data(repeating: 65, count: TextPackPreviewReader.maximumTextBytes).write(to: url)
        XCTAssertEqual(try TextPackPreviewReader.plainText(at: url).utf8.count, TextPackPreviewReader.maximumTextBytes)
        try Data(repeating: 65, count: TextPackPreviewReader.maximumTextBytes + 1).write(to: url)
        XCTAssertThrowsError(try QuickLookMarkdownPreview.html(forFile: url))
        try Data([0xff]).write(to: url)
        XCTAssertThrowsError(try QuickLookMarkdownPreview.html(forFile: url))
    }
    func testMalformedPackFails() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".textpack")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("not a zip".utf8).write(to: url)
        XCTAssertThrowsError(try QuickLookMarkdownPreview.html(forFile: url))
    }
}

extension TextPackPreviewTests {
    private func storedArchive(name: String = "text.md", body: Data = Data("# Preview".utf8), declaredSize: Int? = nil, checksum: UInt32? = nil) -> Data {
        // Minimal stored ZIP fixture, independent of the production ZIP reader.
        func little(_ value: UInt32, _ count: Int) -> Data {
            Data((0..<count).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) })
        }
        let nameData = Data(name.utf8)
        let crc = body.withUnsafeBytes { crc32(0, $0.bindMemory(to: Bytef.self).baseAddress, uInt($0.count)) }
        let sum = checksum ?? UInt32(crc)
        var local = Data()
        for (n, size): (UInt32, Int) in [(0x04034b50,4),(20,2),(0,2),(0,2),(0,2),(0,2),(sum,4),(UInt32(body.count),4),(UInt32(declaredSize ?? body.count),4),(UInt32(nameData.count),2),(0,2)] { local += little(n, size) }
        local += nameData; local += body
        var central = Data()
        for (n, size): (UInt32, Int) in [(0x02014b50,4),(20,2),(20,2),(0,2),(0,2),(0,2),(0,2),(sum,4),(UInt32(body.count),4),(UInt32(declaredSize ?? body.count),4),(UInt32(nameData.count),2),(0,2),(0,2),(0,2),(0,2),(0,4),(0,4)] { central += little(n, size) }
        central += nameData
        var end = Data()
        for (n, size): (UInt32, Int) in [(0x06054b50,4),(0,2),(0,2),(1,2),(1,2),(UInt32(central.count),4),(UInt32(local.count),4),(0,2)] { end += little(n, size) }
        return local + central + end
    }
    func testStoredArchivePreview() throws {
        XCTAssertEqual(try TextPackPreviewReader.markdown(in: storedArchive()), "# Preview")
    }
    func testEveryTruncationFailsWithoutCrashing() {
        let archive = storedArchive()
        for length in 0..<archive.count {
            XCTAssertThrowsError(try TextPackPreviewReader.markdown(in: Data(archive.prefix(length))))
        }
    }
    func testTraversalAndNonTextArchivesAreRejected() {
        for name in ["../text.md", "/text.md", "bundle.textbundle/../text.md", "image.png", "text\\.md"] {
            XCTAssertThrowsError(try TextPackPreviewReader.markdown(in: storedArchive(name: name)))
        }
    }
    func testChecksumAndDeclaredSizeAreValidated() {
        XCTAssertThrowsError(try TextPackPreviewReader.markdown(in: storedArchive(checksum: 123)))
        XCTAssertThrowsError(try TextPackPreviewReader.markdown(in: storedArchive(declaredSize: 1)))
        XCTAssertThrowsError(try TextPackPreviewReader.markdown(in: storedArchive(declaredSize: TextPackPreviewReader.maximumTextBytes + 1)))
    }
    func testNonUTF8IsRejected() {
        XCTAssertThrowsError(try TextPackPreviewReader.markdown(in: storedArchive(body: Data([0xff]))))
    }
}
