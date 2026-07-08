import Foundation
import XCTest
@testable import WriteFileProviderCore

final class WriteFileProviderCoreTests: XCTestCase {
    func testManifestItemMapsToFileProviderShape() throws {
        let folder = WriteWorkspaceFolder(id: "folder-1", name: "Notes", path: "notes", mode: "notes")
        let item = WriteManifestItem(
            file: "",
            kind: "note",
            slug: "daily-note",
            title: "Daily Note",
            status: "draft",
            hash: "abc123",
            id: "post-1",
            date: "2026-07-07",
            createdAt: "2026-07-06T01:02:03Z",
            updatedAt: "2026-07-07T12:13:14Z"
        )

        let metadata = try WriteFileProviderMetadataMapper.markdownItem(item, in: folder, size: 42)

        XCTAssertEqual(metadata.identifier, .markdown("post-1"))
        XCTAssertEqual(metadata.parentIdentifier, .folder("folder-1"))
        XCTAssertEqual(metadata.filename, "daily-note.md")
        XCTAssertEqual(metadata.contentType, WriteFileProviderMetadataMapper.markdownContentType)
        XCTAssertEqual(metadata.size, 42)
        XCTAssertEqual(metadata.versions.contentVersionString, "abc123")
        XCTAssertNotNil(metadata.contentModificationDate)
        XCTAssertFalse(metadata.isDirectory)
    }

    func testFolderEnumerationPagesAndSorts() async throws {
        let api = FakeFileProviderAPI()
        api.workspaceValue = WriteWorkspace(
            blog: WriteWorkspaceBlog(handle: "test", name: "Test"),
            folders: [
                WriteWorkspaceFolder(id: "notes", name: "Notes", path: "notes", mode: "notes"),
                WriteWorkspaceFolder(id: "blog", name: "Blog", path: "blog", mode: "blog"),
                WriteWorkspaceFolder(id: "archive", name: "Archive", path: "notes/archive", mode: "notes", parentId: "notes"),
            ]
        )
        api.manifests["notes"] = [
            WriteManifestItem(file: "beta.md", kind: "note", slug: "beta", title: "Beta", status: "draft", hash: "b", id: "post-b"),
            WriteManifestItem(file: "alpha.md", kind: "note", slug: "alpha", title: "Alpha", status: "draft", hash: "a", id: "post-a"),
        ]

        let core = WriteFileProviderCore(api: api, defaultPageSize: 2)

        let root = try await core.enumerateItems(in: .rootContainer)
        XCTAssertEqual(root.items.map(\.filename), ["Blog", "Notes"])

        let first = try await core.enumerateItems(in: .folder("notes"))
        XCTAssertEqual(first.items.map(\.filename), ["Archive", "alpha.md"])
        XCTAssertEqual(first.nextPageToken?.offset, 2)

        let second = try await core.enumerateItems(in: .folder("notes"), pageToken: first.nextPageToken)
        XCTAssertEqual(second.items.map(\.filename), ["beta.md"])
        XCTAssertNil(second.nextPageToken)
    }

    func testChangeAnchorAndModifyUseProtocolVersions() async throws {
        let api = FakeFileProviderAPI()
        api.workspaceValue = WriteWorkspace(
            blog: WriteWorkspaceBlog(handle: "test", name: "Test"),
            folders: [WriteWorkspaceFolder(id: "notes", name: "Notes", path: "notes", mode: "notes")]
        )
        api.manifests["notes"] = [
            WriteManifestItem(file: "alpha.md", kind: "note", slug: "alpha", title: "Alpha", status: "draft", hash: "oldhash", id: "post-a")
        ]
        api.changePoll = WriteRemoteChangePoll(cursor: "cursor-2", changed: true)
        api.modifyResult = WriteManifestItem(
            file: "alpha.md",
            kind: "note",
            slug: "alpha",
            title: "Alpha",
            status: "draft",
            hash: "newhash",
            id: "post-a"
        )

        let core = WriteFileProviderCore(api: api)
        let changes = try await core.enumerateChanges(since: WriteFileProviderChangeAnchor(cursor: "cursor-1"))

        XCTAssertEqual(api.lastChangeCursor, "cursor-1")
        XCTAssertEqual(changes.anchor.cursor, "cursor-2")
        XCTAssertTrue(changes.requiresFullEnumeration)

        let body = Data("# Alpha\n".utf8)
        let metadata = try await core.modifyItem(
            identifier: .markdown("post-a"),
            baseVersion: WriteFileProviderItemVersion(contentVersion: "oldhash"),
            contents: body
        )

        XCTAssertEqual(api.lastModifiedItemId, "post-a")
        XCTAssertEqual(api.lastModifiedBaseVersion, "oldhash")
        XCTAssertEqual(api.lastModifiedContents, body)
        XCTAssertEqual(metadata.versions.contentVersionString, "newhash")
        XCTAssertEqual(metadata.size, Int64(body.count))
    }
}

private final class FakeFileProviderAPI: WriteFileProviderAPI {
    var workspaceValue = WriteWorkspace(blog: WriteWorkspaceBlog(handle: "test", name: "Test"), folders: [])
    var manifests: [String: [WriteManifestItem]] = [:]
    var fetched: [String: WriteFetchedMarkdown] = [:]
    var changePoll = WriteRemoteChangePoll(cursor: "cursor-1", changed: false)
    var modifyResult: WriteManifestItem?

    var lastChangeCursor: String?
    var lastModifiedItemId: String?
    var lastModifiedBaseVersion: String?
    var lastModifiedContents: Data?

    func workspace() async throws -> WriteWorkspace {
        workspaceValue
    }

    func manifest(folderId: String, etag: String?) async throws -> WriteManifestResponse {
        .manifest(manifests[folderId] ?? [], etag: nil)
    }

    func fetchMarkdown(itemId: String) async throws -> WriteFetchedMarkdown {
        fetched[itemId] ?? WriteFetchedMarkdown(contents: Data(), contentVersion: nil)
    }

    func createFolder(parentPath: String, name: String) async throws -> WriteWorkspaceFolder {
        WriteWorkspaceFolder(id: "created-folder", name: name, path: parentPath.isEmpty ? name : "\(parentPath)/\(name)", mode: "notes")
    }

    func createMarkdown(
        in folder: WriteWorkspaceFolder,
        proposedFilename: String,
        contents: Data
    ) async throws -> WriteManifestItem {
        let slug = proposedFilename.replacingOccurrences(of: ".md", with: "")
        return WriteManifestItem(
            file: proposedFilename,
            kind: folder.mode == "bookmarks" ? "bookmark" : "note",
            slug: slug,
            title: slug,
            status: "draft",
            hash: "createdhash",
            id: "created-post"
        )
    }

    func modifyMarkdown(
        itemId: String,
        baseVersion: String?,
        contents: Data
    ) async throws -> WriteManifestItem {
        lastModifiedItemId = itemId
        lastModifiedBaseVersion = baseVersion
        lastModifiedContents = contents
        return modifyResult ?? WriteManifestItem(
            file: "modified.md",
            kind: "note",
            slug: "modified",
            title: "Modified",
            status: "draft",
            hash: "modifiedhash",
            id: itemId
        )
    }

    func deleteMarkdown(itemId: String) async throws {}

    func pollRemoteChanges(since cursor: String?, waitSeconds: Int) async throws -> WriteRemoteChangePoll {
        lastChangeCursor = cursor
        return changePoll
    }
}
