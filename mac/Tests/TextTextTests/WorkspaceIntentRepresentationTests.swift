import Foundation
import XCTest
@testable import TextTextApp
import TextTextFileProviderKit

final class WorkspaceIntentRepresentationTests: XCTestCase {
    func testCreateDocumentUsesTextpackRepresentation() throws {
        let client = RepresentationCapturingSyncClient()
        let server = ServerBackedWorkspaceIntentServer(client: client)

        _ = try server.createDocument(
            body: "# New document\n", folderId: "notes",
            idempotencyKey: "intent-create")

        XCTAssertEqual(client.representation, .textpack)
    }
}

private final class RepresentationCapturingSyncClient: SyncClient {
    var representation: TextTextFileRepresentation?

    func workspace() -> Result<(Workspace, Data), ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func manifest(
        folderId: String, etag: String?
    ) -> Result<ManifestReply, ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) -> Result<WorkspaceFolder, ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func fileText(
        postId: String
    ) -> Result<(text: String, hash: String?), ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func putFile(
        postId: String, body: String, ifMatch hash: String
    ) -> Result<SaveReply, ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func patchFile(
        postId: String, folderId: String?, slug: String?, ifMatch hash: String?
    ) -> Result<SaveReply, ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func postFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        .failure(.badResponse("representation overload was bypassed"))
    }

    func postFile(
        body: String, folderId: String?, representation: TextTextFileRepresentation,
        idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        self.representation = representation
        return .success(.saved(ManifestItem(
            file: "posts/new.textpack", kind: "note", slug: "new",
            title: "New", status: "draft", hash: "hash", id: "post-1",
            date: nil, createdAt: nil, updatedAt: nil, url: nil)))
    }

    func deleteFile(
        postId: String, ifMatch hash: String?
    ) -> Result<Void, ClientFailure> {
        .failure(.badResponse("unused"))
    }

}
