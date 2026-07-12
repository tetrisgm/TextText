import Foundation
@testable import WriteFileProviderKit

/// An in-memory `WriteSyncAPI` for tests: a workspace, per-folder manifests,
/// file bodies, and a bumpable change cursor. No network, fully deterministic.
final class FakeWriteSyncAPI: WriteSyncAPI, @unchecked Sendable {
    var workspaceValue: WriteWorkspace
    var manifests: [String: [WriteManifestItem]]   // folderId -> entries
    var files: [String: WriteFileContent]           // postId -> content
    var cursor: String

    /// Force a specific failure on the next call of a given kind, for error
    /// path tests. Consumed on use.
    var failWorkspace: WriteSyncError?
    var failManifest: WriteSyncError?

    // Call counters, so tests can assert on the request shape (e.g. that a
    // folder listing did not fetch bodies).
    private(set) var workspaceCalls = 0
    private(set) var manifestCalls = 0
    private(set) var fileTextCalls = 0

    init(
        workspace: WriteWorkspace,
        manifests: [String: [WriteManifestItem]] = [:],
        files: [String: WriteFileContent] = [:],
        cursor: String = "c0"
    ) {
        self.workspaceValue = workspace
        self.manifests = manifests
        self.files = files
        self.cursor = cursor
    }

    func workspace() async -> Result<WriteWorkspace, WriteSyncError> {
        workspaceCalls += 1
        if let failWorkspace { self.failWorkspace = nil; return .failure(failWorkspace) }
        return .success(workspaceValue)
    }

    func manifest(folderId: String) async -> Result<[WriteManifestItem], WriteSyncError> {
        manifestCalls += 1
        if let failManifest { self.failManifest = nil; return .failure(failManifest) }
        return .success(manifests[folderId] ?? [])
    }

    func fileText(postId: String) async -> Result<WriteFileContent, WriteSyncError> {
        fileTextCalls += 1
        guard let content = files[postId] else { return .failure(.notFound) }
        return .success(content)
    }

    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError> {
        let changed = cursor != nil && cursor != self.cursor
        return .success(WriteChangeReply(cursor: self.cursor, changed: changed))
    }

    // Write paths: minimal, enough for the read-path tests here.
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async -> Result<WriteManifestItem, WriteSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
    func putFile(postId: String, body: String, ifMatch hash: String) async
        -> Result<WriteManifestItem, WriteSyncError> {
        .failure(.conflict)
    }
    func patchFile(postId: String, folderId: String?, slug: String?, ifMatch hash: String?) async
        -> Result<WriteManifestItem, WriteSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, WriteSyncError> {
        .success(())
    }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async
        -> Result<WriteWorkspaceFolder, WriteSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
    func renameFolder(folderId: String, name: String) async
        -> Result<WriteWorkspaceFolder, WriteSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
}

// MARK: Fixtures

enum Fixtures {
    static func folder(
        _ id: String, _ name: String, mode: String = "blog", parent: String? = nil
    ) -> WriteWorkspaceFolder {
        WriteWorkspaceFolder(
            id: id, name: name,
            path: parent == nil ? name : "\(parent!)/\(name)",
            mode: mode, parentId: parent
        )
    }

    static func entry(
        id: String, file: String, kind: String, title: String,
        hash: String = "h", updatedAt: String? = "2026-07-11T10:00:00Z"
    ) -> WriteManifestItem {
        WriteManifestItem(
            file: file, kind: kind, slug: file.replacingOccurrences(of: ".md", with: ""),
            title: title, status: "draft", hash: hash, id: id, date: nil,
            createdAt: "2026-07-01T09:00:00Z", updatedAt: updatedAt, url: nil
        )
    }

    /// A small but representative workspace: three system folders, one
    /// subfolder, a handful of items across kinds.
    static func standardWorkspace() -> FakeWriteSyncAPI {
        let blog = folder("blog", "Blog", mode: "blog")
        let notes = folder("notes", "Notes", mode: "notes")
        let bookmarks = folder("bookmarks", "Bookmarks", mode: "bookmarks")
        let drafts = folder("drafts", "Drafts", mode: "blog", parent: "blog")
        let ws = WriteWorkspace(
            blog: WriteWorkspaceBlog(handle: "demo", name: "Demo", username: "demo"),
            folders: [blog, notes, bookmarks, drafts]
        )
        return FakeWriteSyncAPI(
            workspace: ws,
            manifests: [
                "blog": [
                    entry(id: "p1", file: "hello.md", kind: "article", title: "Hello"),
                    entry(id: "p2", file: "my-talk.md", kind: "talk", title: "My Talk"),
                ],
                "drafts": [
                    entry(id: "p3", file: "wip.md", kind: "article", title: "WIP"),
                ],
                "notes": [
                    entry(id: "n1", file: "idea.md", kind: "note", title: "Idea"),
                ],
                "bookmarks": [
                    entry(id: "b1", file: "link.md", kind: "bookmark", title: "A Link"),
                ],
            ],
            files: [
                "p1": WriteFileContent(text: "# Hello\n\nbody", hash: "h"),
            ]
        )
    }
}
