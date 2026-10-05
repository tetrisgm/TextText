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

    func testPackSearchCacheTracksExternalChangesImportRenameDeleteAndFailure() async throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let root = temporary.appendingPathComponent("Vault", isDirectory: true)
        let sourceRoot = temporary.appendingPathComponent("Source", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }

        let store = DocumentStore(root: root)
        let workspace = CLIWorkspace.local(store)
        _ = try await workspace.create(title: "Flowers", body: "Orchids survive a winter.")
        let flowerURL = root.appendingPathComponent("Flowers.textpack")
        XCTAssertEqual(try DocumentStore(root: root).searchPage("Orchids").items.map(\.id), ["Flowers.textpack"])

        let sourceWorkspace = CLIWorkspace.local(DocumentStore(root: sourceRoot))
        _ = try await sourceWorkspace.create(title: "Roses", body: "Roses arrive in spring.")
        let sourceURL = sourceRoot.appendingPathComponent("Roses.textpack")
        let replacementBytes = try Data(contentsOf: sourceURL)
        try replacementBytes.write(to: flowerURL, options: .atomic)

        let updated = try DocumentStore(root: root).searchPage("Orchids")
        XCTAssertTrue(updated.items.isEmpty)
        XCTAssertEqual(updated.skippedCount, 0)
        let replacement = try DocumentStore(root: root).searchPage("Roses")
        XCTAssertEqual(replacement.items.map(\.id), ["Flowers.textpack"])
        XCTAssertEqual(replacement.items.first?.hash, TextTextStableDigest.sha256Hex(replacementBytes))

        _ = try LocalVaultDocumentStore(root: root).importFile(from: sourceURL, newPath: "Imports/Roses.textpack")
        XCTAssertEqual(try DocumentStore(root: root).searchPage("Roses").items.map(\.id), ["Flowers.textpack", "Imports/Roses.textpack"])

        let importedURL = root.appendingPathComponent("Imports/Roses.textpack")
        let renamedURL = root.appendingPathComponent("Imports/Renamed.textpack")
        try FileManager.default.moveItem(at: importedURL, to: renamedURL)
        XCTAssertEqual(try DocumentStore(root: root).searchPage("Roses").items.map(\.id), ["Flowers.textpack", "Imports/Renamed.textpack"])

        try FileManager.default.removeItem(at: renamedURL)
        XCTAssertEqual(try DocumentStore(root: root).searchPage("Roses").items.map(\.id), ["Flowers.textpack"])

        try Data("invalid archive".utf8).write(to: flowerURL, options: .atomic)
        let afterFailure = try DocumentStore(root: root).searchPage("Roses")
        XCTAssertTrue(afterFailure.items.isEmpty)
        XCTAssertEqual(afterFailure.skippedCount, 1)
    }

    func testPackSearchCacheBoundsCostAndEntryCountWithLRUEviction() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let probe = root.appendingPathComponent("probe")
        try Data("probe".utf8).write(to: probe)
        let fingerprint = try XCTUnwrap(LocalDocumentSearchCache.Fingerprint.read(from: probe))
        let first = LocalDocumentSearchCache.Key(root: root.path, path: "one.textpack")
        let second = LocalDocumentSearchCache.Key(root: root.path, path: "two.textpack")
        let third = LocalDocumentSearchCache.Key(root: root.path, path: "three.textpack")
        let value = LocalDocumentSearchCache.Content(markdown: "needle", hash: "hash")

        let costBounded = LocalDocumentSearchCache(maxEstimatedCost: 700, maximumEntries: 10)
        costBounded.insert(value, for: first, fingerprint: fingerprint)
        costBounded.insert(value, for: second, fingerprint: fingerprint)
        XCTAssertNil(costBounded.content(for: first, matching: fingerprint))
        XCTAssertNotNil(costBounded.content(for: second, matching: fingerprint))

        let countBounded = LocalDocumentSearchCache(maxEstimatedCost: 10_000, maximumEntries: 2)
        countBounded.insert(value, for: first, fingerprint: fingerprint)
        countBounded.insert(value, for: second, fingerprint: fingerprint)
        XCTAssertNotNil(countBounded.content(for: first, matching: fingerprint)) // Refresh first's LRU position.
        countBounded.insert(value, for: third, fingerprint: fingerprint)
        XCTAssertNotNil(countBounded.content(for: first, matching: fingerprint))
        XCTAssertNil(countBounded.content(for: second, matching: fingerprint))
        XCTAssertNotNil(countBounded.content(for: third, matching: fingerprint))
    }
}
