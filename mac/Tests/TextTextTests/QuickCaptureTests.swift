import AppKit
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
        XCTAssertEqual(note.content.body, "Keep the first run tiny.")
        XCTAssertEqual(
            note.rawValue,
            "A launch thought\n\nKeep the first run tiny.")
    }

    func testQuickCaptureKeyboardMatchesBrowserComposer() {
        XCTAssertEqual(
            QuickCaptureKeyAction.resolve(
                keyCode: 36, modifiers: [], hasMarkedText: false),
            .save)
        XCTAssertEqual(
            QuickCaptureKeyAction.resolve(
                keyCode: 76, modifiers: [.command], hasMarkedText: false),
            .save)
        XCTAssertEqual(
            QuickCaptureKeyAction.resolve(
                keyCode: 36, modifiers: [.shift], hasMarkedText: false),
            .newline)
        XCTAssertEqual(
            QuickCaptureKeyAction.resolve(
                keyCode: 36, modifiers: [], hasMarkedText: true),
            .forward)
        XCTAssertEqual(
            QuickCaptureKeyAction.resolve(
                keyCode: 53, modifiers: [], hasMarkedText: true),
            .forward)
        XCTAssertEqual(
            QuickCaptureKeyAction.resolve(
                keyCode: 53, modifiers: [], hasMarkedText: false),
            .dismiss)
    }

    func testOutboxRetainsExactRawInputForRecovery() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let raw = "  A launch thought\n\nKeep the first run tiny.  "
        let intent = try XCTUnwrap(QuickCaptureIntent(raw))

        let record = try outbox.enqueue(intent, id: "raw-capture")
        let reopened = try QuickCaptureOutbox(baseDirectory: root)

        XCTAssertEqual(record.raw, raw.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertEqual(reopened.pendingRecords().first?.raw, record.raw)
        XCTAssertFalse(record.raw.contains("A launch thought\n\nA launch thought"))
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
        let receipt = try XCTUnwrap(outbox.recentSavedReceipts().first)
        XCTAssertEqual(receipt.itemId, "note-1")
        XCTAssertEqual(receipt.folderPath, "Notes")
        XCTAssertEqual(receipt.workspaceHandle, "demo")
        XCTAssertEqual(receipt.hash, "hash")
        XCTAssertTrue(receipt.canUndo)
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

    func testFailedCapturesCanBeRetriedOrDiscardedIndividually() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        try outbox.enqueue(
            QuickCaptureContent(title: "Retry this", body: "First"),
            id: "retry-one")
        try outbox.enqueue(
            QuickCaptureContent(title: "Discard this", body: "Second"),
            id: "discard-one")
        let client = QuickCaptureSyncClient(results: [
            .success(.rejected("invalid first")),
            .success(.rejected("invalid second")),
        ])

        _ = QuickCaptureOutboxDrainer(outbox: outbox).drain(
            workspace: workspace(), client: client)

        XCTAssertEqual(outbox.rejectedRecordCount(), 2)
        XCTAssertTrue(try outbox.retryRejectedRecord(id: "retry-one"))
        XCTAssertEqual(
            outbox.pendingRecords().first?.idempotencyKey,
            "quick-capture:retry-one")
        XCTAssertTrue(try outbox.discardRejectedRecord(id: "discard-one"))
        XCTAssertTrue(outbox.rejectedRecords().isEmpty)
        XCTAssertFalse(try outbox.discardRejectedRecord(id: "missing"))
    }

    func testRecentSavedReceiptsAreBoundedAndSurviveRelaunch() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        for index in 0..<8 {
            try outbox.recordSavedReceipt(QuickCaptureSavedReceipt(
                itemId: "note-\(index)",
                title: "Note \(index)",
                folderPath: "Notes",
                slug: "note-\(index)",
                kind: "note",
                savedAt: Date(timeIntervalSince1970: TimeInterval(index))))
        }

        let reopened = try QuickCaptureOutbox(baseDirectory: root)
        let receipts = reopened.recentSavedReceipts()

        XCTAssertEqual(receipts.count, 6)
        XCTAssertEqual(receipts.map(\.itemId), [
            "note-7", "note-6", "note-5", "note-4", "note-3", "note-2",
        ])
    }

    func testUndoUsesServerRevisionAndRemovesOnlyConfirmedReceipt() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let receipt = QuickCaptureSavedReceipt(
            itemId: "note-undo",
            title: "Undo me",
            folderPath: "Notes",
            slug: "undo-me",
            kind: "note",
            workspaceHandle: "demo",
            hash: "captured-hash")
        try outbox.recordSavedReceipt(receipt)
        let client = QuickCaptureSyncClient(
            results: [],
            workspaceResult: .success((workspace(), Data())),
            deleteResults: [.success(())])

        let result = QuickCaptureUndoer(outbox: outbox).undo(
            receipt, workspaceHandle: "demo", client: client)

        guard case .success = result else {
            return XCTFail("Expected server-confirmed Undo")
        }
        XCTAssertEqual(client.deleteRequests.count, 1)
        XCTAssertEqual(client.deleteRequests.first?.postId, "note-undo")
        XCTAssertEqual(client.deleteRequests.first?.hash, "captured-hash")
        XCTAssertTrue(outbox.recentSavedReceipts().isEmpty)
    }

    func testUndoFailureKeepsReceiptAndCrossWorkspaceUndoNeverCallsServer() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let receipt = QuickCaptureSavedReceipt(
            itemId: "note-keep",
            title: "Keep me",
            folderPath: "Notes",
            slug: "keep-me",
            kind: "note",
            workspaceHandle: "personal",
            hash: "captured-hash")
        try outbox.recordSavedReceipt(receipt)
        let client = QuickCaptureSyncClient(
            results: [],
            workspaceResult: .success((workspace(handle: "personal"), Data())),
            deleteResults: [.failure(.network("offline"))])

        guard case .failure(.workspaceMismatch) = QuickCaptureUndoer(
            outbox: outbox
        ).undo(receipt, workspaceHandle: "work", client: client) else {
            return XCTFail("Expected cross-workspace Undo to fail closed")
        }
        XCTAssertTrue(client.deleteRequests.isEmpty)
        guard case .failure(.server(let message)) = QuickCaptureUndoer(
            outbox: outbox
        ).undo(receipt, workspaceHandle: "personal", client: client) else {
            return XCTFail("Expected server failure")
        }
        XCTAssertEqual(message, "network: offline")
        XCTAssertEqual(outbox.recentSavedReceipts().first?.itemId, "note-keep")
    }

    func testUndoRequiresCredentialWorkspaceToMatchReceiptBeforeDelete() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let receipt = QuickCaptureSavedReceipt(
            itemId: "note-account-a",
            title: "Account A note",
            folderPath: "Notes",
            slug: "account-a-note",
            kind: "note",
            workspaceHandle: "account-a",
            hash: "captured-hash")
        try outbox.recordSavedReceipt(receipt)
        let client = QuickCaptureSyncClient(
            results: [],
            workspaceResult: .success((workspace(handle: "account-b"), Data())),
            deleteResults: [.success(())])

        guard case .failure(.workspaceMismatch) = QuickCaptureUndoer(
            outbox: outbox
        ).undo(receipt, workspaceHandle: "account-a", client: client) else {
            return XCTFail("Expected authenticated workspace mismatch")
        }
        XCTAssertTrue(client.deleteRequests.isEmpty)
        XCTAssertEqual(
            outbox.recentSavedReceipts(workspaceHandle: "account-a").first?.itemId,
            "note-account-a")
    }

    func testCaptureNeverCrossesIntoAnotherWorkspace() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        let intent = try XCTUnwrap(QuickCaptureIntent("Private field note"))
        let record = try outbox.enqueue(
            intent, id: "workspace-bound", workspaceHandle: "personal")
        let client = QuickCaptureSyncClient(results: [
            .success(.saved(savedItem(id: "note-personal"))),
        ])
        let drainer = QuickCaptureOutboxDrainer(outbox: outbox)

        let deferred = drainer.drain(
            workspace: workspace(handle: "work"), client: client)

        XCTAssertFalse(deferred.shouldRetry)
        XCTAssertEqual(deferred.deferredMessages.count, 1)
        XCTAssertTrue(client.requests.isEmpty)
        XCTAssertEqual(outbox.pendingRecords().first?.id, record.id)
        XCTAssertEqual(outbox.pendingRecords().first?.attempts, 0)

        let saved = drainer.drain(
            workspace: workspace(handle: "personal"), client: client)

        XCTAssertEqual(saved.savedItems.first?.id, "note-personal")
        XCTAssertTrue(outbox.pendingRecords().isEmpty)
        XCTAssertEqual(
            outbox.recentSavedReceipts(workspaceHandle: "personal").first?.itemId,
            "note-personal")
        XCTAssertTrue(
            outbox.recentSavedReceipts(workspaceHandle: "work").isEmpty)
    }

    func testReceiptWindowIsIndependentForEachWorkspace() throws {
        let root = try temporaryDirectory()
        let outbox = try QuickCaptureOutbox(baseDirectory: root)
        for handle in ["personal", "work"] {
            for index in 0..<7 {
                try outbox.recordSavedReceipt(QuickCaptureSavedReceipt(
                    itemId: "\(handle)-\(index)",
                    title: "Note \(index)",
                    folderPath: "Notes",
                    slug: "note-\(index)",
                    kind: "note",
                    savedAt: Date(timeIntervalSince1970: TimeInterval(index)),
                    workspaceHandle: handle))
            }
        }

        let reopened = try QuickCaptureOutbox(baseDirectory: root)
        XCTAssertEqual(
            reopened.recentSavedReceipts(workspaceHandle: "personal").count,
            6)
        XCTAssertEqual(
            reopened.recentSavedReceipts(workspaceHandle: "work").count,
            6)
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
        XCTAssertEqual(
            QuickCaptureFeedback.undone("Field note").title,
            "Undid capture Field note")
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

private struct QuickCaptureDeleteRequest {
    let postId: String
    let hash: String?
}

private final class QuickCaptureSyncClient: SyncClient {
    var results: [Result<SaveReply, ClientFailure>]
    var requests: [QuickCaptureRequest] = []
    var workspaceResult: Result<(Workspace, Data), ClientFailure>
    var deleteResults: [Result<Void, ClientFailure>]
    var deleteRequests: [QuickCaptureDeleteRequest] = []

    init(
        results: [Result<SaveReply, ClientFailure>],
        workspaceResult: Result<(Workspace, Data), ClientFailure> =
            .failure(.badResponse("unused")),
        deleteResults: [Result<Void, ClientFailure>] = []
    ) {
        self.results = results
        self.workspaceResult = workspaceResult
        self.deleteResults = deleteResults
    }

    func workspace() -> Result<(Workspace, Data), ClientFailure> {
        workspaceResult
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
        deleteRequests.append(QuickCaptureDeleteRequest(
            postId: postId, hash: hash))
        guard !deleteResults.isEmpty else {
            return .failure(.badResponse("unused"))
        }
        return deleteResults.removeFirst()
    }

}

private func workspace(
    notesFolderId: String = "notes-folder",
    handle: String = "demo"
) -> Workspace {
    Workspace(
        blog: WorkspaceBlog(handle: handle, name: "Demo", username: nil),
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
