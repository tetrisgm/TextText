import Foundation

/// The change delta between a container's last-enumerated snapshot and its
/// current children: what to didUpdate and what to didDeleteItems, so an
/// ordinary edit no longer expires the sync anchor into a full re-list.
public struct WriteContainerDelta: Equatable, Sendable {
    public let updated: [WriteItem]
    public let deletedIdentifiers: [String]

    /// Diff a stored id->digest snapshot against the current children. An item
    /// is `updated` when its id is new or its digest changed (the framework
    /// treats an unknown updated item as a create); an id present before but
    /// absent now is a delete.
    public static func compute(
        previous: [String: String], current: [WriteItem]
    ) -> WriteContainerDelta {
        var updated: [WriteItem] = []
        var currentIds = Set<String>()
        currentIds.reserveCapacity(current.count)
        for item in current {
            let id = item.identifier.rawValue
            currentIds.insert(id)
            if previous[id] != WorkspaceEnumerator.itemDigest(item) {
                updated.append(item)
            }
        }
        let deleted = previous.keys.filter { !currentIds.contains($0) }.sorted()
        return WriteContainerDelta(updated: updated, deletedIdentifiers: deleted)
    }

    /// The id->digest snapshot for a child list, stored alongside the anchor it
    /// fingerprints.
    public static func snapshot(of items: [WriteItem]) -> [String: String] {
        var map: [String: String] = [:]
        map.reserveCapacity(items.count)
        for item in items {
            map[item.identifier.rawValue] = WorkspaceEnumerator.itemDigest(item)
        }
        return map
    }
}

/// Persists one id->digest snapshot per container, keyed by the 32-byte anchor
/// it corresponds to. This is what turns the anchor (a bare digest, too small
/// to carry the child set) into a usable delta base: enumerateChanges loads the
/// snapshot matching the system's anchor and diffs. Best-effort cache: a
/// missing or mismatched snapshot falls back to syncAnchorExpired (the old
/// full-reconcile behavior), so corruption can never produce a wrong delta.
public struct AnchorSnapshotStore: Sendable {
    private struct Stored: Codable {
        var anchor: Data
        var items: [String: String]
    }

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public func save(container: WriteItemIdentifier, anchor: Data, items: [WriteItem]) {
        let stored = Stored(
            anchor: anchor, items: WriteContainerDelta.snapshot(of: items))
        guard let data = try? JSONEncoder().encode(stored) else { return }
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true)
        try? data.write(to: fileURL(for: container), options: .atomic)
    }

    /// The stored snapshot ONLY when it matches the anchor the system holds;
    /// nil otherwise (extension restarted mid-cycle, corruption, first run).
    public func loadSnapshot(
        container: WriteItemIdentifier, matching anchor: Data
    ) -> [String: String]? {
        guard let data = try? Data(contentsOf: fileURL(for: container)),
              let stored = try? JSONDecoder().decode(Stored.self, from: data),
              stored.anchor == anchor else { return nil }
        return stored.items
    }

    private func fileURL(for container: WriteItemIdentifier) -> URL {
        // Container raw values contain ":"; a digest filename is filesystem-safe.
        directory.appendingPathComponent(
            WriteStableDigest.sha256Hex(container.rawValue) + ".json",
            isDirectory: false)
    }
}
