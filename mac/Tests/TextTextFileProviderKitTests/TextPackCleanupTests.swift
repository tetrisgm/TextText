import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class TextPackCleanupTests: XCTestCase {
    func testReadRemovesExtractedArchiveTree() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let readRoot = root.appendingPathComponent("reads", isDirectory: true)
        try FileManager.default.createDirectory(
            at: readRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "# Durable\n",
            assets: [], sourceURL: nil, in: root)
        let textpack = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: root)

        let contents = try TextTextTextBundlePackage.read(
            from: textpack, in: readRoot)

        XCTAssertEqual(contents.markdown, "# Durable\n")
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: readRoot.path),
            [])
    }
}
