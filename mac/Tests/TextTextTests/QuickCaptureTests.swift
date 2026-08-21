import Foundation
import XCTest
@testable import TextTextApp
import TextTextFileProviderKit

final class QuickCaptureTests: XCTestCase {
    func testFirstLineBecomesTitleAndRemainingBytesBecomeBody() {
        let content = QuickCaptureContent.parse(
            "  Project thought  \r\nFirst paragraph.\r\n\r\nSecond paragraph."
        )

        XCTAssertEqual(content.title, "Project thought")
        XCTAssertEqual(content.body, "First paragraph.\n\nSecond paragraph.")
        XCTAssertEqual(QuickCaptureContent.parse("\nBody").title, "Untitled")
    }

    func testNativeCaptureUsesSharedURLAndTextIntent() throws {
        let bookmark = try XCTUnwrap(
            QuickCaptureIntent("paper.design/docs/mcp"))
        XCTAssertEqual(bookmark.target, .bookmarks)
        XCTAssertEqual(bookmark.content.title, "paper.design")
        XCTAssertEqual(
            bookmark.content.body,
            "[paper.design](https://paper.design/docs/mcp)")

        let note = try XCTUnwrap(
            QuickCaptureIntent("A launch thought\n\nKeep the first run tiny."))
        XCTAssertEqual(note.target, .notes)
        XCTAssertEqual(note.content.title, "A launch thought")
        XCTAssertEqual(
            note.content.body,
            "A launch thought\n\nKeep the first run tiny.")
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
        XCTAssertEqual(outbox.pendingRecords().first?.id, record.id)
        XCTAssertEqual(outbox.pendingRecords().first?.attempts, 1)

        let retried = drainer.drain(workspace: workspace(), client: client)
        XCTAssertFalse(retried.shouldRetry)
        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(
            client.requests.map(\.idempotencyKey),
            ["quick-capture:stable-capture", "quick-capture:stable-capture"]
        )
    }

    func testBookmarkCaptureUsesBookmarksFolderAndKind() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let record = try outbox.enqueue(
            QuickCaptureContent(title: "Saved link", body: ""),
            id: "bookmark-capture",
            target: .bookmarks)
        let client = QuickCaptureSyncClient(results: [
            .success(.saved(savedItem(id: "bookmark-1")))
        ])

        let summary = QuickCaptureOutboxDrainer(outbox: outbox).drain(
            workspace: workspace(), client: client)

        XCTAssertEqual(summary.savedItems.count, 1)
        XCTAssertEqual(client.requests.first?.folderId, "bookmarks-folder")
        XCTAssertTrue(record.markdown.contains("kind: bookmark"))
    }

    func testCaptureChoosesShallowestDeterministicFolder() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        try outbox.enqueue(
            QuickCaptureContent(title: "Fast note", body: "Keep this"),
            id: "shallow-capture")
        let client = QuickCaptureSyncClient(results: [
            .success(.saved(savedItem(id: "note-shallow")))
        ])
        let folders = [
            WorkspaceFolder(
                id: "nested-notes", name: "Notes", path: "Projects/Notes",
                mode: "notes", parentId: "projects"),
            WorkspaceFolder(
                id: "z-notes", name: "Z Notes", path: "Z Notes",
                mode: "notes", parentId: nil),
            WorkspaceFolder(
                id: "a-notes", name: "A Notes", path: "A Notes",
                mode: "notes", parentId: nil),
        ]
        let target = Workspace(
            blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil),
            folders: folders)

        _ = QuickCaptureOutboxDrainer(outbox: outbox).drain(
            workspace: target, client: client)

        XCTAssertEqual(client.requests.first?.folderId, "a-notes")
    }

    func testPermanentFailureDeadLettersAfterBoundedAttempts() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        try outbox.enqueue(
            QuickCaptureContent(title: "Keep me", body: "Recoverable bytes"),
            id: "bounded-retry")
        let client = QuickCaptureSyncClient(results: Array(
            repeating: .failure(.badResponse("permanent failure")),
            count: 5))
        let drainer = QuickCaptureOutboxDrainer(outbox: outbox)

        for attempt in 1...5 {
            let summary = drainer.drain(workspace: workspace(), client: client)
            XCTAssertEqual(summary.shouldRetry, attempt < 5)
        }

        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(outbox.rejectedRecordCount(), 1)
        let rejected = try FileManager.default.contentsOfDirectory(
            at: outbox.rejectedDirectory,
            includingPropertiesForKeys: nil)
        let data = try Data(contentsOf: try XCTUnwrap(rejected.first))
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("Recoverable bytes"))
        XCTAssertTrue(text.contains("permanent failure"))
        XCTAssertTrue(text.contains("\"attempts\" : 5"))
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

    func testFailedCapturesCanBeReviewedAndRestoredWithStableIdentity() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let original = try outbox.enqueue(
            QuickCaptureContent(title: "Bring this back", body: "Still valuable"),
            id: "recoverable-capture"
        )
        let client = QuickCaptureSyncClient(results: [
            .success(.rejected("invalid folder"))
        ])

        _ = QuickCaptureOutboxDrainer(outbox: outbox).drain(
            workspace: workspace(), client: client)

        let failed = try XCTUnwrap(outbox.rejectedRecords().first)
        XCTAssertEqual(failed.id, original.id)
        XCTAssertEqual(failed.title, "Bring this back")
        XCTAssertEqual(failed.body, "Still valuable")

        XCTAssertEqual(try outbox.retryRejectedRecords(), 1)
        XCTAssertTrue(outbox.rejectedRecords().isEmpty)
        let restored = try XCTUnwrap(outbox.pendingRecords().first)
        XCTAssertEqual(restored.idempotencyKey, original.idempotencyKey)
        XCTAssertEqual(restored.attempts, 0)
        XCTAssertNil(restored.lastError)
    }

    func testQuickCaptureFeedbackUsesTruthfulDeliveryLanguage() {
        XCTAssertEqual(QuickCaptureFeedback.ready.title, "Ready to capture")
        let receipt = QuickCaptureSavedReceipt(
            itemId: "note-1", title: "Field note", folderPath: "Notes",
            slug: "field-note", kind: "note")
        XCTAssertEqual(
            QuickCaptureFeedback.saved([receipt]).title,
            "Saved Field note to Notes")
        XCTAssertEqual(QuickCaptureFeedback.queued(1).title, "Queued safely")
        XCTAssertEqual(QuickCaptureFeedback.failed(0).title, "Capture failed")
        XCTAssertEqual(QuickCaptureFeedback.failed(1).title, "Failed capture")
        XCTAssertEqual(QuickCaptureFeedback.failed(3).title, "Failed captures (3)")
        XCTAssertEqual(QuickCaptureFeedback.queued(2).symbolName, "clock.arrow.circlepath")
    }

    func testCachedWorkspaceRejectionCanRetryWithFreshFolder() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        try outbox.enqueue(
            QuickCaptureContent(title: "Fresh folder", body: "Keep me"),
            id: "stale-folder")
        let client = QuickCaptureSyncClient(results: [
            .success(.rejected("folder not found")),
            .success(.saved(savedItem(id: "note-fresh"))),
        ])
        let drainer = QuickCaptureOutboxDrainer(outbox: outbox)

        let cached = drainer.drain(
            workspace: workspace(notesFolderId: "stale-notes"),
            client: client,
            deferRejections: true)
        XCTAssertTrue(cached.shouldRetry)
        XCTAssertEqual(outbox.pendingRecords().first?.attempts, 1)

        let fresh = drainer.drain(workspace: workspace(), client: client)
        XCTAssertFalse(fresh.shouldRetry)
        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(
            client.requests.map(\.folderId),
            ["stale-notes", "notes-folder"])
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
    let representation: TextTextFileRepresentation
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
        representation: TextTextFileRepresentation,
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

private func workspace(notesFolderId: String = "notes-folder") -> Workspace {
    Workspace(
        blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil),
        folders: [
            WorkspaceFolder(
                id: "blog-folder", name: "Blog", path: "Blog",
                mode: "blog", parentId: nil),
            WorkspaceFolder(
                id: notesFolderId, name: "Notes", path: "Notes",
                mode: "notes", parentId: nil),
            WorkspaceFolder(
                id: "bookmarks-folder", name: "Bookmarks", path: "Bookmarks",
                mode: "bookmarks", parentId: nil),
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
