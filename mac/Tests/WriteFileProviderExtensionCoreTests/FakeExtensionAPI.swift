import Foundation
@testable import WriteFileProviderKit

/// A writable in-memory `WriteSyncAPI` for the extension tests: it records the
/// write calls so tests can assert the extension mapped a Finder mutation onto
/// the right server call, and can be told to fail.
final class FakeExtensionAPI: WriteSyncAPI, @unchecked Sendable {
    var workspaceValue: WriteWorkspace
    var manifests: [String: [WriteManifestItem]]
    var cursor: String
    var failManifest: WriteSyncError?

    // Recorded write calls.
    struct CreateFileCall: Equatable { let body: String; let folderId: String?; let idempotencyKey: String? }
    struct PatchCall: Equatable { let postId: String; let folderId: String?; let slug: String?; let ifMatch: String? }
    struct PutCall: Equatable { let postId: String; let body: String; let hash: String }
    struct CreateFolderCall: Equatable { let parentPath: String; let name: String; let idempotencyKey: String? }
    struct RenameFolderCall: Equatable { let folderId: String; let name: String }
    private(set) var createFileCalls: [CreateFileCall] = []
    private(set) var patchCalls: [PatchCall] = []
    private(set) var putCalls: [PutCall] = []
    private(set) var deleteCalls: [String] = []
    private(set) var deleteIfMatchCalls: [String?] = []
    private(set) var createFolderCalls: [CreateFolderCall] = []
    private(set) var renameFolderCalls: [RenameFolderCall] = []

    // What the write calls return.
    var createFileResult: Result<WriteManifestItem, WriteSyncError>?
    var patchResult: Result<WriteManifestItem, WriteSyncError>?
    var putResult: Result<WriteManifestItem, WriteSyncError> = .failure(.conflict)
    var deleteResult: Result<Void, WriteSyncError> = .success(())
    var createFolderResult: Result<WriteWorkspaceFolder, WriteSyncError>?
    var renameFolderResult: Result<WriteWorkspaceFolder, WriteSyncError>?

    init(workspace: WriteWorkspace, manifests: [String: [WriteManifestItem]] = [:], cursor: String = "c0") {
        self.workspaceValue = workspace
        self.manifests = manifests
        self.cursor = cursor
    }

    func workspace() async -> Result<WriteWorkspace, WriteSyncError> { .success(workspaceValue) }
    func manifest(folderId: String) async -> Result<[WriteManifestItem], WriteSyncError> {
        if let failManifest { return .failure(failManifest) }
        return .success(manifests[folderId] ?? [])
    }
    func fileText(postId: String) async -> Result<WriteFileContent, WriteSyncError> {
        .success(WriteFileContent(text: "# body", hash: "h"))
    }
    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError> {
        .success(WriteChangeReply(cursor: self.cursor, changed: cursor != nil && cursor != self.cursor))
    }
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async -> Result<WriteManifestItem, WriteSyncError> {
        createFileCalls.append(CreateFileCall(body: body, folderId: folderId, idempotencyKey: idempotencyKey))
        return createFileResult ?? .success(Fixtures.item(id: "new", file: "new.md", kind: "note"))
    }
    func putFile(postId: String, body: String, ifMatch hash: String) async -> Result<WriteManifestItem, WriteSyncError> {
        putCalls.append(PutCall(postId: postId, body: body, hash: hash))
        return putResult
    }
    func patchFile(postId: String, folderId: String?, slug: String?, ifMatch hash: String?) async -> Result<WriteManifestItem, WriteSyncError> {
        patchCalls.append(PatchCall(postId: postId, folderId: folderId, slug: slug, ifMatch: hash))
        return patchResult ?? .success(Fixtures.item(id: postId, file: (slug ?? "x") + ".md", kind: "note"))
    }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, WriteSyncError> {
        deleteCalls.append(postId); deleteIfMatchCalls.append(hash); return deleteResult
    }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        createFolderCalls.append(CreateFolderCall(parentPath: parentPath, name: name, idempotencyKey: idempotencyKey))
        return createFolderResult ?? .success(
            WriteWorkspaceFolder(id: "f-new", name: name, path: "\(parentPath)/\(name)", mode: "blog", parentId: nil))
    }
    func renameFolder(folderId: String, name: String) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        renameFolderCalls.append(RenameFolderCall(folderId: folderId, name: name))
        return renameFolderResult ?? .success(
            WriteWorkspaceFolder(id: folderId, name: name, path: name, mode: "blog", parentId: nil))
    }
}

enum Fixtures {
    static func item(id: String, file: String, kind: String, slug: String? = nil) -> WriteManifestItem {
        WriteManifestItem(
            file: file, kind: kind, slug: slug ?? file.replacingOccurrences(of: ".md", with: ""),
            title: file, status: "draft", hash: "h", id: id, date: nil,
            createdAt: nil, updatedAt: nil, url: nil)
    }

    static func workspace() -> WriteWorkspace {
        WriteWorkspace(
            blog: WriteWorkspaceBlog(handle: "demo", name: "Demo", username: "demo"),
            folders: [
                WriteWorkspaceFolder(id: "blog", name: "Blog", path: "Blog", mode: "blog", parentId: nil),
                WriteWorkspaceFolder(id: "notes", name: "Notes", path: "Notes", mode: "notes", parentId: nil),
            ])
    }
}
