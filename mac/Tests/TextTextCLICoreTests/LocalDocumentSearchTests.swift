import XCTest
import TextTextFileProviderKit
@testable import TextTextCLICore

final class LocalDocumentSearchTests: XCTestCase {
    func testSearchReportsLimitsAndSkipsMalformedPacksWithoutHistory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        try Data("broken zip".utf8).write(to: root.appendingPathComponent("Broken.textpack"))
        try Data("needle one".utf8).write(to: root.appendingPathComponent("One.md"))
        try Data("needle two".utf8).write(to: root.appendingPathComponent("Two.md"))
        let page = try store.searchPage("needle", limit: 1)
        XCTAssertEqual(page.items.count, 1)
        XCTAssertTrue(page.truncated)
        XCTAssertEqual(page.skippedCount, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".texttext").path))
        XCTAssertTrue(try store.searchPage("needle", byteLimit: 1).truncated)
        XCTAssertTrue(try store.searchPage("needle", scanLimit: 1).truncated)
        XCTAssertFalse(try store.searchPage(" ").truncated)
        XCTAssertTrue(try store.searchPage("needle", textpacksOnly: true).items.isEmpty)
    }

    func testPackSearchIsReadOnlyAndUsesExactRevisionHash() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let workspace = CLIWorkspace.local(store)
        _ = try await workspace.create(title: "Flowers", body: "Orchids in the garden.")
        let pack = root.appendingPathComponent("Flowers.textpack")
        let bytes = try Data(contentsOf: pack)
        let history = root.appendingPathComponent(".texttext/history")
        let before = (try? FileManager.default.contentsOfDirectory(atPath: history.path)) ?? []
        let page = try store.searchPage("ORCHIDS flowers")
        XCTAssertEqual(page.items.first?.hash, TextTextStableDigest.sha256Hex(bytes))
        XCTAssertEqual(page.items.first?.snippet, "Orchids in the garden.")
        XCTAssertEqual((try? FileManager.default.contentsOfDirectory(atPath: history.path)) ?? [], before)
        XCTAssertThrowsError(try LocalVaultDocumentStore(root: root).searchText(path: "Flowers.textpack", maximumTextBytes: 4))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("Alias.textpack"), withDestinationURL: pack)
        XCTAssertEqual(try store.searchPage("Orchids").items.count, 1)
        XCTAssertTrue(try store.searchPage("Orchids", folderPrefix: "Bookmarks/").items.isEmpty)
    }
}
