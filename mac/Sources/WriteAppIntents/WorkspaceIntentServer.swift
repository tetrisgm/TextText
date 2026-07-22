import Foundation

/// The server view of a workspace folder (id/name/path/mode), enough for the
/// App Intents to target the right folder and label a document.
public struct WorkspaceServerFolder: Equatable, Sendable {
    public var id: String
    public var name: String
    public var path: String
    public var mode: String

    public init(id: String, name: String, path: String, mode: String) {
        self.id = id
        self.name = name
        self.path = path
        self.mode = mode
    }
}

/// The server view of a document/post, keyed by the server post id (the same id
/// the `write-app://item/{id}` deep link and the File Provider item use).
public struct WorkspaceServerItem: Equatable, Sendable {
    public var id: String
    public var slug: String
    public var title: String
    public var kind: String
    public var status: String
    public var folderId: String?
    public var folderPath: String?
    public var canonicalURL: URL?
    public var hash: String?
    public var modifiedDate: Date?

    public init(
        id: String, slug: String, title: String, kind: String, status: String,
        folderId: String? = nil, folderPath: String? = nil,
        canonicalURL: URL? = nil, hash: String? = nil, modifiedDate: Date? = nil
    ) {
        self.id = id
        self.slug = slug
        self.title = title
        self.kind = kind
        self.status = status
        self.folderId = folderId
        self.folderPath = folderPath
        self.canonicalURL = canonicalURL
        self.hash = hash
        self.modifiedDate = modifiedDate
    }
}

/// Failures surfaced by the server transport to the App Intents layer.
public enum WorkspaceIntentServerError: Error, LocalizedError, Equatable {
    case notFound(String)
    case conflict
    case rejected(String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .notFound(let id): return "No Texttext document found for \(id)"
        case .conflict: return "The document changed on the server; try again"
        case .rejected(let message): return message
        case .transport(let message): return message
        }
    }
}

/// The workspace operations the App Intents need, expressed against the SERVER
/// (the source of truth), never the File Provider mount or the retired mirror.
/// The concrete implementation lives in the app target (it wraps the sync API
/// client + credentials) and is registered through `WorkspaceIntentServerRegistry`.
public protocol WorkspaceIntentServer {
    /// The workspace's folders (system + user subfolders).
    func folders() throws -> [WorkspaceServerFolder]
    /// The items filed under a folder (its manifest), carrying the folder id.
    func items(inFolder folderId: String) throws -> [WorkspaceServerItem]
    /// The current markdown of a post plus its version hash (for If-Match).
    func fileText(id: String) throws -> (text: String, hash: String)
    /// Create a post from full markdown in a folder; the server assigns id/slug.
    func createDocument(
        body: String, folderId: String?, idempotencyKey: String?
    ) throws -> WorkspaceServerItem
    /// Replace a post's markdown with If-Match (append/publish/unpublish ride this).
    func updateDocument(
        id: String, body: String, ifMatch: String
    ) throws -> WorkspaceServerItem
    /// Move a post to another folder with If-Match (no body re-send).
    func moveDocument(
        id: String, toFolder folderId: String, ifMatch: String?
    ) throws -> WorkspaceServerItem
    /// Create a workspace subfolder under a server folder path.
    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) throws -> WorkspaceServerFolder
}

/// Startup-registered factory that hands the App Intents a live, credentialed
/// server client. The app target sets `makeServer` in `main.swift` before the
/// run loop starts, so it is always in place before any intent runs in-process.
/// It returns nil when signed out, which the intents surface as "sign in first".
public enum WorkspaceIntentServerRegistry {
    public static var makeServer: () -> WorkspaceIntentServer? = { nil }
}
