import Foundation

/// Sync cursors, upload outbox and live-edit journals belong to this Mac, not
/// to an iCloud/Dropbox/OneDrive-synchronized workspace folder.
public enum LocalVaultDeviceState {
    private static let lock = NSRecursiveLock()
    nonisolated(unsafe) private static var configuredBase: URL?

    public static func configure(base: URL) {
        lock.lock()
        configuredBase = base.standardizedFileURL.resolvingSymlinksInPath()
        lock.unlock()
    }

    public static func directory(root: URL) -> URL {
        lock.lock()
        let base = configuredBase
        lock.unlock()
        guard let base else { return root.standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent(".texttext") }
        return directory(root: root, base: base)
    }

    public static func directory(root: URL, base: URL) -> URL {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        let digest = TextTextStableDigest.sha256Hex(Data(canonical.path.utf8))
        return base.standardizedFileURL.resolvingSymlinksInPath()
            .appendingPathComponent("VaultDeviceState", isDirectory: true)
            .appendingPathComponent(digest, isDirectory: true)
    }

    /// A provider may hide a file while it is downloading or the account is
    /// unavailable. Absence in these folders is not evidence of a user delete.
    public static func isCloudManaged(root: URL) -> Bool {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        if (try? canonical.resourceValues(forKeys: [.isUbiquitousItemKey]).isUbiquitousItem) == true { return true }
        let parts = canonical.pathComponents
        return parts.contains("CloudStorage") || parts.contains("Mobile Documents")
    }

    private struct DeletionIntent: Codable {
        let itemId: String
        let path: String
        let hash: String
    }

    private static func deletionURL(root: URL, itemId: String) throws -> URL {
        guard itemId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil else {
            throw LocalVaultDocumentStore.Failure.invalidPath
        }
        let folder = directory(root: root).appendingPathComponent("deletions", isDirectory: true)
        let target = folder.appendingPathComponent(itemId + ".json")
        guard folder.resolvingSymlinksInPath().path == folder.path,
              target.resolvingSymlinksInPath().path == target.path else {
            throw LocalVaultDocumentStore.Failure.invalidPath
        }
        return target
    }

    /// Called only after TextText has moved the exact pack into its Trash.
    public static func recordDeletion(root: URL, itemId: String, path: String, hash: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let target = try deletionURL(root: root, itemId: itemId)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let intent = DeletionIntent(itemId: itemId, path: path, hash: hash)
        try JSONEncoder().encode(intent).write(to: target, options: .atomic)
    }

    public static func hasDeletion(root: URL, itemId: String, path: String, hash: String) throws -> Bool {
        let target = try deletionURL(root: root, itemId: itemId)
        guard FileManager.default.fileExists(atPath: target.path) else { return false }
        let intent = try JSONDecoder().decode(DeletionIntent.self, from: Data(contentsOf: target))
        return intent.itemId == itemId && intent.path == path && intent.hash == hash
    }

    public static func clearDeletion(root: URL, itemId: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let target = try deletionURL(root: root, itemId: itemId)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
    }

    /// A restored file cancels the intent only while it is still present.
    /// The lock also orders this check with a newer TextText Trash action.
    public static func clearDeletionIfRestored(root: URL, itemId: String, path: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let file = try LocalVaultDocumentStore(root: root).url(for: path)
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        let target = try deletionURL(root: root, itemId: itemId)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
    }

    public static func migrate(root: URL) throws {
        lock.lock()
        let base = configuredBase
        lock.unlock()
        if let base { try migrate(root: root, base: base) }
    }

    /// Copy legacy journals exactly once. Retain originals as recovery data;
    /// never merge divergent journals or import late-arriving cloud copies.
    public static func migrate(root: URL, base: URL) throws {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        let destination = directory(root: canonical, base: base)
        let manager = FileManager.default
        try manager.createDirectory(at: destination, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700])
        guard destination.resolvingSymlinksInPath().path == destination.path else {
            throw LocalVaultDocumentStore.Failure.invalidPath
        }
        for name in ["sync", "shared-editing"] {
            let marker = destination.appendingPathComponent(".legacy-\(name)-checked")
            guard marker.resolvingSymlinksInPath().path == marker.path else {
                throw LocalVaultDocumentStore.Failure.invalidPath
            }
            if manager.fileExists(atPath: marker.path) { continue }
            let legacy = canonical.appendingPathComponent(".texttext/\(name)", isDirectory: true)
            let target = destination.appendingPathComponent(name, isDirectory: true)
            guard legacy.resolvingSymlinksInPath().path == legacy.path,
                  target.resolvingSymlinksInPath().path == target.path else {
                throw LocalVaultDocumentStore.Failure.invalidPath
            }
            if manager.fileExists(atPath: legacy.path) {
                guard !manager.fileExists(atPath: target.path) else {
                    throw LocalVaultSyncFailure.changed
                }
                guard let enumerator = manager.enumerator(at: legacy, includingPropertiesForKeys: [.isSymbolicLinkKey]) else {
                    throw LocalVaultSyncFailure.changed
                }
                for case let file as URL in enumerator {
                    if try file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                        throw LocalVaultDocumentStore.Failure.invalidPath
                    }
                }
                try manager.copyItem(at: legacy, to: target)
            }
            try Data().write(to: marker, options: .atomic)
        }
    }
}
