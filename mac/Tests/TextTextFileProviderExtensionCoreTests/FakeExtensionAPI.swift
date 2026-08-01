import Foundation
@testable import TextTextFileProviderKit

/// A writable in-memory `TextTextSyncAPI` for the extension tests: it records the
/// write calls so tests can assert the extension mapped a Finder mutation onto
/// the right server call, and can be told to fail.
final class FakeExtensionAPI: TextTextSyncAPI, @unchecked Sendable {
    var workspaceValue: TextTextWorkspace
    var manifests: [String: [TextTextManifestItem]]
    var cursor: String
    var failManifest: TextTextSyncError?
    var manifestResults: [String: [Result<[TextTextManifestItem], TextTextSyncError>]] = [:]
    var fileTextResults: [Result<TextTextFileContent, TextTextSyncError>] = []
    var artifactManifests: [String: TextTextArtifactManifest] = [:]
    var artifactContents: [String: TextTextArtifactContent] = [:]
    private(set) var fileTextCalls = 0
    private(set) var documentArtifactCalls = 0
    private(set) var artifactDataCalls = 0
    var manifestDelayNanoseconds: UInt64 = 0
    var createFileDelayNanoseconds: UInt64 = 0
    var putFileDelayNanoseconds: UInt64 = 0
    var deleteFileDelayNanoseconds: UInt64 = 0

    // Recorded write calls.
    struct CreateFileCall: Equatable {
        let body: String
        let folderId: String?
        let representation: TextTextFileRepresentation
        let idempotencyKey: String?
    }
    struct PatchCall: Equatable { let postId: String; let folderId: String?; let slug: String?; let title: String?; let ifMatch: String? }
    struct PutCall: Equatable { let postId: String; let body: String; let hash: String }
    struct CreateFolderCall: Equatable { let parentPath: String; let name: String; let idempotencyKey: String? }
    struct RenameFolderCall: Equatable { let folderId: String; let name: String }
    struct RenameWorkspaceCall: Equatable { let name: String }
    struct UploadAssetCall: Equatable {
        let postId: String
        let filename: String
        let data: Data
        let contentType: String?
    }
    private(set) var createFileCalls: [CreateFileCall] = []
    private(set) var patchCalls: [PatchCall] = []
    private(set) var putCalls: [PutCall] = []
    private(set) var deleteCalls: [String] = []
    private(set) var deleteIfMatchCalls: [String?] = []
    private(set) var createFolderCalls: [CreateFolderCall] = []
    private(set) var renameFolderCalls: [RenameFolderCall] = []
    private(set) var renameWorkspaceCalls: [RenameWorkspaceCall] = []
    private(set) var uploadAssetCalls: [UploadAssetCall] = []
    private(set) var writeOperations: [String] = []

    // What the write calls return.
    var createFileResult: Result<TextTextManifestItem, TextTextSyncError>?
    var patchResult: Result<TextTextManifestItem, TextTextSyncError>?
    var putResult: Result<TextTextManifestItem, TextTextSyncError> = .failure(.conflict)
    var deleteResult: Result<Void, TextTextSyncError> = .success(())
    var createFolderResult: Result<TextTextWorkspaceFolder, TextTextSyncError>?
    var renameFolderResult: Result<TextTextWorkspaceFolder, TextTextSyncError>?
    var renameWorkspaceResult: Result<TextTextWorkspaceBlog, TextTextSyncError>?
    var uploadAssetResult: Result<TextTextArtifact, TextTextSyncError>?

    init(workspace: TextTextWorkspace, manifests: [String: [TextTextManifestItem]] = [:], cursor: String = "c0") {
        self.workspaceValue = workspace
        self.manifests = manifests.isEmpty
            ? ["notes": [Fixtures.item(
                id: "p1", file: "a.md", kind: "note", title: "a")]]
            : manifests
        self.cursor = cursor
    }

    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> { .success(workspaceValue) }
    func manifest(folderId: String) async -> Result<[TextTextManifestItem], TextTextSyncError> {
        guard await waitForDelay(manifestDelayNanoseconds) else {
            return .failure(.network("cancelled"))
        }
        if let failManifest { return .failure(failManifest) }
        if var queued = manifestResults[folderId], !queued.isEmpty {
            let result = queued.removeFirst()
            manifestResults[folderId] = queued
            return result
        }
        return .success(manifests[folderId] ?? [])
    }
    func fileText(postId: String) async -> Result<TextTextFileContent, TextTextSyncError> {
        fileTextCalls += 1
        if !fileTextResults.isEmpty { return fileTextResults.removeFirst() }
        return .success(TextTextFileContent(text: "# body", hash: "h"))
    }
    func documentArtifacts(
        postId: String
    ) async -> Result<TextTextArtifactManifest, TextTextSyncError> {
        documentArtifactCalls += 1
        guard let manifest = artifactManifests[postId] else {
            return .failure(.notFound)
        }
        return .success(manifest)
    }
    func artifactData(url: URL) async -> Result<TextTextArtifactContent, TextTextSyncError> {
        artifactDataCalls += 1
        guard let content = artifactContents[url.absoluteString] else {
            return .failure(.notFound)
        }
        return .success(content)
    }
    func uploadAsset(
        postId: String, filename: String, data: Data, contentType: String?
    ) async -> Result<TextTextArtifact, TextTextSyncError> {
        uploadAssetCalls.append(UploadAssetCall(
            postId: postId, filename: filename, data: data,
            contentType: contentType))
        writeOperations.append("upload:\(filename)")
        return uploadAssetResult ?? .failure(.rejected("not implemented in fake"))
    }
    func changes(since cursor: String?, wait: Int) async -> Result<TextTextChangeReply, TextTextSyncError> {
        .success(TextTextChangeReply(cursor: self.cursor, changed: cursor != nil && cursor != self.cursor))
    }
    func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await createFile(
            body: body, folderId: folderId, representation: .markdown,
            idempotencyKey: idempotencyKey)
    }

    func createFile(
        body: String, folderId: String?, representation: TextTextFileRepresentation,
        idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        guard await waitForDelay(createFileDelayNanoseconds) else {
            return .failure(.network("cancelled"))
        }
        createFileCalls.append(CreateFileCall(
            body: body, folderId: folderId, representation: representation,
            idempotencyKey: idempotencyKey))
        writeOperations.append("create")
        return createFileResult ?? .success(Fixtures.item(id: "new", file: "new.md", kind: "note"))
    }
    func putFile(postId: String, body: String, ifMatch hash: String) async -> Result<TextTextManifestItem, TextTextSyncError> {
        guard await waitForDelay(putFileDelayNanoseconds) else {
            return .failure(.network("cancelled"))
        }
        putCalls.append(PutCall(postId: postId, body: body, hash: hash))
        writeOperations.append("put")
        return putResult
    }
    func patchFile(postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?) async -> Result<TextTextManifestItem, TextTextSyncError> {
        patchCalls.append(PatchCall(postId: postId, folderId: folderId, slug: slug, title: title, ifMatch: hash))
        return patchResult ?? .success(Fixtures.item(id: postId, file: (slug ?? "x") + ".md", kind: "note", title: title ?? "x"))
    }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, TextTextSyncError> {
        guard await waitForDelay(deleteFileDelayNanoseconds) else {
            return .failure(.network("cancelled"))
        }
        deleteCalls.append(postId); deleteIfMatchCalls.append(hash); return deleteResult
    }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        createFolderCalls.append(CreateFolderCall(parentPath: parentPath, name: name, idempotencyKey: idempotencyKey))
        return createFolderResult ?? .success(
            TextTextWorkspaceFolder(id: "f-new", name: name, path: "\(parentPath)/\(name)", mode: "blog", parentId: nil))
    }
    func renameFolder(folderId: String, name: String) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        renameFolderCalls.append(RenameFolderCall(folderId: folderId, name: name))
        return renameFolderResult ?? .success(
            TextTextWorkspaceFolder(id: folderId, name: name, path: name, mode: "blog", parentId: nil))
    }

    func renameWorkspace(name: String) async -> Result<TextTextWorkspaceBlog, TextTextSyncError> {
        renameWorkspaceCalls.append(RenameWorkspaceCall(name: name))
        return renameWorkspaceResult ?? .success(
            TextTextWorkspaceBlog(handle: "demo", name: name, username: "demo"))
    }

    private func waitForDelay(_ nanoseconds: UInt64) async -> Bool {
        guard nanoseconds > 0 else { return true }
        do {
            try await Task.sleep(nanoseconds: nanoseconds)
            return true
        } catch {
            return false
        }
    }
}

enum Fixtures {
    static func item(
        id: String, file: String, kind: String, slug: String? = nil,
        title: String? = nil, hash: String = "h", url: String? = nil,
        canonicalUrl: String? = nil,
        representation: TextTextFileRepresentation = .markdown
    ) -> TextTextManifestItem {
        TextTextManifestItem(
            file: file, representation: representation, kind: kind,
            slug: slug ?? file.replacingOccurrences(of: ".md", with: ""),
            title: title ?? file, status: "draft", hash: hash, id: id, date: nil,
            createdAt: nil, updatedAt: nil, url: url,
            canonicalUrl: canonicalUrl)
    }

    static func workspace() -> TextTextWorkspace {
        TextTextWorkspace(
            blog: TextTextWorkspaceBlog(handle: "demo", name: "Demo", username: "demo"),
            folders: [
                TextTextWorkspaceFolder(id: "blog", name: "Blog", path: "Blog", mode: "blog", parentId: nil),
                TextTextWorkspaceFolder(id: "notes", name: "Notes", path: "Notes", mode: "notes", parentId: nil),
            ])
    }
}
