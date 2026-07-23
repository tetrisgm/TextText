import Foundation

// The wire shapes the Write platform's /api/sync/v1 routes emit, mirrored here
// so this kit is standalone (the native app's ServerClient has its own copies;
// they are intentionally kept in sync but not shared, because the File Provider
// extension links this kit, not the app executable).

/// The immutable native/on-disk form selected when a file is created. The
/// server still exchanges canonical UTF-8 Markdown bytes; this value controls
/// the filename, UTI, and local materialization contract File Provider exposes.
public enum WriteFileRepresentation: String, Codable, CaseIterable, Sendable {
    case textbundle
    case markdown
    case text
    /// A zipped textbundle: a SINGLE flat file (`<title>.textpack`). Unlike
    /// `.textbundle` (a directory whose name and body reconcile separately -> the
    /// rename phantom), a `.textpack` is one leaf file, so name and content move
    /// together and the phantom is structurally impossible, while it still bundles
    /// assets and imports into Bear/Ulysses. MUST materialize as a leaf zip, never
    /// a package (see WriteFileProviderItem.contentType).
    case textpack

    public var filenameExtension: String {
        switch self {
        case .textbundle: return "textbundle"
        case .markdown: return "md"
        case .text: return "txt"
        case .textpack: return "textpack"
        }
    }

    public var filenameSuffix: String { "." + filenameExtension }

    public var typeIdentifier: String {
        switch self {
        case .textbundle: return "org.textbundle.package"
        case .markdown: return "net.daringfireball.markdown"
        case .text: return "public.plain-text"
        case .textpack: return "org.textbundle.pack"
        }
    }

    /// A textbundle-family package (bundles a text.md + assets), whether the open
    /// directory form (`.textbundle`) or the zipped single-file form (`.textpack`).
    public var isTextBundleFamily: Bool { self == .textbundle || self == .textpack }

    /// Infer the representation of an external file without rewriting its
    /// extension. Manifest mapping never uses this: the wire value is explicit.
    public static func inferred(fromFilename filename: String) -> WriteFileRepresentation? {
        let lowercased = filename.lowercased()
        return allCases.first { lowercased.hasSuffix($0.filenameSuffix) }
    }
}

/// GET /api/sync/v1/workspace -> `blog`
public struct WriteWorkspaceBlog: Codable, Equatable, Sendable {
    public let handle: String
    public let name: String
    public let username: String?

    public init(handle: String, name: String, username: String?) {
        self.handle = handle
        self.name = name
        self.username = username
    }
}

/// A workspace folder. Blog/Notes/Bookmarks are the system folders; others are
/// user subfolders. `mode` is the folder's view mode (e.g. "blog", "notes").
public struct WriteWorkspaceFolder: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let mode: String
    public let parentId: String?

    public init(id: String, name: String, path: String, mode: String, parentId: String?) {
        self.id = id
        self.name = name
        self.path = path
        self.mode = mode
        self.parentId = parentId
    }
}

/// GET /api/sync/v1/workspace
public struct WriteWorkspace: Codable, Equatable, Sendable {
    public let blog: WriteWorkspaceBlog
    public let folders: [WriteWorkspaceFolder]

    public init(blog: WriteWorkspaceBlog, folders: [WriteWorkspaceFolder]) {
        self.blog = blog
        self.folders = folders
    }
}

/// One manifest entry (GET /api/sync/v1/folders/{id}/manifest), also the body
/// returned by PUT/POST /files. `hash` remains the legacy Markdown validator;
/// package-aware clients use `documentHash` so presentation-only edits advance
/// the projected file. `id` is the stable server identity.
public struct WriteManifestItem: Codable, Equatable, Sendable {
    public let file: String
    public let representation: WriteFileRepresentation
    public let kind: String
    public let slug: String
    public let title: String
    public let status: String
    public let hash: String
    public let documentHash: String?
    public let id: String?
    public let date: String?
    public let createdAt: String?
    public let updatedAt: String?
    /// The authoritative item URL supplied by the manifest. It may be absolute
    /// or origin-relative and is the authenticated content transport URL.
    public let url: String?
    /// The authoritative human-facing page URL. Finder actions must use this
    /// instead of exposing the authenticated content transport URL.
    public let canonicalUrl: String?
    /// UTF-8 byte length of the rendered file, when the server sends it. Used to
    /// set the File Provider item's documentSize at enumeration; optional so an
    /// older server (no `size`) still decodes.
    public let size: Int?
    public let documentSize: Int?

    public init(
        file: String, representation: WriteFileRepresentation = .markdown,
        kind: String, slug: String, title: String, status: String,
        hash: String, documentHash: String? = nil, id: String?, date: String?, createdAt: String?,
        updatedAt: String?, url: String?, canonicalUrl: String? = nil,
        size: Int? = nil, documentSize: Int? = nil
    ) {
        self.file = file
        self.representation = representation
        self.kind = kind
        self.slug = slug
        self.title = title
        self.status = status
        self.hash = hash
        self.documentHash = documentHash
        self.id = id
        self.date = date
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.url = url
        self.canonicalUrl = canonicalUrl
        self.size = size
        self.documentSize = documentSize
    }

    private enum CodingKeys: String, CodingKey {
        case file
        case representation
        case kind
        case slug
        case title
        case status
        case hash
        case documentHash
        case id
        case date
        case createdAt
        case updatedAt
        case url
        case canonicalUrl
        case size
        case documentSize
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            file: try values.decode(String.self, forKey: .file),
            // Manifests emitted before representations existed described .md
            // files. Preserve that meaning during a rolling server/client update.
            representation: try values.decodeIfPresent(
                WriteFileRepresentation.self, forKey: .representation) ?? .markdown,
            kind: try values.decode(String.self, forKey: .kind),
            slug: try values.decode(String.self, forKey: .slug),
            title: try values.decode(String.self, forKey: .title),
            status: try values.decode(String.self, forKey: .status),
            hash: try values.decode(String.self, forKey: .hash),
            documentHash: try values.decodeIfPresent(String.self, forKey: .documentHash),
            id: try values.decodeIfPresent(String.self, forKey: .id),
            date: try values.decodeIfPresent(String.self, forKey: .date),
            createdAt: try values.decodeIfPresent(String.self, forKey: .createdAt),
            updatedAt: try values.decodeIfPresent(String.self, forKey: .updatedAt),
            url: try values.decodeIfPresent(String.self, forKey: .url),
            canonicalUrl: try values.decodeIfPresent(
                String.self, forKey: .canonicalUrl),
            size: try values.decodeIfPresent(Int.self, forKey: .size),
            documentSize: try values.decodeIfPresent(Int.self, forKey: .documentSize))
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(file, forKey: .file)
        try values.encode(representation, forKey: .representation)
        try values.encode(kind, forKey: .kind)
        try values.encode(slug, forKey: .slug)
        try values.encode(title, forKey: .title)
        try values.encode(status, forKey: .status)
        try values.encode(hash, forKey: .hash)
        try values.encodeIfPresent(documentHash, forKey: .documentHash)
        try values.encodeIfPresent(id, forKey: .id)
        try values.encodeIfPresent(date, forKey: .date)
        try values.encodeIfPresent(createdAt, forKey: .createdAt)
        try values.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try values.encodeIfPresent(url, forKey: .url)
        try values.encodeIfPresent(canonicalUrl, forKey: .canonicalUrl)
        try values.encodeIfPresent(size, forKey: .size)
        try values.encodeIfPresent(documentSize, forKey: .documentSize)
    }

    public func contentHash(for representation: WriteFileRepresentation? = nil) -> String {
        let form = representation ?? self.representation
        return form.isTextBundleFamily ? documentHash ?? hash : hash
    }

    public func contentSize(for representation: WriteFileRepresentation? = nil) -> Int? {
        let form = representation ?? self.representation
        return form.isTextBundleFamily ? documentSize ?? size : size
    }
}

/// One immutable binary referenced by a Write document. The server assigns a
/// deterministic, portable filename; File Provider validates both the name and
/// the Write-owned URL before materializing it in a package or attachment tree.
public struct WriteArtifact: Codable, Equatable, Sendable {
    public let filename: String
    public let role: String
    public let url: String
    public let originalURL: String?
    public let contentType: String?

    public init(
        filename: String, role: String, url: String,
        originalURL: String? = nil, contentType: String? = nil
    ) {
        self.filename = filename
        self.role = role
        self.url = url
        self.originalURL = originalURL
        self.contentType = contentType
    }
}

/// GET /api/sync/v1/files/{id}/artifacts. `fileHash` ties this manifest to the
/// canonical Markdown revision so a local rewrite never combines two versions.
public struct WriteArtifactManifest: Codable, Equatable, Sendable {
    public let postId: String
    public let slug: String
    public let fileHash: String
    public let documentHash: String?
    public let artifacts: [WriteArtifact]

    public init(
        postId: String, slug: String, fileHash: String, documentHash: String? = nil,
        artifacts: [WriteArtifact]
    ) {
        self.postId = postId
        self.slug = slug
        self.fileHash = fileHash
        self.documentHash = documentHash
        self.artifacts = artifacts
    }

    public func contentHash(for representation: WriteFileRepresentation) -> String {
        representation.isTextBundleFamily ? documentHash ?? fileHash : fileHash
    }
}

public struct WriteArtifactContent: Equatable, Sendable {
    public let data: Data
    public let contentType: String?

    public init(data: Data, contentType: String? = nil) {
        self.data = data
        self.contentType = contentType
    }
}

/// GET /api/sync/v1/changes -> {cursor, changed}. The cursor is opaque; compare
/// only by inequality.
public struct WriteChangeReply: Codable, Equatable, Sendable {
    public let cursor: String
    public let changed: Bool

    public init(cursor: String, changed: Bool) {
        self.cursor = cursor
        self.changed = changed
    }
}
