#if TEXTTEXT_STRESS_ACTOR
import Foundation
import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class NativeStressFolderCaseTests: XCTestCase {
    func testReadonlyProofTracksExactFolderSpellingAndPreservesArchiveIdentity() throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent("actor-folder-" + UUID().uuidString).resolvingSymlinksInPath()
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        let source = "Six-client acceptance folder " + UUID().uuidString.lowercased(), destination = source.lowercased(), title = "Six-client acceptance isolated actor", item = UUID().uuidString.lowercased()
        let original = root.appendingPathComponent(source)
        try fm.createDirectory(at: original.appendingPathComponent("Empty/Nested"), withIntermediateDirectories: true)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\nschema: \"texttext.markdown-file.v1\"\ntextTextId: \"\(item)\"\ntitle: \"\(title)\"\n---\n\nOriginal bytes.\n", documentJSON: nil, assets: [], sourceURL: nil, in: root)
        let pack = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: root)
        try fm.copyItem(at: pack, to: original.appendingPathComponent(title + ".textpack"))
        let operation = "fc-" + String(repeating: "a", count: 32)
        let scenario: [String: Any] = ["role": "mac-cli", "round": 1, "source": source, "destination": destination, "emptyDescendants": ["Empty", "Empty/Nested"]]
        func inspect(_ phase: String) throws -> (proof: [String: Any], pending: Bool) { try NativeStressFolderCase.observe(root: root, itemId: item, title: title, relativePath: source + "/" + title + ".textpack", request: ["operationId": operation, "phase": phase, "scenario": scenario]) }
        let before = try inspect("before")
        XCTAssertTrue(try inspect("after").pending)
        try fm.moveItem(at: original, to: root.appendingPathComponent(destination))
        let after = try inspect("after")
        XCTAssertFalse(after.pending)
        XCTAssertEqual(before.proof["folderIdentity"] as? String, after.proof["folderIdentity"] as? String)
        XCTAssertEqual(before.proof["archiveSha256"] as? String, after.proof["archiveSha256"] as? String)
        try Data("preserved unknown".utf8).write(to: root.appendingPathComponent(destination + "/unknown.bin"))
        XCTAssertThrowsError(try inspect("after"))
        XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent(destination + "/unknown.bin").path))
    }
    func testFutureOrUnownedRequestRefusesBeforeFilesystemAccess() {
        XCTAssertThrowsError(try NativeStressFolderCase.observe(root: URL(fileURLWithPath: "/does-not-exist"), itemId: "x", title: "x", relativePath: "x", request: ["version": 2]))
    }
}
#endif
