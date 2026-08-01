import FileProvider
import Foundation
import XCTest
@testable import TextTextFileProviderBridge
@testable import TextTextFileProviderExtensionCore
@testable import TextTextFileProviderKit

private final class CreateConvergenceAPI: TextTextSyncAPI, @unchecked Sendable {
    let created: TextTextManifestItem
    let children: [TextTextManifestItem]

    init(created: TextTextManifestItem, children: [TextTextManifestItem]) {
        self.created = created
        self.children = children
    }

    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> {
        .success(TextTextWorkspace(
            blog: TextTextWorkspaceBlog(
                handle: "demo", name: "Demo", username: "demo"),
            folders: [TextTextWorkspaceFolder(
                id: "notes", name: "Notes", path: "Notes", mode: "notes",
                parentId: nil)]))
    }

    func manifest(
        folderId: String
    ) async -> Result<[TextTextManifestItem], TextTextSyncError> {
        .success(folderId == "notes" ? children : [])
    }

    func fileText(
        postId: String
    ) async -> Result<TextTextFileContent, TextTextSyncError> {
        .failure(.notFound)
    }

    func changes(
        since cursor: String?, wait: Int
    ) async -> Result<TextTextChangeReply, TextTextSyncError> {
        .success(TextTextChangeReply(cursor: "cursor", changed: false))
    }

    func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        .success(created)
    }

    func createFile(
        body: String, folderId: String?,
        representation: TextTextFileRepresentation, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        .success(created)
    }

    func putFile(
        postId: String, body: String, ifMatch hash: String
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        .failure(.conflict)
    }

    func patchFile(
        postId: String, folderId: String?, slug: String?, title: String?,
        ifMatch hash: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        .success(created)
    }

    func deleteFile(
        postId: String, ifMatch hash: String?
    ) async -> Result<Void, TextTextSyncError> {
        .success(())
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        .failure(.conflict)
    }

    func renameFolder(
        folderId: String, name: String
    ) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        .failure(.conflict)
    }

    func renameWorkspace(
        name: String
    ) async -> Result<TextTextWorkspaceBlog, TextTextSyncError> {
        .failure(.conflict)
    }
}

final class FileProviderCreateConvergenceTests: XCTestCase {
    private func manifest(
        id: String, title: String, hash: String
    ) -> TextTextManifestItem {
        TextTextManifestItem(
            file: title + ".md",
            kind: "note",
            slug: title.lowercased(),
            title: title,
            status: "draft",
            hash: hash,
            id: id,
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: nil,
            size: 7)
    }

    func testCreatedItemConvergesWithCanonicalEnumeratedChild() async throws {
        let existing = manifest(id: "existing", title: "Shared", hash: "old")
        let created = manifest(id: "created", title: "Shared", hash: "new")
        let api = CreateConvergenceAPI(
            created: created, children: [existing, created])
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "texttext-tests"),
            displayName: "TextText")
        let provider = FileProviderExtension(
            domain: domain,
            apiFactory: { _ in api },
            descriptorsProvider: { [FileProviderWorkspace(
                name: "Demo", handle: "demo",
                origin: "https://example.test", token: "token")] })
        let templateItem = try XCTUnwrap(TextTextItemMapper.item(
            for: manifest(id: "temporary", title: "Shared", hash: "local"),
            inFolder: "notes", handle: "demo", readOnly: false))
        let template = TextTextFileProviderItem(templateItem)
        let contentsURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try Data("# Shared\n".utf8).write(to: contentsURL)
        defer { try? FileManager.default.removeItem(at: contentsURL) }

        let returned = await withCheckedContinuation { continuation in
            _ = provider.createItem(
                basedOn: template,
                fields: [.filename, .contents],
                contents: contentsURL,
                options: [],
                request: NSFileProviderRequest()
            ) { item, pending, _, error in
                continuation.resume(returning: (
                    identifier: item?.itemIdentifier,
                    filename: item?.filename,
                    contentVersion: item?.itemVersion?.contentVersion,
                    metadataVersion: item?.itemVersion?.metadataVersion,
                    pending: pending,
                    error: error.map { String(describing: $0) }))
            }
        }

        let enumeratedChildren = try await WorkspaceEnumerator(
            api: api, handle: "demo", workspaceName: "Demo", readOnly: false
        ).children(of: .folder(handle: "demo", id: "notes")).get()
        let enumerated = try XCTUnwrap(enumeratedChildren.first {
            $0.identifier == .file(handle: "demo", id: "created")
        })
        let canonical = TextTextFileProviderItem(enumerated)

        XCTAssertNil(returned.error)
        XCTAssertTrue(returned.pending.isEmpty)
        XCTAssertEqual(returned.identifier, canonical.itemIdentifier)
        XCTAssertEqual(returned.filename, canonical.filename)
        XCTAssertEqual(returned.contentVersion, canonical.itemVersion.contentVersion)
        XCTAssertEqual(returned.metadataVersion, canonical.itemVersion.metadataVersion)
    }
}
