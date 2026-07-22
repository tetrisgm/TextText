import FileProvider
import Foundation
import XCTest
@testable import WriteFileProviderBridge
@testable import WriteFileProviderExtensionCore
@testable import WriteFileProviderKit

private final class CreateConvergenceAPI: WriteSyncAPI, @unchecked Sendable {
    let created: WriteManifestItem
    let children: [WriteManifestItem]

    init(created: WriteManifestItem, children: [WriteManifestItem]) {
        self.created = created
        self.children = children
    }

    func workspace() async -> Result<WriteWorkspace, WriteSyncError> {
        .success(WriteWorkspace(
            blog: WriteWorkspaceBlog(
                handle: "demo", name: "Demo", username: "demo"),
            folders: [WriteWorkspaceFolder(
                id: "notes", name: "Notes", path: "Notes", mode: "notes",
                parentId: nil)]))
    }

    func manifest(
        folderId: String
    ) async -> Result<[WriteManifestItem], WriteSyncError> {
        .success(folderId == "notes" ? children : [])
    }

    func fileText(
        postId: String
    ) async -> Result<WriteFileContent, WriteSyncError> {
        .failure(.notFound)
    }

    func changes(
        since cursor: String?, wait: Int
    ) async -> Result<WriteChangeReply, WriteSyncError> {
        .success(WriteChangeReply(cursor: "cursor", changed: false))
    }

    func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .success(created)
    }

    func createFile(
        body: String, folderId: String?,
        representation: WriteFileRepresentation, idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .success(created)
    }

    func putFile(
        postId: String, body: String, ifMatch hash: String
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .failure(.conflict)
    }

    func patchFile(
        postId: String, folderId: String?, slug: String?, title: String?,
        ifMatch hash: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        .success(created)
    }

    func deleteFile(
        postId: String, ifMatch hash: String?
    ) async -> Result<Void, WriteSyncError> {
        .success(())
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        .failure(.conflict)
    }

    func renameFolder(
        folderId: String, name: String
    ) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        .failure(.conflict)
    }

    func renameWorkspace(
        name: String
    ) async -> Result<WriteWorkspaceBlog, WriteSyncError> {
        .failure(.conflict)
    }
}

final class FileProviderCreateConvergenceTests: XCTestCase {
    private func manifest(
        id: String, title: String, hash: String
    ) -> WriteManifestItem {
        WriteManifestItem(
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
            identifier: NSFileProviderDomainIdentifier(rawValue: "write-tests"),
            displayName: "Texttext")
        let provider = FileProviderExtension(
            domain: domain,
            apiFactory: { _ in api },
            descriptorsProvider: { [FileProviderWorkspace(
                name: "Demo", handle: "demo",
                origin: "https://example.test", token: "token")] })
        let templateItem = try XCTUnwrap(WriteItemMapper.item(
            for: manifest(id: "temporary", title: "Shared", hash: "local"),
            inFolder: "notes", handle: "demo", readOnly: false))
        let template = WriteFileProviderItem(templateItem)
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
        let canonical = WriteFileProviderItem(enumerated)

        XCTAssertNil(returned.error)
        XCTAssertTrue(returned.pending.isEmpty)
        XCTAssertEqual(returned.identifier, canonical.itemIdentifier)
        XCTAssertEqual(returned.filename, canonical.filename)
        XCTAssertEqual(returned.contentVersion, canonical.itemVersion.contentVersion)
        XCTAssertEqual(returned.metadataVersion, canonical.itemVersion.metadataVersion)
    }
}
