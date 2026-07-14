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
    /// GET /api/sync/v1/files/{id}/artifacts. Only Write-hosted bookmark
    /// capture binaries are returned by this endpoint.
    func bookmarkArtifacts(postId: String) async
        -> Result<WriteBookmarkArtifactManifest, WriteSyncError>
    /// Download one URL returned by `bookmarkArtifacts`. Implementations must
    /// reject arbitrary remote URLs rather than turning File Provider into a
    /// general-purpose downloader.
    func artifactData(url: URL) async -> Result<WriteArtifactContent, WriteSyncError>
    /// GET /api/sync/v1/changes?cursor=&wait= . `cursor == nil` returns the
    /// current cursor immediately; a cursor with `wait > 0` long-polls.
    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError>

    // Write paths (Phase 3).
    /// POST /api/sync/v1/files[?folder=<id>]. A folder id files the new item
    /// directly into that folder (its mode dictates the kind). A stable
    /// `idempotencyKey` (sent as Idempotency-Key) makes a lost-response retry
    /// return the original item instead of creating a duplicate.
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async
        -> Result<WriteManifestItem, WriteSyncError>
    /// PUT /api/sync/v1/files/{id} with If-Match: a content edit.
    func putFile(postId: String, body: String, ifMatch hash: String) async
        -> Result<WriteManifestItem, WriteSyncError>
    /// PATCH /api/sync/v1/files/{id}: move (folderId), retitle (title), and/or
    /// reslug (slug) without re-sending the body. A Finder rename retitles (the
    /// filename is the post title, not the slug). `ifMatch`, when present, guards
    /// the change against a concurrent metadata edit (412 on mismatch).
    func patchFile(
        postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?
    ) async -> Result<WriteManifestItem, WriteSyncError>
    /// DELETE /api/sync/v1/files/{id}. `ifMatch`, when present, gives
    /// stale-delete protection (412 when the row moved on underneath us).
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, WriteSyncError>
    /// POST /api/sync/v1/folders: create a subfolder. A stable `idempotencyKey`
    /// makes a lost-response retry return the original folder.
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async
        -> Result<WriteWorkspaceFolder, WriteSyncError>
    /// PATCH /api/sync/v1/folders/{id}: rename a folder.
    func renameFolder(folderId: String, name: String) async
        -> Result<WriteWorkspaceFolder, WriteSyncError>
    /// PATCH /api/sync/v1/workspace: rename the workspace this token belongs to
    /// (its display name). Renaming the workspace folder in Finder maps here.
    func renameWorkspace(name: String) async
        -> Result<WriteWorkspaceBlog, WriteSyncError>
}

/// Defaults keep small test and bridge fakes source-compatible. Production and
/// sidecar-aware tests override both methods.
public extension WriteSyncAPI {
    func bookmarkArtifacts(postId: String) async
        -> Result<WriteBookmarkArtifactManifest, WriteSyncError> {
        .failure(.notFound)
    }

    func artifactData(url: URL) async -> Result<WriteArtifactContent, WriteSyncError> {
        .failure(.rejected("Artifact downloads are not supported"))
    }
}
