import FileProvider
import Foundation
import UniformTypeIdentifiers
import XCTest
@testable import TextTextFileProviderBridge
@testable import TextTextFileProviderExtensionCore
@testable import TextTextFileProviderKit

final class FinderReliabilitySoakTests: XCTestCase {
    func testDeterministicFinderLifecycleSoak() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "FinderReliabilitySoak-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let api = FinderSoakAPI()
        let iterationCount = 20

        for iteration in 0..<iterationCount {
            let initialBody = "# Draft \(iteration)\n\ncreated\n"
            let initialURL = try write(
                initialBody, named: "create-\(iteration).md", under: root)
            var providerExtension = makeExtension(api: api, temporaryRoot: root)
            let template = FinderSoakItem(
                identifier: "local-create-\(iteration)",
                parentIdentifier: "folder:demo:notes",
                filename: "Draft \(iteration).md")

            let created = await create(
                providerExtension, template: template, contents: initialURL)
            XCTAssertNil(created.error, "create \(iteration)")
            XCTAssertTrue(created.pendingFields.isEmpty, "create \(iteration)")
            XCTAssertFalse(created.shouldFetch, "create \(iteration)")
            var current = try XCTUnwrap(created.item)
            let postID = try XCTUnwrap(api.onlyPostID())
            XCTAssertEqual(api.body(postID), initialBody)

            let editedBody = "# Draft \(iteration)\n\nedited\n"
            let editedURL = try write(
                editedBody, named: "edit-\(iteration).md", under: root)
            let edited = await modify(
                providerExtension, item: current,
                baseVersion: try XCTUnwrap(current.itemVersion),
                changedFields: [.contents], contents: editedURL)
            XCTAssertNil(edited.error, "edit \(iteration)")
            current = try XCTUnwrap(edited.item)
            XCTAssertEqual(api.body(postID), editedBody)

            let renamedItem = FinderSoakItem(
                item: current, filename: "Renamed \(iteration).md")
            let renamed = await modify(
                providerExtension, item: renamedItem,
                baseVersion: try XCTUnwrap(current.itemVersion),
                changedFields: [.filename], contents: nil)
            XCTAssertNil(renamed.error, "rename \(iteration)")
            current = try XCTUnwrap(renamed.item)
            XCTAssertEqual(current.filename, "Renamed \(iteration).md")
            XCTAssertEqual(api.title(postID), "Renamed \(iteration)")

            let movedItem = FinderSoakItem(
                item: current,
                parentIdentifier: NSFileProviderItemIdentifier(
                    rawValue: "folder:demo:archive"))
            let moved = await modify(
                providerExtension, item: movedItem,
                baseVersion: try XCTUnwrap(current.itemVersion),
                changedFields: [.parentItemIdentifier], contents: nil)
            XCTAssertNil(moved.error, "move \(iteration)")
            current = try XCTUnwrap(moved.item)
            XCTAssertEqual(
                current.parentItemIdentifier.rawValue,
                "folder:demo:archive")
            XCTAssertEqual(api.folderID(postID), "archive")

            let offlineBody = "# Renamed \(iteration)\n\noffline edit\n"
            let offlineURL = try write(
                offlineBody, named: "offline-\(iteration).md", under: root)
            let bodyBeforeOfflineAttempt = api.body(postID)
            api.setOnline(false)
            providerExtension.invalidate()
            providerExtension = makeExtension(api: api, temporaryRoot: root)

            let offline = await modify(
                providerExtension, item: current,
                baseVersion: try XCTUnwrap(current.itemVersion),
                changedFields: [.contents], contents: offlineURL)
            XCTAssertEqual(offline.error?.domain, NSFileProviderErrorDomain)
            XCTAssertEqual(
                offline.error?.code,
                NSFileProviderError.serverUnreachable.rawValue)
            XCTAssertEqual(api.body(postID), bodyBeforeOfflineAttempt)

            api.setOnline(true)
            providerExtension.invalidate()
            providerExtension = makeExtension(api: api, temporaryRoot: root)
            let retried = await modify(
                providerExtension, item: current,
                baseVersion: try XCTUnwrap(current.itemVersion),
                changedFields: [.contents], contents: offlineURL)
            XCTAssertNil(retried.error, "offline retry \(iteration)")
            current = try XCTUnwrap(retried.item)
            XCTAssertEqual(api.body(postID), offlineBody)

            let restoredFilename = current.filename
            let restoredParent = current.parentItemIdentifier
            let deleted = await delete(
                providerExtension, identifier: current.itemIdentifier,
                baseVersion: try XCTUnwrap(current.itemVersion))
            XCTAssertNil(deleted, "delete \(iteration)")
            XCTAssertFalse(api.contains(postID))

            let createsBeforeRestore = api.statistics().creates
            XCTAssertTrue(api.restoreLastDeleted())
            providerExtension.invalidate()
            providerExtension = makeExtension(api: api, temporaryRoot: root)
            let restoredTemplate = FinderSoakItem(
                identifier: "restored-local-\(iteration)",
                parentIdentifier: restoredParent.rawValue,
                filename: restoredFilename)
            let restored = await create(
                providerExtension, template: restoredTemplate,
                contents: offlineURL, options: [.mayAlreadyExist])
            XCTAssertNil(restored.error, "restore \(iteration)")
            XCTAssertTrue(restored.pendingFields.isEmpty, "restore \(iteration)")
            XCTAssertFalse(restored.shouldFetch, "restore \(iteration)")
            XCTAssertEqual(api.statistics().creates, createsBeforeRestore)
            current = try XCTUnwrap(restored.item)
            XCTAssertEqual(current.itemIdentifier.rawValue, "file:demo:\(postID)")

            let fetched = await fetch(
                providerExtension, identifier: current.itemIdentifier)
            XCTAssertNil(fetched.error, "relaunch fetch \(iteration)")
            let fetchedURL = try XCTUnwrap(fetched.url)
            XCTAssertEqual(
                try String(contentsOf: fetchedURL, encoding: .utf8),
                offlineBody)
            current = try XCTUnwrap(fetched.item)

            let finalDelete = await delete(
                providerExtension, identifier: current.itemIdentifier,
                baseVersion: try XCTUnwrap(current.itemVersion))
            XCTAssertNil(finalDelete, "cleanup delete \(iteration)")
            XCTAssertFalse(api.contains(postID))
            providerExtension.invalidate()
        }

        XCTAssertEqual(
            api.statistics(),
            FinderSoakAPI.Statistics(
                creates: iterationCount,
                puts: iterationCount * 2,
                patches: iterationCount * 3,
                deletes: iterationCount * 2,
                restores: iterationCount))
    }

    private func makeExtension(
        api: FinderSoakAPI, temporaryRoot: URL
    ) -> FileProviderExtension {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(
                rawValue: "finder-reliability-soak"),
            displayName: "Finder Reliability Soak")
        let descriptors = [FileProviderWorkspace(
            name: "Demo", handle: "demo",
            origin: "https://example.test", token: "test-token")]
        return FileProviderExtension(
            domain: domain,
            apiFactory: { handle in handle == "demo" ? api : nil },
            descriptorsProvider: { descriptors },
            temporaryDirectoryProvider: { temporaryRoot })
    }

    private func write(
        _ text: String, named filename: String, under root: URL
    ) throws -> URL {
        let directory = root.appendingPathComponent("inputs", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(filename)
        try Data(text.utf8).write(to: url, options: .atomic)
        return url
    }

    private func create(
        _ providerExtension: FileProviderExtension,
        template: NSFileProviderItem,
        contents: URL,
        options: NSFileProviderCreateItemOptions = []
    ) async -> FinderSoakMutationResult {
        await withCheckedContinuation { continuation in
            _ = providerExtension.createItem(
                basedOn: template,
                fields: [.filename, .contents],
                contents: contents,
                options: options,
                request: NSFileProviderRequest()
            ) { item, pendingFields, shouldFetch, error in
                continuation.resume(returning: FinderSoakMutationResult(
                    item: item,
                    pendingFields: pendingFields,
                    shouldFetch: shouldFetch,
                    error: error as NSError?))
            }
        }
    }

    private func modify(
        _ providerExtension: FileProviderExtension,
        item: NSFileProviderItem,
        baseVersion: NSFileProviderItemVersion,
        changedFields: NSFileProviderItemFields,
        contents: URL?
    ) async -> FinderSoakMutationResult {
        await withCheckedContinuation { continuation in
            _ = providerExtension.modifyItem(
                item,
                baseVersion: baseVersion,
                changedFields: changedFields,
                contents: contents,
                options: [],
                request: NSFileProviderRequest()
            ) { item, pendingFields, shouldFetch, error in
                continuation.resume(returning: FinderSoakMutationResult(
                    item: item,
                    pendingFields: pendingFields,
                    shouldFetch: shouldFetch,
                    error: error as NSError?))
            }
        }
    }

    private func fetch(
        _ providerExtension: FileProviderExtension,
        identifier: NSFileProviderItemIdentifier
    ) async -> FinderSoakFetchResult {
        await withCheckedContinuation { continuation in
            _ = providerExtension.fetchContents(
                for: identifier,
                version: nil,
                request: NSFileProviderRequest()
            ) { url, item, error in
                continuation.resume(returning: FinderSoakFetchResult(
                    url: url, item: item, error: error as NSError?))
            }
        }
    }

    private func delete(
        _ providerExtension: FileProviderExtension,
        identifier: NSFileProviderItemIdentifier,
        baseVersion: NSFileProviderItemVersion
    ) async -> NSError? {
        await withCheckedContinuation { continuation in
            _ = providerExtension.deleteItem(
                identifier: identifier,
                baseVersion: baseVersion,
                options: [],
                request: NSFileProviderRequest()
            ) { error in
                continuation.resume(returning: error as NSError?)
            }
        }
    }
}

private struct FinderSoakMutationResult {
    let item: NSFileProviderItem?
    let pendingFields: NSFileProviderItemFields
    let shouldFetch: Bool
    let error: NSError?
}

private struct FinderSoakFetchResult {
    let url: URL?
    let item: NSFileProviderItem?
    let error: NSError?
}

private final class FinderSoakItem: NSObject, NSFileProviderItem {
    let itemIdentifier: NSFileProviderItemIdentifier
    let parentItemIdentifier: NSFileProviderItemIdentifier
    let filename: String
    let contentType: UTType

    init(
        identifier: String,
        parentIdentifier: String,
        filename: String,
        contentType: UTType = UTType(filenameExtension: "md") ?? .plainText
    ) {
        itemIdentifier = NSFileProviderItemIdentifier(rawValue: identifier)
        self.parentItemIdentifier = NSFileProviderItemIdentifier(
            rawValue: parentIdentifier)
        self.filename = filename
        self.contentType = contentType
    }

    init(
        item: NSFileProviderItem,
        parentIdentifier: NSFileProviderItemIdentifier? = nil,
        filename: String? = nil
    ) {
        itemIdentifier = item.itemIdentifier
        self.parentItemIdentifier = parentIdentifier
            ?? item.parentItemIdentifier
        self.filename = filename ?? item.filename
        contentType = item.contentType ?? .plainText
    }
}

private final class FinderSoakAPI: TextTextSyncAPI, @unchecked Sendable {
    struct Statistics: Equatable {
        var creates = 0
        var puts = 0
        var patches = 0
        var deletes = 0
        var restores = 0
    }

    private struct Record {
        var item: TextTextManifestItem
        var body: String
        var folderID: String
    }

    private let lock = NSLock()
    private var online = true
    private var revision = 0
    private var nextPostNumber = 0
    private var records: [String: Record] = [:]
    private var postIDsByIdempotencyKey: [String: String] = [:]
    private var lastDeleted: Record?
    private var counters = Statistics()

    private let workspaceValue = TextTextWorkspace(
        blog: TextTextWorkspaceBlog(
            handle: "demo", name: "Demo", username: "demo"),
        folders: [
            TextTextWorkspaceFolder(
                id: "notes", name: "Notes", path: "Notes",
                mode: "notes", parentId: nil),
            TextTextWorkspaceFolder(
                id: "archive", name: "Archive", path: "Archive",
                mode: "notes", parentId: nil),
        ])

    func setOnline(_ value: Bool) {
        withLock { online = value }
    }

    func onlyPostID() -> String? {
        withLock { records.keys.sorted().only }
    }

    func body(_ postID: String) -> String? {
        withLock { records[postID]?.body }
    }

    func title(_ postID: String) -> String? {
        withLock { records[postID]?.item.title }
    }

    func folderID(_ postID: String) -> String? {
        withLock { records[postID]?.folderID }
    }

    func contains(_ postID: String) -> Bool {
        withLock { records[postID] != nil }
    }

    func restoreLastDeleted() -> Bool {
        withLock {
            guard let lastDeleted, let postID = lastDeleted.item.id else {
                return false
            }
            records[postID] = lastDeleted
            counters.restores += 1
            return true
        }
    }

    func statistics() -> Statistics {
        withLock { counters }
    }

    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> {
        withLock {
            online
                ? .success(workspaceValue)
                : .failure(.network("offline"))
        }
    }

    func manifest(
        folderId: String
    ) async -> Result<[TextTextManifestItem], TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            return .success(records.values
                .filter { $0.folderID == folderId }
                .map(\.item)
                .sorted { ($0.id ?? "") < ($1.id ?? "") })
        }
    }

    func fileText(
        postId: String
    ) async -> Result<TextTextFileContent, TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            guard let record = records[postId] else {
                return .failure(.notFound)
            }
            return .success(TextTextFileContent(
                text: record.body, hash: record.item.hash))
        }
    }

    func changes(
        since cursor: String?, wait: Int
    ) async -> Result<TextTextChangeReply, TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            let current = "c\(revision)"
            return .success(TextTextChangeReply(
                cursor: current,
                changed: cursor.map { $0 != current } ?? false))
        }
    }

    func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await createFile(
            body: body,
            folderId: folderId,
            representation: .markdown,
            idempotencyKey: idempotencyKey)
    }

    func createFile(
        body: String,
        folderId: String?,
        representation: TextTextFileRepresentation,
        idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            if let idempotencyKey,
               let postID = postIDsByIdempotencyKey[idempotencyKey],
               let existing = records[postID] {
                return .success(existing.item)
            }

            nextPostNumber += 1
            let postID = "soak-\(nextPostNumber)"
            let hash = nextHashLocked()
            let item = makeItem(
                postID: postID,
                title: "Untitled",
                slug: postID,
                hash: hash,
                representation: representation,
                body: body)
            records[postID] = Record(
                item: item,
                body: body,
                folderID: folderId ?? "notes")
            if let idempotencyKey {
                postIDsByIdempotencyKey[idempotencyKey] = postID
            }
            counters.creates += 1
            return .success(item)
        }
    }

    func putFile(
        postId: String, body: String, ifMatch hash: String
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            guard var record = records[postId] else {
                return .failure(.notFound)
            }
            guard record.item.hash == hash else {
                return .failure(.conflict)
            }
            record.body = body
            record.item = makeItem(
                postID: postId,
                title: record.item.title,
                slug: record.item.slug,
                hash: nextHashLocked(),
                representation: record.item.representation,
                body: body)
            records[postId] = record
            counters.puts += 1
            return .success(record.item)
        }
    }

    func patchFile(
        postId: String,
        folderId: String?,
        slug: String?,
        title: String?,
        ifMatch hash: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            guard var record = records[postId] else {
                return .failure(.notFound)
            }
            if let hash, record.item.hash != hash {
                return .failure(.conflict)
            }
            if let folderId { record.folderID = folderId }
            record.item = makeItem(
                postID: postId,
                title: title ?? record.item.title,
                slug: slug ?? record.item.slug,
                hash: nextHashLocked(),
                representation: record.item.representation,
                body: record.body)
            records[postId] = record
            counters.patches += 1
            return .success(record.item)
        }
    }

    func deleteFile(
        postId: String, ifMatch hash: String?
    ) async -> Result<Void, TextTextSyncError> {
        withLock {
            guard online else { return .failure(.network("offline")) }
            guard let record = records[postId] else {
                return .failure(.notFound)
            }
            if let hash, record.item.hash != hash {
                return .failure(.conflict)
            }
            lastDeleted = record
            records.removeValue(forKey: postId)
            counters.deletes += 1
            return .success(())
        }
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        .failure(.rejected("not part of the file lifecycle soak"))
    }

    func renameFolder(
        folderId: String, name: String
    ) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
        .failure(.rejected("not part of the file lifecycle soak"))
    }

    func renameWorkspace(
        name: String
    ) async -> Result<TextTextWorkspaceBlog, TextTextSyncError> {
        .failure(.rejected("not part of the file lifecycle soak"))
    }

    private func makeItem(
        postID: String,
        title: String,
        slug: String,
        hash: String,
        representation: TextTextFileRepresentation,
        body: String
    ) -> TextTextManifestItem {
        TextTextManifestItem(
            file: slug + representation.filenameSuffix,
            representation: representation,
            kind: "note",
            slug: slug,
            title: title,
            status: "draft",
            hash: hash,
            id: postID,
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: nil,
            size: body.utf8.count)
    }

    private func nextHashLocked() -> String {
        revision += 1
        return "soak-h\(revision)"
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}

private extension Array {
    var only: Element? { count == 1 ? self[0] : nil }
}
