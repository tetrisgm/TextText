import Foundation
import TextTextWorkspaceCore

extension LocalVaultDocumentStore {
    public struct ReplacementRecoveryEntry: Sendable {
        public let id: String
        public let path: String
        public let itemId: String
        public let currentHash: String
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

    func replacementRecoveryItemId(path: String) throws -> String? {
        for entry in try replacements.entries() {
            if try replacementVisible(entry).0.path == path { return entry.itemId }
        }
        return nil
    }

    public func replacementRecoveryList() throws -> [ReplacementRecoveryEntry] {
        var result: [ReplacementRecoveryEntry] = []
        for entry in try replacements.entries() {
            var resolved = false
            do {
                try replacements.assertReadable(itemId: entry.itemId)
                guard entry.resolution != nil else { continue }
                resolved = true
            } catch ReplacementRecoveryRegistry.Failure.unresolved { }
            let inspection = try replacements.inspect(entry)
            _ = try replacements.export(inspection)
            let (visible, _) = try replacementVisible(entry)
            let values = try inspection.recovery.directory.resourceValues(forKeys: [.creationDateKey])
            result.append(ReplacementRecoveryEntry(id: entry.operation.uuidString, path: visible.path, itemId: entry.itemId,
                currentHash: visible.hash, preparedHash: inspection.preparedHash, displacedHash: inspection.displacedHash,
                savedAt: ISO8601DateFormatter().string(from: values.creationDate ?? .distantPast), resolved: resolved))
        }
        return result
    }

    public func replacementRecoveryRead(id: String, version: String) throws -> (document: Document?, path: String, hash: String, data: Data, parseError: String?) {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }) else { throw Failure.invalidPath }
        let inspection = try replacements.inspect(entry)
        let (visible, current) = try replacementVisible(entry)
        let bytes: Data
        switch version {
        case "current": bytes = current
        case "prepared": bytes = inspection.prepared
        case "displaced": bytes = inspection.displaced
        default: throw Failure.invalidPath
        }
        let hash = TextTextStableDigest.sha256Hex(bytes)
        do {
            let document = try parseDocument(path: visible.path, bytes: bytes, preserveHistory: false)
            let identity = MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId
            guard identity != nil, version == "displaced" || identity == entry.itemId else { throw Failure.invalidPath }
            return (document, visible.path, hash, bytes, nil)
        } catch {
            guard version == "displaced" else { throw error }
            return (nil, visible.path, hash, bytes, "This retained file cannot be opened as a TextPack.")
        }
    }

    public func resolveReplacement(id: String, path: String, itemId: String, currentHash: String, preparedHash: String, displacedHash: String) throws {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }), entry.itemId == itemId else { throw Failure.invalidPath }
        let (visible, _) = try replacementVisible(entry)
        guard visible.path == path, visible.hash == currentHash else { throw Failure.changed }
        try replacements.resolve(operation: operation, visible: url(for: path), itemId: itemId,
            observed: .init(visibleHash: currentHash, preparedHash: preparedHash, displacedHash: displacedHash))
    }
}
