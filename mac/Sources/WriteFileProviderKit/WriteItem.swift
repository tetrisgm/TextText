import Foundation

/// The kind of a content item, from the server's `kind`. Article/project/talk
/// are Blog's public kinds; note and bookmark are unlisted forever (a server
/// invariant, not something the File Provider relaxes). Folders are their own
/// kind. Anything unrecognized is preserved verbatim rather than dropped.
public enum WriteItemKind: Equatable, Sendable {
    case folder
    case article
    case project
    case talk
    case note
    case bookmark
    case other(String)

    public init(kindString: String) {
        switch kindString {
        case "article": self = .article
        case "project": self = .project
        case "talk": self = .talk
        case "note": self = .note
        case "bookmark": self = .bookmark
        default: self = .other(kindString)
        }
    }
}

/// A framework-free mirror of `NSFileProviderItemCapabilities`. The extension
/// maps this onto the real option set; keeping it here lets the kit compute and
/// test capability policy without linking FileProvider.
public struct WriteItemCapabilities: OptionSet, Sendable, Equatable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let reading = WriteItemCapabilities(rawValue: 1 << 0)
    public static let writing = WriteItemCapabilities(rawValue: 1 << 1)
    public static let renaming = WriteItemCapabilities(rawValue: 1 << 2)
    public static let reparenting = WriteItemCapabilities(rawValue: 1 << 3)
    public static let deleting = WriteItemCapabilities(rawValue: 1 << 4)
    public static let addingSubItems = WriteItemCapabilities(rawValue: 1 << 5)
    public static let contentEnumerating = WriteItemCapabilities(rawValue: 1 << 6)

    /// Read-only leaf (Phase 2 shipping posture): can be read, nothing else.
    public static let readOnlyFile: WriteItemCapabilities = [.reading]
    /// Read-only container.
    public static let readOnlyFolder: WriteItemCapabilities = [.contentEnumerating]
}

/// One item in the workspace tree as the File Provider sees it: a folder or a
/// content file. `serverId` is the folder id or post id the sync API uses;
/// `contentHash` is the If-Match hash for files. `documentSize` is nil until
/// content is materialized (enumeration does not fetch bodies).
public struct WriteItem: Equatable, Sendable {
    public let identifier: WriteItemIdentifier
    public let parentIdentifier: WriteItemIdentifier
    public let filename: String
    public let isFolder: Bool
    public let kind: WriteItemKind
    public let typeIdentifier: String
    public let serverId: String?
    public let contentHash: String?
    public let documentSize: Int?
    public let creationDate: Date?
    public let contentModificationDate: Date?
    public let capabilities: WriteItemCapabilities

    public init(
        identifier: WriteItemIdentifier,
        parentIdentifier: WriteItemIdentifier,
        filename: String,
        isFolder: Bool,
        kind: WriteItemKind,
        typeIdentifier: String,
        serverId: String?,
        contentHash: String?,
        documentSize: Int?,
        creationDate: Date?,
        contentModificationDate: Date?,
        capabilities: WriteItemCapabilities
    ) {
        self.identifier = identifier
        self.parentIdentifier = parentIdentifier
        self.filename = filename
        self.isFolder = isFolder
        self.kind = kind
        self.typeIdentifier = typeIdentifier
        self.serverId = serverId
        self.contentHash = contentHash
        self.documentSize = documentSize
        self.creationDate = creationDate
        self.contentModificationDate = contentModificationDate
        self.capabilities = capabilities
    }

    // Uniform type identifiers. Every content item round-trips as a markdown
    // file, so markdown is correct for notes and bookmarks too.
    public static let folderTypeIdentifier = "public.folder"
    public static let markdownTypeIdentifier = "net.daringfireball.markdown"
}

// MARK: Mapping from wire types

public enum WriteItemMapper {
    private static let iso = ISO8601DateFormatter()

    static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let d = iso.date(from: raw) { return d }
        // The server also emits fractional-second timestamps; try that too.
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: raw)
    }

    /// A workspace folder becomes a container item. Top-level folders parent to
    /// the root; subfolders parent to their folder.
    public static func item(for folder: WriteWorkspaceFolder, readOnly: Bool) -> WriteItem {
        let parent: WriteItemIdentifier =
            folder.parentId.map { .folder($0) } ?? .rootContainer
        let caps: WriteItemCapabilities = readOnly
            ? .readOnlyFolder
            : [.contentEnumerating, .addingSubItems, .renaming, .deleting, .reparenting]
        return WriteItem(
            identifier: .folder(folder.id),
            parentIdentifier: parent,
            filename: folder.name,
            isFolder: true,
            kind: .folder,
            typeIdentifier: WriteItem.folderTypeIdentifier,
            serverId: folder.id,
            contentHash: nil,
            documentSize: nil,
            creationDate: nil,
            contentModificationDate: nil,
            capabilities: caps
        )
    }

    /// A manifest entry becomes a file item parented to its folder. Entries
    /// without a server id cannot be addressed and are skipped by the caller.
    public static func item(
        for entry: WriteManifestItem, inFolder folderId: String, readOnly: Bool
    ) -> WriteItem? {
        guard let id = entry.id, !id.isEmpty else { return nil }
        let caps: WriteItemCapabilities = readOnly
            ? .readOnlyFile
            : [.reading, .writing, .renaming, .deleting, .reparenting]
        return WriteItem(
            identifier: .file(id),
            parentIdentifier: .folder(folderId),
            filename: entry.file,
            isFolder: false,
            kind: WriteItemKind(kindString: entry.kind),
            typeIdentifier: WriteItem.markdownTypeIdentifier,
            serverId: id,
            contentHash: entry.hash,
            documentSize: nil,
            creationDate: date(entry.createdAt) ?? date(entry.date),
            contentModificationDate: date(entry.updatedAt) ?? date(entry.createdAt),
            capabilities: caps
        )
    }
}
