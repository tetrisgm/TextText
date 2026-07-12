import Foundation

/// Why a sync call failed. `conflict` (412) and `rejected` (400) are expected,
/// recoverable outcomes for writes, not transport errors.
public enum WriteSyncError: Error, Equatable, Sendable {
    case network(String)
    case http(Int, String)
    case decode(String)
    /// The addressed item no longer exists (404). Callers treat deletes as done.
    case notFound
    /// PUT If-Match failed: the item changed underneath us (412).
    case conflict
    /// The server refused the bytes (400); retrying the same bytes is futile.
    case rejected(String)
}

/// The content of a materialized file plus the hash to base the next edit on.
public struct WriteFileContent: Equatable, Sendable {
    public let text: String
    public let hash: String?
    public init(text: String, hash: String?) {
        self.text = text
        self.hash = hash
    }
}

/// The subset of /api/sync/v1 the File Provider needs, as an async protocol so
/// the extension can drive it and tests can substitute a fake. Phase 1 uses
/// only the read paths (workspace, manifest, fileText, changes); the write
/// paths are declared now so Phase 3 has the seam ready.
public protocol WriteSyncAPI: Sendable {
    /// GET /api/sync/v1/workspace
    func workspace() async -> Result<WriteWorkspace, WriteSyncError>
    /// GET /api/sync/v1/folders/{id}/manifest
    func manifest(folderId: String) async -> Result<[WriteManifestItem], WriteSyncError>
    /// GET /api/sync/v1/files/{id}
    func fileText(postId: String) async -> Result<WriteFileContent, WriteSyncError>
    /// GET /api/sync/v1/changes?cursor=&wait= . `cursor == nil` returns the
    /// current cursor immediately; a cursor with `wait > 0` long-polls.
    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError>

    // Write paths (wired in Phase 3).
    func createFile(body: String) async -> Result<WriteManifestItem, WriteSyncError>
    func putFile(postId: String, body: String, ifMatch hash: String) async
        -> Result<WriteManifestItem, WriteSyncError>
    func deleteFile(postId: String) async -> Result<Void, WriteSyncError>
    func createFolder(parentPath: String, name: String) async
        -> Result<WriteWorkspaceFolder, WriteSyncError>
}
