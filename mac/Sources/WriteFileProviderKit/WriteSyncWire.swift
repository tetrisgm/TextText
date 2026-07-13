import Foundation

// The wire shapes the Write platform's /api/sync/v1 routes emit, mirrored here
// so this kit is standalone (the native app's ServerClient has its own copies;
// they are intentionally kept in sync but not shared, because the File Provider
// extension links this kit, not the app executable).

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
/// returned by PUT/POST /files. `file` is the markdown filename; `hash` is the
/// content hash used for If-Match. `id` is the server post id (the stable
/// identity the File Provider hangs an item off).
public struct WriteManifestItem: Codable, Equatable, Sendable {
    public let file: String
    public let kind: String
    public let slug: String
    public let title: String
    public let status: String
    public let hash: String
    public let id: String?
    public let date: String?
    public let createdAt: String?
    public let updatedAt: String?
    public let url: String?
    /// UTF-8 byte length of the rendered file, when the server sends it. Used to
    /// set the File Provider item's documentSize at enumeration; optional so an
    /// older server (no `size`) still decodes.
    public let size: Int?

    public init(
        file: String, kind: String, slug: String, title: String, status: String,
        hash: String, id: String?, date: String?, createdAt: String?,
        updatedAt: String?, url: String?, size: Int? = nil
    ) {
        self.file = file
        self.kind = kind
        self.slug = slug
        self.title = title
        self.status = status
        self.hash = hash
        self.id = id
        self.date = date
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.url = url
        self.size = size
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
