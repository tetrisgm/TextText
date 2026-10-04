import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class TextBundlePackageTests: XCTestCase {
    func testMaterializeAndReadRoundTripKeepsOnePackageAndCanonicalURLs() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let remoteURL = "https://example.public.blob.vercel-storage.com/documents/demo/post/assets/photo.png"
        let package = try TextTextTextBundlePackage.materialize(
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

        let decoded = try TextTextTextBundlePackage.read(from: package.url, in: root)
        XCTAssertEqual(decoded.markdown, "# Hello\n\n![Photo](\(remoteURL))\n")
        XCTAssertEqual(decoded.assets.map(\.filename), ["photo.png"])
        XCTAssertEqual(decoded.assets.first?.contentType, "image/png")
        XCTAssertEqual(decoded.assets.first?.remoteURL, remoteURL)
        XCTAssertGreaterThan(decoded.logicalSize, 4)
    }

    func testDocumentJSONAndAssetsRoundTripThroughTextPack() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let remoteURL = "https://example.public.blob.vercel-storage.com/documents/demo/post/assets/cover.png"
        let documentJSON = #"{"schema":1,"assets":[{"id":"cover","url":"\#(remoteURL)"}],"content":{"body":"Hello"}}"#
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Hello\n\n![Cover](\(remoteURL))\n",
            documentJSON: documentJSON,
            assets: [.init(
                filename: "cover.png", data: Data([1, 2, 3, 4]),
                remoteURL: remoteURL, contentType: "image/png")],
            sourceURL: nil, in: root)

        let localJSON = try String(
            contentsOf: package.url.appendingPathComponent("document.json"),
            encoding: .utf8)
        XCTAssertTrue(localJSON.contains("assets/cover.png"))
        XCTAssertFalse(localJSON.contains(remoteURL))

        let textpack = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: root)
        let decoded = try TextTextTextBundlePackage.read(from: textpack, in: root)
        let decodedObject = try JSONSerialization.jsonObject(
            with: Data(try XCTUnwrap(decoded.documentJSON).utf8))
        let sourceObject = try JSONSerialization.jsonObject(
            with: Data(documentJSON.utf8))
        XCTAssertEqual(decodedObject as? NSDictionary, sourceObject as? NSDictionary)
        XCTAssertEqual(decoded.markdown, "# Hello\n\n![Cover](\(remoteURL))\n")
    }

    func testReadInfersImageContentTypeForLegacyAssetsWithoutMappings() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Legacy gallery\n",
            assets: [
                .init(filename: "cover.JPG", data: Data([0xff, 0xd8, 0xff, 0xd9]), remoteURL: "assets/cover.JPG"),
                .init(filename: "diagram.svg", data: Data("<svg/>".utf8), remoteURL: "assets/diagram.svg"),
                .init(filename: "capture.HEIF", data: Data([1, 2, 3]), remoteURL: "assets/capture.HEIF"),
                .init(filename: "opaque.bin", data: Data([1, 2, 3]), remoteURL: "assets/opaque.bin"),
            ], sourceURL: nil, in: root)
        let infoURL = package.url.appendingPathComponent("info.json")
        let rawInfo = try JSONSerialization.jsonObject(with: Data(contentsOf: infoURL))
        var info = try XCTUnwrap(rawInfo as? [String: Any])
        info.removeValue(forKey: "net.texttext.assets")
        try JSONSerialization.data(withJSONObject: info).write(to: infoURL)

        let decoded = try TextTextTextBundlePackage.read(from: package.url, in: root)

        XCTAssertEqual(decoded.assets.first(where: { $0.filename == "cover.JPG" })?.contentType, "image/jpeg")
        XCTAssertEqual(decoded.assets.first(where: { $0.filename == "diagram.svg" })?.contentType, "image/svg+xml")
        XCTAssertEqual(decoded.assets.first(where: { $0.filename == "capture.HEIF" })?.contentType, "image/heic")
        XCTAssertNil(decoded.assets.first(where: { $0.filename == "opaque.bin" })?.contentType)
    }

    /// The point of the whole exercise: a textpack handed to someone else has
    /// to know how it is meant to read. document.json names a template id and
    /// a version, which means nothing outside the workspace that stores it.
    func testTemplateDefinitionRoundTripsThroughTextPack() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let templateJSON = #"{"id":"custom.recipe","version":2,"name":"Recipe","fields":[{"id":"cookTime","label":"Cook time","type":"number"}]}"#
        let sourceJSON = #"{"formatVersion":1,"compilerVersion":2,"blueprint":{"name":"Recipe"}}"#
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Dal\n",
            documentJSON: #"{"schema":1,"content":{"fields":{"cookTime":35}}}"#,
            templateJSON: templateJSON,
            templateAuthoringSourceJSON: sourceJSON,
            assets: [], sourceURL: nil, in: root)

        XCTAssertTrue(FileManager.default.fileExists(
            atPath: package.url.appendingPathComponent("template-source.json").path))

        let textpack = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: root)
        let decoded = try TextTextTextBundlePackage.read(from: textpack, in: root)

        let decodedObject = try JSONSerialization.jsonObject(
            with: Data(try XCTUnwrap(decoded.templateJSON).utf8))
        let sourceObject = try JSONSerialization.jsonObject(with: Data(templateJSON.utf8))
        XCTAssertEqual(decodedObject as? NSDictionary, sourceObject as? NSDictionary)
        let decodedSource = try JSONSerialization.jsonObject(
            with: Data(try XCTUnwrap(decoded.templateAuthoringSourceJSON).utf8))
        let originalSource = try JSONSerialization.jsonObject(with: Data(sourceJSON.utf8))
        XCTAssertEqual(decodedSource as? NSDictionary, originalSource as? NSDictionary)
        XCTAssertTrue(try XCTUnwrap(decoded.documentJSON).contains("cookTime"))
    }

    /// A bundle written before template.json existed still opens, and reports
    /// no look rather than failing to read.
    func testPackageWithoutTemplateStillReads() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# No look\n", assets: [], sourceURL: nil, in: root)
        try Data(#"{"blueprint":{"name":"Orphan"}}"#.utf8).write(
            to: package.url.appendingPathComponent("template-source.json"))

        let decoded = try TextTextTextBundlePackage.read(from: package.url, in: root)

        XCTAssertNil(decoded.templateJSON)
        XCTAssertNil(decoded.templateAuthoringSourceJSON)
        XCTAssertEqual(decoded.markdown, "# No look\n")
    }

    func testMalformedTemplateSourceKeepsDocumentAndValidTemplate() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Source\n", templateJSON: #"{"id":"custom.source"}"#,
            templateAuthoringSourceJSON: "[1, 2, 3]",
            assets: [], sourceURL: nil, in: root)

        let decoded = try TextTextTextBundlePackage.read(from: package.url, in: root)
        XCTAssertEqual(decoded.markdown, "# Source\n")
        XCTAssertNotNil(decoded.templateJSON)
        XCTAssertNil(decoded.templateAuthoringSourceJSON)

        try Data("{broken".utf8).write(
            to: package.url.appendingPathComponent("template-source.json"))
        let invalidJSON = try TextTextTextBundlePackage.read(from: package.url, in: root)
        XCTAssertEqual(invalidJSON.markdown, "# Source\n")
        XCTAssertNotNil(invalidJSON.templateJSON)
        XCTAssertNil(invalidJSON.templateAuthoringSourceJSON)

        try Data([0xff, 0xfe]).write(
            to: package.url.appendingPathComponent("template-source.json"))
        let invalidUTF8 = try TextTextTextBundlePackage.read(from: package.url, in: root)
        XCTAssertEqual(invalidUTF8.markdown, "# Source\n")
        XCTAssertNotNil(invalidUTF8.templateJSON)
        XCTAssertNil(invalidUTF8.templateAuthoringSourceJSON)
    }

    func testLegacyPackageWithoutDocumentJSONStillReads() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Legacy\n", assets: [], sourceURL: nil, in: root)

        let decoded = try TextTextTextBundlePackage.read(from: package.url, in: root)

        XCTAssertNil(decoded.documentJSON)
        XCTAssertEqual(decoded.markdown, "# Legacy\n")
    }

    func testTextPackZipsToASingleLeafFileAndReadsBack() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let remoteURL = "https://example.public.blob.vercel-storage.com/documents/demo/post/assets/p.png"
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Hi\n\n![P](\(remoteURL))\n",
            assets: [.init(
                filename: "p.png", data: Data([0x89, 0x50, 0x4e, 0x47]),
                remoteURL: remoteURL, contentType: "image/png")],
            sourceURL: nil, in: root)

        let textpack = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: root)
        // A .textpack is a SINGLE FILE (leaf), never a directory - that is what
        // keeps it phantom-free (name and content are one node).
        XCTAssertEqual(textpack.pathExtension, "textpack")
        let isDir = (try textpack.resourceValues(forKeys: [.isDirectoryKey])).isDirectory ?? true
        XCTAssertFalse(isDir)

        // read() auto-detects the zip, unzips it, and round-trips markdown + assets.
        let decoded = try TextTextTextBundlePackage.read(from: textpack, in: root)
        XCTAssertEqual(decoded.markdown, "# Hi\n\n![P](\(remoteURL))\n")
        XCTAssertEqual(decoded.assets.map(\.filename), ["p.png"])
        XCTAssertEqual(decoded.assets.first?.remoteURL, remoteURL)
    }

    func testReadCanonicalizesDotSlashAssetReferenceExactlyOnce() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let remoteURL = "https://example.public.blob.vercel-storage.com/documents/demo/post/assets/p.png"
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "![P](\(remoteURL))",
            assets: [.init(
                filename: "p.png", data: Data([1, 2, 3]),
                remoteURL: remoteURL, contentType: "image/png")],
            sourceURL: nil, in: root)
        let textURL = package.url.appendingPathComponent("text.md")
        try Data("![P](./assets/p.png)".utf8).write(to: textURL)

        let decoded = try TextTextTextBundlePackage.read(from: package.url, in: root)

        XCTAssertEqual(decoded.markdown, "![P](\(remoteURL))")
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

        XCTAssertThrowsError(try TextTextTextBundlePackage.read(from: package, in: root))
    }

    func testAssetNamesCannotEscapePackage() {
        XCTAssertTrue(TextTextTextBundlePackage.isSafeAssetFilename("image-001.webp"))
        XCTAssertFalse(TextTextTextBundlePackage.isSafeAssetFilename("../secret"))
        XCTAssertFalse(TextTextTextBundlePackage.isSafeAssetFilename("folder/image.png"))
        XCTAssertFalse(TextTextTextBundlePackage.isSafeAssetFilename(".hidden"))
    }
}
