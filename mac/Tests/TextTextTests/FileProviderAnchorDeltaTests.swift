import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class FileProviderAnchorDeltaTests: XCTestCase {
    private func item(id: String, hash: String) throws -> TextTextItem {
        try XCTUnwrap(TextTextItemMapper.item(
            for: TextTextManifestItem(
                file: id + ".md",
                kind: "note",
                slug: id,
                title: id,
                status: "draft",
                hash: hash,
                id: id,
                date: nil,
                createdAt: nil,
                updatedAt: nil,
                url: nil,
                size: 10),
            inFolder: "notes", handle: "demo", readOnly: false))
    }

    func testStoredAnchorProducesOnlyPreciseUpdateAndDeleteDelta() throws {
        let unchanged = try item(id: "unchanged", hash: "same")
        let changedBefore = try item(id: "changed", hash: "before")
        let changedAfter = try item(id: "changed", hash: "after")
        let removed = try item(id: "removed", hash: "gone")
        let before = [unchanged, changedBefore, removed]
        let after = [unchanged, changedAfter]
        let container = TextTextItemIdentifier.folder(handle: "demo", id: "notes")
        let anchor = WorkspaceEnumerator.fingerprint(before)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = AnchorSnapshotStore(directory: directory)

        store.save(container: container, anchor: anchor, items: before)
        let stored = try XCTUnwrap(store.loadSnapshot(
            container: container, matching: anchor))
        let delta = TextTextContainerDelta.compute(previous: stored, current: after)

        XCTAssertEqual(
            delta.updated.map(\.identifier.rawValue),
            ["file:demo:changed"],
            "An unchanged child must not produce File Provider churn")
        XCTAssertEqual(delta.deletedIdentifiers, ["file:demo:removed"])
    }
}
