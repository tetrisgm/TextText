import Foundation
import Darwin
import TextTextWorkspaceCore

extension LocalVaultDocumentStore {
    public struct ReplacementRecoveryEntry: Sendable {
        public let id: String
        public let path: String
        public let itemId: String
        public let currentHash: String?
        public let currentPresent: Bool
        public let kind: String
        public let preparedHash: String
        public let displacedHash: String
        public let savedAt: String
        public let resolved: Bool
    }
    private var replacements: ReplacementRecoveryRegistry { ReplacementRecoveryRegistry(root: root) }

    /// Explicit recovery inspection bypasses the normal-read fence and follows
    /// stable identity, never a filename winner among duplicate copies.
    private func replacementVisible(_ entry: ReplacementRecoveryRegistry.Entry) throws -> (Document, Data) {
        var found: (Document, Data)?
        let paths = try list()
        guard paths.count <= 20_000 else { throw Failure.tooLarge }
        for path in paths {
            let bytes: Data, document: Document
            do {
                bytes = try StableFileSnapshot.read(url(for: path))
                document = try parseDocument(path: path, bytes: bytes, preserveHistory: false)
            } catch { continue }
            guard MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId else { continue }
            guard found == nil else { throw Failure.duplicateIdentity }
            found = (document, bytes)
        }
        guard let found else { throw ReplacementRecoveryRegistry.Failure.unresolved(entry.operation) }
        return found
    }

    private func recoveryCurrent(_ entry: ReplacementRecoveryRegistry.Entry) throws -> (document: Document?, data: Data?, path: String) {
        if entry.kind != "removal" {
            let (document, bytes) = try replacementVisible(entry)
            return (document, bytes, document.path)
        }
        // The deletion pathname is authoritative, including a foreign or
        // malformed recreated file. Never substitute a matching identity found
        // elsewhere or follow a symlink to declare absence.
        let parts = entry.path.split(separator: "/")
        var location = root
        var missing = false
        for (index, part) in parts.enumerated() {
            location.appendPathComponent(String(part))
            if missing { continue }
            var info = stat()
            if lstat(location.path, &info) != 0 {
                guard errno == ENOENT else { throw Failure.invalidPath }
                missing = true; continue
            }
            guard info.st_mode & S_IFMT == (index == parts.count - 1 ? S_IFREG : S_IFDIR) else { throw Failure.invalidPath }
        }
        let paths = try list()
        guard paths.count < 20_000 else { throw Failure.tooLarge }
        for path in paths where path != entry.path {
            guard let bytes = try? StableFileSnapshot.read(url(for: path)),
                  let document = try? parseDocument(path: path, bytes: bytes, preserveHistory: false) else { continue }
            if MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId { throw Failure.duplicateIdentity }
        }
        if missing { return (nil, nil, entry.path) }
        let bytes = try StableFileSnapshot.read(location)
        let document = try? parseDocument(path: entry.path, bytes: bytes, preserveHistory: false)
        return (document, bytes, entry.path)
    }

    func replacementRecoveryItemId(path: String) throws -> String? {
        for entry in try replacements.entries() {
            if try recoveryCurrent(entry).path == path { return entry.itemId }
        }
        return nil
    }

    public func replacementRecoveryList() throws -> [ReplacementRecoveryEntry] {
        var result: [ReplacementRecoveryEntry] = []
        for entry in try replacements.entries() {
            var resolved = false
            do {
                let readable = try replacements.isReadableWithoutMutation(entry)
                if readable {
                    if entry.kind == "removal", try !replacements.removalHasCapturedInode(entry) { continue }
                    if entry.resolution != nil { resolved = true }
                    else if !(entry.kind == "removal" && entry.userDeletion == true && entry.deletionMarkerPublished != true && entry.deletionIntentCancelled != true) { continue }
                }
            } catch ReplacementRecoveryRegistry.Failure.unresolved { }
            let inspection = try replacements.inspect(entry, persistRelocation: false)
            let current = try recoveryCurrent(entry)
            let values = try inspection.recovery.directory.resourceValues(forKeys: [.creationDateKey])
            result.append(ReplacementRecoveryEntry(id: entry.operation.uuidString, path: current.path, itemId: entry.itemId,
                currentHash: current.data.map(TextTextStableDigest.sha256Hex), currentPresent: current.data != nil, kind: entry.kind ?? "replacement", preparedHash: inspection.preparedHash, displacedHash: inspection.displacedHash,
                savedAt: ISO8601DateFormatter().string(from: values.creationDate ?? .distantPast), resolved: resolved))
        }
        return result
    }

    public func replacementRecoveryRead(id: String, version: String) throws -> (document: Document?, path: String, hash: String?, data: Data?, parseError: String?, absent: Bool) {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }) else { throw Failure.invalidPath }
        let inspection = try replacements.inspect(entry)
        let current = try recoveryCurrent(entry)
        let bytes: Data
        switch version {
        case "current":
            guard let data = current.data else { return (nil, current.path, nil, nil, nil, true) }
            bytes = data
        case "prepared": bytes = inspection.prepared
        case "displaced": bytes = inspection.displaced
        default: throw Failure.invalidPath
        }
        let hash = TextTextStableDigest.sha256Hex(bytes)
        do {
            let document = try parseDocument(path: current.path, bytes: bytes, preserveHistory: false)
            let identity = MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId
            guard identity != nil, version == "displaced" || (entry.kind == "removal" && version == "current") || identity == entry.itemId else { throw Failure.invalidPath }
            return (document, current.path, hash, bytes, nil, false)
        } catch {
            guard version == "displaced" || (entry.kind == "removal" && version == "current") else { throw error }
            return (nil, current.path, hash, bytes, "This retained file cannot be opened as a TextPack.", false)
        }
    }

    public func resolveReplacement(id: String, path: String, itemId: String, currentHash: String?, preparedHash: String, displacedHash: String, kind: String = "replacement", currentPresent: Bool = true) throws {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }), entry.itemId == itemId else { throw Failure.invalidPath }
        let current = try recoveryCurrent(entry)
        guard (entry.kind ?? "replacement") == kind, current.path == path, (current.data != nil) == currentPresent, current.data.map(TextTextStableDigest.sha256Hex) == currentHash else { throw Failure.changed }
        try replacements.resolve(operation: operation, visible: root.appendingPathComponent(path), itemId: itemId,
            observed: .init(visibleHash: currentHash, preparedHash: preparedHash, displacedHash: displacedHash, currentPresent: currentPresent))
    }
}
