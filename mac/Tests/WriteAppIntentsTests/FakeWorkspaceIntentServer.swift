import Foundation
@testable import WriteAppIntents

/// In-memory WorkspaceIntentServer for testing the App Intents actions without a
/// network or the File Provider mount. It mimics the server's parse-markdown ->
/// item behavior (title/slug/kind/status come from the posted frontmatter) and
/// records every mutation so tests can assert what reached the sync API.
final class FakeWorkspaceIntentServer: WorkspaceIntentServer {
    struct Stored { var item: WorkspaceServerItem; var body: String }

    private var foldersList: [WorkspaceServerFolder]
    private(set) var stored: [String: Stored] = [:]
    private(set) var created: [(body: String, folderId: String?)] = []
    private(set) var updated: [(id: String, body: String, ifMatch: String)] = []
    private(set) var moved: [(id: String, folderId: String, ifMatch: String?)] = []
    private(set) var createdFolders: [(parentPath: String, name: String)] = []
    private var nextId = 1
    private let now: () -> Date

    init(folders: [WorkspaceServerFolder]? = nil, now: @escaping () -> Date = { Date() }) {
        self.foldersList = folders ?? Self.systemFolders
        self.now = now
    }

    /// A workspace's three system folders, using the server's lowercase paths.
    static let systemFolders: [WorkspaceServerFolder] = [
        WorkspaceServerFolder(id: "f-blog", name: "Blog", path: "blog", mode: "blog"),
        WorkspaceServerFolder(id: "f-notes", name: "Notes", path: "notes", mode: "notes"),
        WorkspaceServerFolder(id: "f-bookmarks", name: "Bookmarks", path: "bookmarks", mode: "bookmarks"),
    ]

    func folders() throws -> [WorkspaceServerFolder] { foldersList }

    func items(inFolder folderId: String) throws -> [WorkspaceServerItem] {
        stored.values
            .filter { $0.item.folderId == folderId }
            .map(\.item)
            .sorted { $0.id < $1.id }
    }

    func fileText(id: String) throws -> (text: String, hash: String) {
        guard let s = stored[id] else { throw WorkspaceIntentServerError.notFound(id) }
        return (s.body, s.item.hash ?? "h")
    }

    func createDocument(
        body: String, folderId: String?, idempotencyKey: String?
    ) throws -> WorkspaceServerItem {
        created.append((body, folderId))
        let id = "post-\(nextId)"; nextId += 1
        let item = item(from: body, id: id, folderId: folderId, revision: 1)
        stored[id] = Stored(item: item, body: body)
        return item
    }

    func updateDocument(id: String, body: String, ifMatch: String) throws -> WorkspaceServerItem {
        guard let existing = stored[id] else { throw WorkspaceIntentServerError.notFound(id) }
        updated.append((id, body, ifMatch))
        let item = item(from: body, id: id, folderId: existing.item.folderId, revision: 2)
        stored[id] = Stored(item: item, body: body)
        return item
    }

    func moveDocument(
        id: String, toFolder folderId: String, ifMatch: String?
    ) throws -> WorkspaceServerItem {
        guard var existing = stored[id] else { throw WorkspaceIntentServerError.notFound(id) }
        moved.append((id, folderId, ifMatch))
        existing.item.folderId = folderId
        stored[id] = existing
        return existing.item
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) throws -> WorkspaceServerFolder {
        createdFolders.append((parentPath, name))
        let path = parentPath.isEmpty
            ? name.lowercased() : "\(parentPath)/\(name.lowercased())"
        let mode = foldersList.first { $0.path == parentPath }?.mode ?? "notes"
        let folder = WorkspaceServerFolder(
            id: "folder-\(nextId)", name: name, path: path, mode: mode)
        nextId += 1
        foldersList.append(folder)
        return folder
    }

    // MARK: server-style parse (the real server assigns fields from the markdown)

    private func item(
        from body: String, id: String, folderId: String?, revision: Int
    ) -> WorkspaceServerItem {
        let parsed = ParsedMarkdown(markdown: body)
        return WorkspaceServerItem(
            id: id,
            slug: parsed.frontMatter["slug"] ?? "untitled",
            title: parsed.frontMatter["title"] ?? "Untitled",
            kind: parsed.frontMatter["kind"] ?? parsed.frontMatter["type"] ?? "note",
            status: parsed.frontMatter["status"] ?? "draft",
            folderId: folderId,
            folderPath: nil,
            canonicalURL: nil,
            hash: "h-\(id)-r\(revision)",
            modifiedDate: now())
    }
}
