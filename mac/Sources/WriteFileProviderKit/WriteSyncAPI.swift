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
    public let documentJSON: String?
    public let hash: String?
    public init(text: String, documentJSON: String? = nil, hash: String?) {
        self.text = text
        self.documentJSON = documentJSON
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
    /// Representation-aware read. TextBundle-family files include the complete
    /// validated document JSON alongside human-readable Markdown.
    func fileContent(
        postId: String, representation: WriteFileRepresentation
    ) async -> Result<WriteFileContent, WriteSyncError>
    /// GET /api/sync/v1/files/{id}/artifacts. Only immutable binaries referenced
    /// by this document are returned by this endpoint.
    func documentArtifacts(postId: String) async
        -> Result<WriteArtifactManifest, WriteSyncError>
    /// Download one URL returned by `documentArtifacts`. Implementations must
    /// reject arbitrary remote URLs rather than turning File Provider into a
    /// general-purpose downloader.
    func artifactData(url: URL) async -> Result<WriteArtifactContent, WriteSyncError>
    /// POST /api/sync/v1/files/{id}/assets. Upload one immutable package asset;
    /// the caller commits its returned URL in a later content PUT.
    func uploadAsset(
        postId: String, filename: String, data: Data, contentType: String?
    ) async -> Result<WriteArtifact, WriteSyncError>
    /// GET /api/sync/v1/changes?cursor=&wait= . `cursor == nil` returns the
    /// current cursor immediately; a cursor with `wait > 0` long-polls.
    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError>

    // Write paths (Phase 3).
    /// POST /api/sync/v1/files[?folder=<id>]. A folder id files the new item
    /// directly into that folder (its mode dictates the kind). A stable
    /// `idempotencyKey` (sent as Idempotency-Key) makes a lost-response retry
    /// return the original item instead of creating a duplicate.
    func createFile(
        body: String, folderId: String?, representation: WriteFileRepresentation,
        idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError>
    func createFile(
        body: String, documentJSON: String?, folderId: String?,
        representation: WriteFileRepresentation, idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError>
    /// Legacy create entry point retained while older extension/test clients
    /// roll forward. Its representation is always Markdown.
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async
        -> Result<WriteManifestItem, WriteSyncError>
    /// PUT /api/sync/v1/files/{id} with If-Match: a content edit.
    func putFile(postId: String, body: String, ifMatch hash: String) async
        -> Result<WriteManifestItem, WriteSyncError>
    func putFile(
        postId: String, body: String, documentJSON: String?, ifMatch hash: String
    ) async -> Result<WriteManifestItem, WriteSyncError>
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

/// Defaults keep older conformers and small test fakes source-compatible while
/// clients roll onto representation-aware creates and document packages.
public extension WriteSyncAPI {
    func fileContent(
        postId: String, representation: WriteFileRepresentation
    ) async -> Result<WriteFileContent, WriteSyncError> {
        await fileText(postId: postId)
    }

    /// Old conformers remain valid and treat representation-aware calls as the
    /// pre-contract Markdown create until they implement the new requirement.
    func createFile(
        body: String, folderId: String?, representation: WriteFileRepresentation,
        idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        await createFile(
            body: body, folderId: folderId, idempotencyKey: idempotencyKey)
    }

    /// Alternate label order for consumers that determine representation before
    /// resolving the destination folder.
    func createFile(
        body: String, representation: WriteFileRepresentation, folderId: String?,
        idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        await createFile(
            body: body, folderId: folderId, representation: representation,
            idempotencyKey: idempotencyKey)
    }

    func createFile(
        body: String, documentJSON: String?, folderId: String?,
        representation: WriteFileRepresentation, idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        await createFile(
            body: body, folderId: folderId, representation: representation,
            idempotencyKey: idempotencyKey)
    }

    func putFile(
        postId: String, body: String, documentJSON: String?, ifMatch hash: String
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        await putFile(postId: postId, body: body, ifMatch: hash)
    }

    func documentArtifacts(postId: String) async
        -> Result<WriteArtifactManifest, WriteSyncError> {
        .failure(.notFound)
    }

    func artifactData(url: URL) async -> Result<WriteArtifactContent, WriteSyncError> {
        .failure(.rejected("Artifact downloads are not supported"))
    }

    func uploadAsset(
        postId: String, filename: String, data: Data, contentType: String?
    ) async -> Result<WriteArtifact, WriteSyncError> {
        .failure(.rejected("Artifact uploads are not supported"))
    }

}
