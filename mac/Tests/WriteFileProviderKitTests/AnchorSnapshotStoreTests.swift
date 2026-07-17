import Foundation
import XCTest
@testable import WriteFileProviderKit

final class AnchorSnapshotStoreTests: XCTestCase {
    private func item(
        id: String, title: String = "Title", hash: String = "h1"
    ) -> WriteItem {
        WriteItemMapper.item(
            for: WriteManifestItem(
                file: "\(title).textpack", representation: .textpack,
                kind: "article", slug: title.lowercased(), title: title,
                status: "draft", hash: hash, id: id, date: nil,
                createdAt: "2026-07-01T09:00:00Z", updatedAt: "2026-07-11T10:00:00Z",
                url: "https://write.example/item/\(id)"),
            inFolder: "blog", handle: "demo", readOnly: false)!
    }

    func testDeltaComputesUpdatedCreatedAndDeleted() {
        let unchanged = item(id: "a", title: "Same", hash: "h1")
        let before = [unchanged, item(id: "b", title: "Old", hash: "h1"), item(id: "gone", title: "Gone")]
        let after = [unchanged, item(id: "b", title: "Old", hash: "h2"), item(id: "new", title: "New")]

        let delta = WriteContainerDelta.compute(
            previous: WriteContainerDelta.snapshot(of: before), current: after)

        // b changed hash (update), new appeared (create -> update), gone left.
        XCTAssertEqual(
            Set(delta.updated.map(\.identifier.rawValue)),
            ["file:demo:b", "file:demo:new"])
        XCTAssertEqual(delta.deletedIdentifiers, ["file:demo:gone"])
    }

    func testDeltaIsEmptyWhenNothingChanged() {
        let items = [item(id: "a"), item(id: "b", title: "B")]
        let delta = WriteContainerDelta.compute(
            previous: WriteContainerDelta.snapshot(of: items), current: items)
        XCTAssertTrue(delta.updated.isEmpty)
        XCTAssertTrue(delta.deletedIdentifiers.isEmpty)
    }

    func testRenameIsAnUpdateNotADeleteCreate() {
        // Identity anchors on the post id; a retitle changes the digest only.
        let before = [item(id: "a", title: "Before")]
        let after = [item(id: "a", title: "After")]
        let delta = WriteContainerDelta.compute(
            previous: WriteContainerDelta.snapshot(of: before), current: after)
        XCTAssertEqual(delta.updated.map(\.identifier.rawValue), ["file:demo:a"])
        XCTAssertTrue(delta.deletedIdentifiers.isEmpty)
    }

    func testStoreRoundTripsOnlyForTheMatchingAnchor() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = AnchorSnapshotStore(directory: dir)
        let container = WriteItemIdentifier.folder(handle: "demo", id: "blog")
        let items = [item(id: "a"), item(id: "b", title: "B")]
        let anchor = WorkspaceEnumerator.fingerprint(items)

        store.save(container: container, anchor: anchor, items: items)

        XCTAssertEqual(
            store.loadSnapshot(container: container, matching: anchor),
            WriteContainerDelta.snapshot(of: items))
        // A different anchor must miss: diffing against the wrong base would
        // produce a wrong delta, and expiry is the safe fallback.
        XCTAssertNil(store.loadSnapshot(
            container: container, matching: Data([0x00, 0x01])))
        // Another container never reads this snapshot.
        XCTAssertNil(store.loadSnapshot(
            container: .folder(handle: "demo", id: "notes"), matching: anchor))
    }

    func testFingerprintUnchangedByCanonicalEncodingRefactor() {
        // The anchor format is held by the system across releases; pin a known
        // relationship: the set fingerprint equals the hash of concatenated
        // per-item canonical encodings in sorted order.
        let items = [item(id: "b", title: "B"), item(id: "a", title: "A")]
        let sorted = items.sorted { $0.identifier.rawValue < $1.identifier.rawValue }
        var canonical = Data()
        for i in sorted { canonical.append(WorkspaceEnumerator.canonicalEncoding(i)) }
        XCTAssertEqual(
            WorkspaceEnumerator.fingerprint(items),
            WriteStableDigest.sha256(canonical))
    }
}
