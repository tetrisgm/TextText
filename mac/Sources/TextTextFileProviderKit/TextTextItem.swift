import Foundation

/// The kind of a content item, from the server's `kind`. Article/project/talk
/// are Blog's public kinds; note and bookmark are unlisted forever (a server
/// invariant, not something the File Provider relaxes). Folders are their own
/// kind. Anything unrecognized is preserved verbatim rather than dropped.
public enum TextTextItemKind: Equatable, Sendable {
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
public struct TextTextItemCapabilities: OptionSet, Sendable, Equatable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let reading = TextTextItemCapabilities(rawValue: 1 << 0)
    public static let writing = TextTextItemCapabilities(rawValue: 1 << 1)
    public static let renaming = TextTextItemCapabilities(rawValue: 1 << 2)
    public static let reparenting = TextTextItemCapabilities(rawValue: 1 << 3)
    public static let deleting = TextTextItemCapabilities(rawValue: 1 << 4)
    public static let addingSubItems = TextTextItemCapabilities(rawValue: 1 << 5)
    public static let contentEnumerating = TextTextItemCapabilities(rawValue: 1 << 6)

    /// Read-only leaf (Phase 2 shipping posture): can be read, nothing else.
    public static let readOnlyFile: TextTextItemCapabilities = [.reading]
    /// Read-only container.
    public static let readOnlyFolder: TextTextItemCapabilities = [.contentEnumerating]
}

/// One item in the workspace tree as the File Provider sees it: a folder or a
/// content file. `serverId` is the folder id or post id the sync API uses;
/// `contentHash` is the If-Match hash for files. `manifestURL` is the URL the
/// server supplied for the item; consumers must not reconstruct it from a slug.
/// `representation` is the immutable native form of a content file and is nil
/// for folders.
/// `documentSize` is nil until content is materialized (enumeration does not
/// fetch bodies).
public struct TextTextItem: Equatable, Sendable {
    public let identifier: TextTextItemIdentifier
    public let parentIdentifier: TextTextItemIdentifier
    public let filename: String
    public let isFolder: Bool
    public let kind: TextTextItemKind
    public let typeIdentifier: String
    public let serverId: String?
    public let contentHash: String?
    public let documentSize: Int?
    public let creationDate: Date?
    public let contentModificationDate: Date?
    public let capabilities: TextTextItemCapabilities
    public let manifestURL: String?
    public let representation: TextTextFileRepresentation?

    public init(
        identifier: TextTextItemIdentifier,
        parentIdentifier: TextTextItemIdentifier,
        filename: String,
        isFolder: Bool,
        kind: TextTextItemKind,
        typeIdentifier: String,
        serverId: String?,
        contentHash: String?,
        documentSize: Int?,
        creationDate: Date?,
        contentModificationDate: Date?,
        capabilities: TextTextItemCapabilities,
        manifestURL: String? = nil,
        representation: TextTextFileRepresentation? = nil
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
    public static let textBundleTypeIdentifier = TextTextFileRepresentation.textbundle.typeIdentifier
    public static let textPackTypeIdentifier = TextTextFileRepresentation.textpack.typeIdentifier
    public static let markdownTypeIdentifier = TextTextFileRepresentation.markdown.typeIdentifier
    public static let plainTextTypeIdentifier = TextTextFileRepresentation.text.typeIdentifier

    /// A copy carrying a specific content hash, used when materialized bytes
    /// come from a GET whose ETag may differ from the enumeration-time manifest
    /// hash. The returned item's version must describe the bytes it accompanies.
    public func withContentHash(_ hash: String?) -> TextTextItem {
        withContent(hash: hash, size: documentSize)
    }

    /// A copy describing content just fetched. Regular files set their exact size;
    /// package directories keep it nil because File Provider owns package transport.
    public func withContent(hash: String?, size: Int?) -> TextTextItem {
        TextTextItem(
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
    public func withFilename(_ newFilename: String) -> TextTextItem {
        TextTextItem(
            identifier: identifier, parentIdentifier: parentIdentifier,
            filename: newFilename, isFolder: isFolder, kind: kind,
            typeIdentifier: typeIdentifier, serverId: serverId,
            contentHash: contentHash, documentSize: documentSize,
            creationDate: creationDate, contentModificationDate: contentModificationDate,
            capabilities: capabilities, manifestURL: manifestURL,
            representation: representation)
    }

    /// A copy with the destination parent File Provider supplied for a move.
    public func withParentIdentifier(_ newParent: TextTextItemIdentifier) -> TextTextItem {
        TextTextItem(
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

public enum TextTextItemMapper {
    private static let iso = ISO8601DateFormatter()
    private static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func date(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        if let d = iso.date(from: raw) { return d }
        // The server also emits fractional-second timestamps; try that too.
        return fractionalISO.date(from: raw)
    }

    /// The synthetic container for one workspace, a child of the domain root.
    /// New items are never created at this level (they go inside the system
    /// folders), so it does NOT advertise adding sub-items. It DOES advertise
    /// renaming: renaming this folder in Finder renames the workspace (its
    /// display name), and, just as important, without `.renaming` the framework
    /// materializes the folder as immutable (the `uchg` flag, which Finder draws
    /// as a lock badge) - an odd, broken-looking wart on the one folder the user
    /// most expects to own. Deleting a workspace is not a Finder gesture, so
    /// `.deleting` stays off.
    public static func workspaceItem(handle: String, name: String, readOnly: Bool) -> TextTextItem {
        let displayName = name.isEmpty ? handle : name
        return TextTextItem(
            identifier: .workspace(handle),
            parentIdentifier: .rootContainer,
            filename: TextTextFilename.encodeComponent(displayName),
            isFolder: true,
            kind: .folder,
            typeIdentifier: TextTextItem.folderTypeIdentifier,
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
        for folder: TextTextWorkspaceFolder, handle: String, readOnly: Bool
    ) -> TextTextItem {
        let parent: TextTextItemIdentifier =
            folder.parentId.map { .folder(handle: handle, id: $0) } ?? .workspace(handle)
        // Writable folders can be renamed and gain items; folder delete and
        // folder move are deferred (their server semantics for contained posts
        // need care), so those bits are not advertised and Finder won't offer them.
        let caps: TextTextItemCapabilities = readOnly
            ? .readOnlyFolder
            : [.contentEnumerating, .addingSubItems, .renaming]
        return TextTextItem(
            identifier: .folder(handle: handle, id: folder.id),
            parentIdentifier: parent,
            filename: TextTextFilename.encodeComponent(folder.name),
            isFolder: true,
            kind: .folder,
            typeIdentifier: TextTextItem.folderTypeIdentifier,
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
        for entry: TextTextManifestItem, inFolder folderId: String, handle: String, readOnly: Bool
    ) -> TextTextItem? {
        guard let id = entry.id, !id.isEmpty else { return nil }
        // Finder's delete callback still targets the permanent-delete endpoint.
        // Do not advertise deletion until that callback moves items to Trash.
        let caps: TextTextItemCapabilities = readOnly
            ? .readOnlyFile
            : [.reading, .writing, .renaming, .reparenting]
        // Finder shows the post's TITLE, not its slug ("untitled-abc123" is the
        // URL identity, never a name a person should see). The identifier still
        // anchors on the stable post id, so the title is pure display metadata.
        return TextTextItem(
            identifier: .file(handle: handle, id: id),
            parentIdentifier: .folder(handle: handle, id: folderId),
            filename: TextTextFilename.filename(
                title: entry.title, slug: entry.slug,
                representation: entry.representation),
            isFolder: false,
            kind: TextTextItemKind(kindString: entry.kind),
            typeIdentifier: entry.representation.typeIdentifier,
            serverId: id,
            contentHash: entry.contentHash(),
            // Only the `.textbundle` DIRECTORY keeps documentSize nil: the
            // framework transports a package and owns its size. A `.textpack` is a
            // single leaf file and MUST advertise a size like every other leaf -
            // a leaf enumerated with nil size reads to the framework as
            // materialized-empty, so a read-triggered fetch is delivered but never
            // persisted (the file stays 0 bytes). The manifest size (canonical
            // Markdown length) is only a pre-download hint; documentSize is
            // informational and never truncates the fetched bytes, so fetch still
            // sets the exact zip size. Regular files retain their exact body size.
            documentSize: entry.representation == .textbundle
                ? nil
                : entry.contentSize(),
            creationDate: date(entry.createdAt) ?? date(entry.date),
            contentModificationDate: date(entry.updatedAt) ?? date(entry.createdAt),
            capabilities: caps,
            manifestURL: publicManifestURL(for: entry),
            representation: entry.representation
        )
    }

    /// Before `canonicalUrl` existed, some manifests placed a public page URL
    /// in `url`. Keep those clients working while refusing the authenticated
    /// sync transport endpoint that caused Finder to copy a private API URL.
    private static func publicManifestURL(for entry: TextTextManifestItem) -> String? {
        if let canonical = entry.canonicalUrl, !canonical.isEmpty {
            return canonical
        }
        guard let legacy = entry.url, !legacy.isEmpty else { return nil }
        let path = URLComponents(string: legacy)?.percentEncodedPath ?? legacy
        guard !path.hasPrefix("/api/sync/") else { return nil }
        return legacy
    }

}
