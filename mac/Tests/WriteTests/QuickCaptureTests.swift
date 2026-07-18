import Foundation
import XCTest
@testable import Write
import WriteFileProviderKit

final class QuickCaptureTests: XCTestCase {
    func testFirstLineBecomesTitleAndRemainingBytesBecomeBody() {
        let content = QuickCaptureContent.parse(
            "  Project thought  \r\nFirst paragraph.\r\n\r\nSecond paragraph."
        )

        XCTAssertEqual(content.title, "Project thought")
        XCTAssertEqual(content.body, "First paragraph.\n\nSecond paragraph.")
        XCTAssertEqual(QuickCaptureContent.parse("\nBody").title, "Untitled")
    }

    func testOutboxPersistsCaptureWithoutCredentialsOrNetwork() throws {
        let root = try temporaryDirectory()
        let createdAt = Date(timeIntervalSince1970: 1_700_000_000)
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let record = try outbox.enqueue(
            QuickCaptureContent(title: "Offline idea", body: "Keep these bytes."),
            id: "capture-1",
            createdAt: createdAt
        )

        let reopened = try QuickCaptureOutbox(baseDirectory: root)

        XCTAssertEqual(reopened.pendingRecords(), [record])
        XCTAssertEqual(record.idempotencyKey, "quick-capture:capture-1")
        XCTAssertTrue(record.markdown.contains("title: \"Offline idea\""))
        XCTAssertTrue(record.markdown.contains("kind: note"))
        XCTAssertTrue(record.markdown.contains("status: draft"))
        XCTAssertTrue(record.markdown.hasSuffix("Keep these bytes."))
    }

    func testDrainCreatesTextpackInNotesFolderAndRemovesConfirmedRecord() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let record = try outbox.enqueue(
            QuickCaptureContent(title: "Fast note", body: "Captured body"),
            id: "capture-2"
        )
        let client = QuickCaptureSyncClient(results: [
            .success(.saved(savedItem(id: "note-1")))
        ])

        let summary = QuickCaptureOutboxDrainer(outbox: outbox).drain(
            workspace: workspace(), client: client)

        XCTAssertEqual(summary.savedItems.count, 1)
        XCTAssertFalse(summary.shouldRetry)
        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(client.requests.count, 1)
        XCTAssertEqual(client.requests[0].folderId, "notes-folder")
        XCTAssertEqual(client.requests[0].representation, .textpack)
        XCTAssertEqual(client.requests[0].idempotencyKey, record.idempotencyKey)
        XCTAssertEqual(client.requests[0].body, record.markdown)
    }

    func testFailedPostKeepsRecordAndRetriesWithSameIdempotencyKey() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let record = try outbox.enqueue(
            QuickCaptureContent(title: "Retry me", body: "Never lose this"),
            id: "stable-capture"
        )
        let client = QuickCaptureSyncClient(results: [
            .failure(.network("offline")),
            .success(.saved(savedItem(id: "note-2"))),
        ])
        let drainer = QuickCaptureOutboxDrainer(outbox: outbox)

        let failed = drainer.drain(workspace: workspace(), client: client)
        XCTAssertTrue(failed.shouldRetry)
        XCTAssertEqual(outbox.pendingRecords(), [record])

        let retried = drainer.drain(workspace: workspace(), client: client)
        XCTAssertFalse(retried.shouldRetry)
        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(
            client.requests.map(\.idempotencyKey),
            ["quick-capture:stable-capture", "quick-capture:stable-capture"]
        )
    }

    func testRejectedCaptureMovesToDeadLetterInsteadOfDeletingBytes() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        try outbox.enqueue(
            QuickCaptureContent(title: "Rejected", body: "Preserve me"),
            id: "rejected-capture"
        )
        let client = QuickCaptureSyncClient(results: [
            .success(.rejected("invalid markdown"))
        ])

        let summary = QuickCaptureOutboxDrainer(outbox: outbox).drain(
            workspace: workspace(), client: client)

        XCTAssertEqual(summary.rejectedMessages, ["invalid markdown"])
        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(outbox.rejectedRecordCount(), 1)
        let rejected = try FileManager.default.contentsOfDirectory(
            at: outbox.rejectedDirectory,
            includingPropertiesForKeys: nil
        )
        let data = try Data(contentsOf: try XCTUnwrap(rejected.first))
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("Preserve me"))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
}

private struct QuickCaptureRequest {
    let body: String
    let folderId: String?
    let representation: WriteFileRepresentation
    let idempotencyKey: String?
}

private final class QuickCaptureSyncClient: SyncClient {
    var results: [Result<SaveReply, ClientFailure>]
    var requests: [QuickCaptureRequest] = []

    init(results: [Result<SaveReply, ClientFailure>]) {
        self.results = results
    }

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
        body: String,
        folderId: String?,
        representation: WriteFileRepresentation,
        idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        requests.append(QuickCaptureRequest(
            body: body,
            folderId: folderId,
            representation: representation,
            idempotencyKey: idempotencyKey
        ))
        guard !results.isEmpty else {
            return .failure(.badResponse("no prepared result"))
        }
        return results.removeFirst()
    }

    func deleteFile(
        postId: String, ifMatch hash: String?
    ) -> Result<Void, ClientFailure> {
        .failure(.badResponse("unused"))
    }

    func advertisedAppVersion() -> String? { nil }
}

private func workspace() -> Workspace {
    Workspace(
        blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil),
        folders: [
            WorkspaceFolder(
                id: "blog-folder", name: "Blog", path: "Blog",
                mode: "blog", parentId: nil),
            WorkspaceFolder(
                id: "notes-folder", name: "Notes", path: "Notes",
                mode: "notes", parentId: nil),
        ]
    )
}

private func savedItem(id: String) -> ManifestItem {
    ManifestItem(
        file: "notes/quick.textpack",
        kind: "note",
        slug: "quick",
        title: "Quick",
        status: "draft",
        hash: "hash",
        id: id,
        date: nil,
        createdAt: nil,
        updatedAt: nil,
        url: nil
    )
}
