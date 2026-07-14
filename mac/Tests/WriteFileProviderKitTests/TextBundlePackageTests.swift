import Foundation
import XCTest
@testable import WriteFileProviderKit

final class TextBundlePackageTests: XCTestCase {
    func testMaterializeAndReadRoundTripKeepsOnePackageAndCanonicalURLs() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let remoteURL = "https://example.public.blob.vercel-storage.com/documents/demo/post/assets/photo.png"
        let package = try WriteTextBundlePackage.materialize(
            canonicalMarkdown: "# Hello\n\n![Photo](\(remoteURL))\n",
            assets: [.init(
                filename: "photo.png", data: Data([0x89, 0x50, 0x4e, 0x47]),
                remoteURL: remoteURL, contentType: "image/png")],
            sourceURL: "https://example.com/original",
            in: root)

        XCTAssertEqual(package.url.pathExtension, "textbundle")
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: package.url.appendingPathComponent("text.md").path))
        let localMarkdown = try String(
            contentsOf: package.url.appendingPathComponent("text.md"), encoding: .utf8)
        XCTAssertTrue(localMarkdown.contains("assets/photo.png"))
        XCTAssertFalse(localMarkdown.contains(remoteURL))

        let decoded = try WriteTextBundlePackage.read(from: package.url, in: root)
        XCTAssertEqual(decoded.markdown, "# Hello\n\n![Photo](\(remoteURL))\n")
        XCTAssertEqual(decoded.assets.map(\.filename), ["photo.png"])
        XCTAssertEqual(decoded.assets.first?.remoteURL, remoteURL)
        XCTAssertGreaterThan(decoded.logicalSize, 4)
    }

    func testReadRejectsUnsupportedInfo() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let package = root.appendingPathComponent("Bad.textbundle", isDirectory: true)
        try FileManager.default.createDirectory(
            at: package.appendingPathComponent("assets", isDirectory: true),
            withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: package.appendingPathComponent("text.md"))
        try Data("{\"version\":1,\"type\":\"text\"}".utf8)
            .write(to: package.appendingPathComponent("info.json"))
        defer { try? FileManager.default.removeItem(at: root) }

        XCTAssertThrowsError(try WriteTextBundlePackage.read(from: package, in: root))
    }

    func testAssetNamesCannotEscapePackage() {
        XCTAssertTrue(WriteTextBundlePackage.isSafeAssetFilename("image-001.webp"))
        XCTAssertFalse(WriteTextBundlePackage.isSafeAssetFilename("../secret"))
        XCTAssertFalse(WriteTextBundlePackage.isSafeAssetFilename("folder/image.png"))
        XCTAssertFalse(WriteTextBundlePackage.isSafeAssetFilename(".hidden"))
    }
}
