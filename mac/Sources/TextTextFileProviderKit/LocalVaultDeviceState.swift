import Foundation

/// Sync cursors, upload outbox and live-edit journals belong to this Mac, not
/// to an iCloud/Dropbox/OneDrive-synchronized workspace folder.
public enum LocalVaultDeviceState {
    private static let lock = NSLock()
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
