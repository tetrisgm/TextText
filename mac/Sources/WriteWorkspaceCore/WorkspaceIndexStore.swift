import Foundation

public enum WorkspaceIndexStore {
    public struct IdentityFile: Equatable {
        public var itemId: String
        public var entry: IndexEntry

        public init(itemId: String, entry: IndexEntry) {
            self.itemId = itemId
            self.entry = entry
        }
    }

    public static func indexURL(root: URL) -> URL {
        root.appendingPathComponent(".write/index.json")
    }

    public static func load(root: URL) -> SyncIndex? {
        let url = indexURL(root: root)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(SyncIndex.self, from: data)
    }

    public static func save(_ index: SyncIndex, root: URL) throws {
        let url = indexURL(root: root)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try encoder.encode(index)
        if let existing = try? Data(contentsOf: url), existing == data { return }
        try data.write(to: url, options: .atomic)
    }

    public static func rebuild(
        root: URL,
        fileManager: FileManager = .default,
        preferredPaths: [String: String] = [:],
        includeSkippedDirectories: Bool = false,
        readData: ((URL) throws -> Data)? = nil,
        onUnreadable: ((URL, Error) -> Void)? = nil
    ) -> SyncIndex {
        var index = SyncIndex()
        for identityFile in identityFiles(
            root: root,
            fileManager: fileManager,
            includeSkippedDirectories: includeSkippedDirectories,
            readData: readData,
            onUnreadable: onUnreadable
        ) {
            if let existing = index.entries[identityFile.itemId] {
                let preferred = preferredPaths[identityFile.itemId]
                if existing.relativePath == preferred {
                    continue
                }
                if identityFile.entry.relativePath != preferred {
                    continue
                }
            }
            index.entries[identityFile.itemId] = identityFile.entry
        }
        return index
    }

    public static func identityFiles(
        root: URL,
        fileManager: FileManager = .default,
        includeSkippedDirectories: Bool = false,
        readData: ((URL) throws -> Data)? = nil,
        onUnreadable: ((URL, Error) -> Void)? = nil
    ) -> [IdentityFile] {
        WorkspaceLayout.markdownFiles(
            at: root,
            fileManager: fileManager,
            includeSkippedDirectories: includeSkippedDirectories,
            includeHiddenFiles: includeSkippedDirectories,
            // A directory that cannot be enumerated hides every file inside
            // it; report it as unreadable so delete decisions stand down.
            onEnumerationFailure: { url, error in onUnreadable?(url, error) }
        ).compactMap { url in
            guard let rel = WorkspaceLayout.relativePath(for: url, under: root) else {
                return nil
            }
            let data: Data
            do {
                if let readData {
                    data = try readData(url)
                } else {
                    data = try Data(contentsOf: url)
                }
            } catch {
                onUnreadable?(url, error)
                return nil
            }
            guard let text = String(data: data, encoding: .utf8),
                  let identity = MarkdownIdentityCodec.extract(from: text) else { return nil }
            return IdentityFile(
                itemId: identity.itemId,
                entry: IndexEntry(
                    hash: MarkdownIdentityCodec.syncHash(for: data),
                    relativePath: rel,
                    fileMtime: fileMtime(url),
                    folderId: identity.folderId,
                    kind: identity.kind
                )
            )
        }
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private static let decoder = JSONDecoder()

    private static func fileMtime(_ url: URL) -> Double? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970
    }
}
