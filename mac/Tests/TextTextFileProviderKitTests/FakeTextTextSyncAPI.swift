import Foundation
@testable import TextTextFileProviderKit

/// An in-memory `TextTextSyncAPI` for tests: a workspace, per-folder manifests,
/// file bodies, and a bumpable change cursor. No network, fully deterministic.
final class FakeTextTextSyncAPI: TextTextSyncAPI, @unchecked Sendable {
    var workspaceValue: TextTextWorkspace
    var manifests: [String: [TextTextManifestItem]]   // folderId -> entries
    var files: [String: TextTextFileContent]           // postId -> content
    var artifactManifests: [String: TextTextArtifactManifest]
    var artifactContents: [String: TextTextArtifactContent]
    var cursor: String

    /// Force a specific failure on the next call of a given kind, for error
    /// path tests. Consumed on use.
    var failWorkspace: TextTextSyncError?
    var failManifest: TextTextSyncError?

    // Call counters, so tests can assert on the request shape (e.g. that a
    // folder listing did not fetch bodies).
    private(set) var workspaceCalls = 0
    private(set) var manifestCalls = 0
    private(set) var fileTextCalls = 0
    private(set) var documentArtifactCalls = 0
    private(set) var artifactDataCalls = 0
    private(set) var createFileRepresentations: [TextTextFileRepresentation] = []

    init(
        workspace: TextTextWorkspace,
        manifests: [String: [TextTextManifestItem]] = [:],
        files: [String: TextTextFileContent] = [:],
        artifactManifests: [String: TextTextArtifactManifest] = [:],
        artifactContents: [String: TextTextArtifactContent] = [:],
        cursor: String = "c0"
    ) {
        self.workspaceValue = workspace
        self.manifests = manifests
        self.files = files
        self.artifactManifests = artifactManifests
        self.artifactContents = artifactContents
        self.cursor = cursor
    }

    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> {
        workspaceCalls += 1
        if let failWorkspace { self.failWorkspace = nil; return .failure(failWorkspace) }
        return .success(workspaceValue)
    }

    func manifest(folderId: String) async -> Result<[TextTextManifestItem], TextTextSyncError> {
        manifestCalls += 1
        if let failManifest { self.failManifest = nil; return .failure(failManifest) }
        return .success(manifests[folderId] ?? [])
    }

    func fileText(postId: String) async -> Result<TextTextFileContent, TextTextSyncError> {
        fileTextCalls += 1
        guard let content = files[postId] else { return .failure(.notFound) }
        return .success(content)
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

    func changes(since cursor: String?, wait: Int) async -> Result<TextTextChangeReply, TextTextSyncError> {
        let changed = cursor != nil && cursor != self.cursor
        return .success(TextTextChangeReply(cursor: self.cursor, changed: changed))
    }

    // TextText paths: minimal, enough for the read-path tests here.
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await createFile(
            body: body, folderId: folderId, representation: .markdown,
            idempotencyKey: idempotencyKey)
    }
    func createFile(
        body: String, folderId: String?, representation: TextTextFileRepresentation,
        idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        createFileRepresentations.append(representation)
        return .failure(.rejected("not implemented in fake"))
    }
    func putFile(postId: String, body: String, ifMatch hash: String) async
        -> Result<TextTextManifestItem, TextTextSyncError> {
        .failure(.conflict)
    }
    func patchFile(postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?) async
        -> Result<TextTextManifestItem, TextTextSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, TextTextSyncError> {
        .success(())
    }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async
        -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
    func renameFolder(folderId: String, name: String) async
        -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        .failure(.rejected("not implemented in fake"))
    }

    func renameWorkspace(name: String) async
        -> Result<TextTextWorkspaceBlog, TextTextSyncError> {
        .failure(.rejected("not implemented in fake"))
    }
}

// MARK: Fixtures

enum Fixtures {
    static func folder(
        _ id: String, _ name: String, mode: String = "blog", parent: String? = nil
    ) -> TextTextWorkspaceFolder {
        TextTextWorkspaceFolder(
            id: id, name: name,
            path: parent == nil ? name : "\(parent!)/\(name)",
            mode: mode, parentId: parent
        )
    }

    static func entry(
        id: String, file: String, kind: String, title: String,
        representation: TextTextFileRepresentation = .markdown,
        hash: String = "h", updatedAt: String? = "2026-07-11T10:00:00Z"
    ) -> TextTextManifestItem {
        let suffix = representation.filenameSuffix
        let slug = file.lowercased().hasSuffix(suffix)
            ? String(file.dropLast(suffix.count)) : file
        return TextTextManifestItem(
            file: file, representation: representation, kind: kind, slug: slug,
            title: title, status: "draft", hash: hash, id: id, date: nil,
            createdAt: "2026-07-01T09:00:00Z", updatedAt: updatedAt, url: nil
        )
    }

    /// A small but representative workspace: three system folders, one
    /// subfolder, a handful of items across kinds.
    static func standardWorkspace() -> FakeTextTextSyncAPI {
        let blog = folder("blog", "Blog", mode: "blog")
        let notes = folder("notes", "Notes", mode: "notes")
        let bookmarks = folder("bookmarks", "Bookmarks", mode: "bookmarks")
        let drafts = folder("drafts", "Drafts", mode: "blog", parent: "blog")
        let ws = TextTextWorkspace(
            blog: TextTextWorkspaceBlog(handle: "demo", name: "Demo", username: "demo"),
            folders: [blog, notes, bookmarks, drafts]
        )
        return FakeTextTextSyncAPI(
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
                "p1": TextTextFileContent(text: "# Hello\n\nbody", hash: "h"),
            ]
        )
    }
}
