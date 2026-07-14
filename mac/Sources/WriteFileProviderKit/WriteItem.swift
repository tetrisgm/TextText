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
/// `contentHash` is the If-Match hash for files. `manifestURL` is the URL the
/// server supplied for the item; consumers must not reconstruct it from a slug.
/// `representation` is the immutable native form of a content file and is nil
/// for folders.
/// `documentSize` is nil until content is materialized (enumeration does not
/// fetch bodies).
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
    public let manifestURL: String?
    public let representation: WriteFileRepresentation?

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
        capabilities: WriteItemCapabilities,
        manifestURL: String? = nil,
        representation: WriteFileRepresentation? = nil
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
        self.manifestURL = manifestURL
        self.representation = representation
    }

    // Uniform type identifiers used without linking UniformTypeIdentifiers into
    // the pure kit. The bridge imports TextBundle as a package explicitly.
    public static let folderTypeIdentifier = "public.folder"
    public static let textBundleTypeIdentifier = WriteFileRepresentation.textbundle.typeIdentifier
    public static let markdownTypeIdentifier = WriteFileRepresentation.markdown.typeIdentifier
    public static let plainTextTypeIdentifier = WriteFileRepresentation.text.typeIdentifier

    /// A copy carrying a specific content hash, used when materialized bytes
    /// come from a GET whose ETag may differ from the enumeration-time manifest
    /// hash. The returned item's version must describe the bytes it accompanies.
    public func withContentHash(_ hash: String?) -> WriteItem {
        withContent(hash: hash, size: documentSize)
    }

    /// A copy describing content just fetched. Regular files set their exact size;
    /// package directories keep it nil because File Provider owns package transport.
    public func withContent(hash: String?, size: Int?) -> WriteItem {
        WriteItem(
            identifier: identifier, parentIdentifier: parentIdentifier,
            filename: filename, isFolder: isFolder, kind: kind,
            typeIdentifier: typeIdentifier, serverId: serverId,
            contentHash: hash ?? contentHash, documentSize: size ?? documentSize,
            creationDate: creationDate, contentModificationDate: contentModificationDate,
            capabilities: capabilities, manifestURL: manifestURL,
            representation: representation)
    }

    /// A copy with a different display filename, used by the enumerator's
    /// sibling-aware de-dup pass; identity (the identifier) is untouched.
    public func withFilename(_ newFilename: String) -> WriteItem {
        WriteItem(
            identifier: identifier, parentIdentifier: parentIdentifier,
            filename: newFilename, isFolder: isFolder, kind: kind,
            typeIdentifier: typeIdentifier, serverId: serverId,
            contentHash: contentHash, documentSize: documentSize,
            creationDate: creationDate, contentModificationDate: contentModificationDate,
            capabilities: capabilities, manifestURL: manifestURL,
            representation: representation)
    }

    /// A copy with the destination parent File Provider supplied for a move.
    public func withParentIdentifier(_ newParent: WriteItemIdentifier) -> WriteItem {
        WriteItem(
            identifier: identifier, parentIdentifier: newParent,
            filename: filename, isFolder: isFolder, kind: kind,
            typeIdentifier: typeIdentifier, serverId: serverId,
            contentHash: contentHash, documentSize: documentSize,
            creationDate: creationDate, contentModificationDate: contentModificationDate,
            capabilities: capabilities, manifestURL: manifestURL,
            representation: representation)
    }
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

    /// The synthetic container for one workspace, a child of the domain root.
    /// New items are never created at this level (they go inside the system
    /// folders), so it does NOT advertise adding sub-items. It DOES advertise
    /// renaming: renaming this folder in Finder renames the workspace (its
    /// display name), and, just as important, without `.renaming` the framework
    /// materializes the folder as immutable (the `uchg` flag, which Finder draws
    /// as a lock badge) — an odd, broken-looking wart on the one folder the user
    /// most expects to own. Deleting a workspace is not a Finder gesture, so
    /// `.deleting` stays off.
    public static func workspaceItem(handle: String, name: String, readOnly: Bool) -> WriteItem {
        let displayName = name.isEmpty ? handle : name
        return WriteItem(
            identifier: .workspace(handle),
            parentIdentifier: .rootContainer,
            filename: WriteFilename.encodeComponent(displayName),
            isFolder: true,
            kind: .folder,
            typeIdentifier: WriteItem.folderTypeIdentifier,
            serverId: nil,
            contentHash: nil,
            documentSize: nil,
            creationDate: nil,
            contentModificationDate: nil,
            capabilities: readOnly ? .readOnlyFolder : [.contentEnumerating, .renaming]
        )
    }

    /// A workspace folder becomes a container item. Top-level folders parent to
    /// their workspace container; subfolders parent to their folder. Every
    /// identifier is scoped by the workspace `handle`.
    public static func item(
        for folder: WriteWorkspaceFolder, handle: String, readOnly: Bool
    ) -> WriteItem {
        let parent: WriteItemIdentifier =
            folder.parentId.map { .folder(handle: handle, id: $0) } ?? .workspace(handle)
        // Writable folders can be renamed and gain items; folder delete and
        // folder move are deferred (their server semantics for contained posts
        // need care), so those bits are not advertised and Finder won't offer them.
        let caps: WriteItemCapabilities = readOnly
            ? .readOnlyFolder
            : [.contentEnumerating, .addingSubItems, .renaming]
        return WriteItem(
            identifier: .folder(handle: handle, id: folder.id),
            parentIdentifier: parent,
            filename: WriteFilename.encodeComponent(folder.name),
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

    /// A manifest entry becomes a file item parented to its folder, scoped by the
    /// workspace `handle`. Entries without a server id cannot be addressed and
    /// are skipped by the caller.
    public static func item(
        for entry: WriteManifestItem, inFolder folderId: String, handle: String, readOnly: Bool
    ) -> WriteItem? {
        guard let id = entry.id, !id.isEmpty else { return nil }
        let caps: WriteItemCapabilities = readOnly
            ? .readOnlyFile
            : [.reading, .writing, .renaming, .deleting, .reparenting]
        // Finder shows the post's TITLE, not its slug ("untitled-abc123" is the
        // URL identity, never a name a person should see). The identifier still
        // anchors on the stable post id, so the title is pure display metadata.
        return WriteItem(
            identifier: .file(handle: handle, id: id),
            parentIdentifier: .folder(handle: handle, id: folderId),
            filename: WriteFilename.filename(
                title: entry.title, slug: entry.slug,
                representation: entry.representation),
            isFolder: false,
            kind: WriteItemKind(kindString: entry.kind),
            typeIdentifier: entry.representation.typeIdentifier,
            serverId: id,
            contentHash: entry.hash,
            // A package has no single stable byte length: Finder and File Provider
            // choose the package transport encoding. The manifest size describes
            // canonical Markdown, not that transport, so advertising it corrupts
            // package reconciliation. Regular files retain their exact body size.
            documentSize: entry.representation == .textbundle ? nil : entry.size,
            creationDate: date(entry.createdAt) ?? date(entry.date),
            contentModificationDate: date(entry.updatedAt) ?? date(entry.createdAt),
            capabilities: caps,
            manifestURL: entry.url,
            representation: entry.representation
        )
    }

}
