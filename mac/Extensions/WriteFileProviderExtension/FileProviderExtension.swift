import FileProvider
import Foundation
import WriteFileProviderKit
import WriteFileProviderBridge

/// Write's replicated File Provider. It enumerates the workspace from the
/// server, materializes file bodies on demand, and (Phase 3) writes edits,
/// creates, deletes, renames, and moves back through /api/sync/v1. The server
/// (write.ramine.net) stays the source of truth.
///
/// The API client is resolved per request from the shared app-group container
/// (so a sign-in after launch is picked up without relaunch) via `apiFactory`,
/// which tests override to inject a fake.
public final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {

    private let domain: NSFileProviderDomain
    private let apiFactory: () -> WriteSyncAPI?

    public required convenience init(domain: NSFileProviderDomain) {
        self.init(domain: domain, apiFactory: { FileProviderExtension.handoffAPI() })
    }

    /// Test seam: inject the API instead of reading the app-group container.
    init(domain: NSFileProviderDomain, apiFactory: @escaping () -> WriteSyncAPI?) {
        self.domain = domain
        self.apiFactory = apiFactory
        super.init()
        sweepStaleTemporaries()
    }

    public func invalidate() {
        // Nothing long-lived to tear down: the API client is re-created per
        // request and its URLSession is ephemeral.
    }

    // MARK: Metadata

    public func item(
        for identifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, (any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        guard let wid = WriteItemIdentifier(identifier) else {
            completionHandler(nil, Self.fpError(.noSuchItem))
            return progress
        }
        guard let api = apiFactory() else {
            completionHandler(nil, Self.fpError(.notAuthenticated))
            return progress
        }
        let core = makeEnumeratorCore(api)
        Task {
            switch await core.item(for: wid) {
            case .success(let item): completionHandler(WriteFileProviderItem(item), nil)
            case .failure(let error): completionHandler(nil, Self.nsError(from: error))
            }
            progress.completedUnitCount = 1
        }
        return progress
    }

    // MARK: Content materialization

    public func fetchContents(
        for itemIdentifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion?,
        request: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, (any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        guard case .file(let postId)? = WriteItemIdentifier(itemIdentifier) else {
            completionHandler(nil, nil, Self.fpError(.noSuchItem))
            return progress
        }
        guard let api = apiFactory() else {
            completionHandler(nil, nil, Self.fpError(.notAuthenticated))
            return progress
        }
        let core = makeEnumeratorCore(api)
        let tempDir = fpTemporaryDirectory()
        Task {
            let itemResult = await core.item(for: .file(postId))
            switch await api.fileText(postId: postId) {
            case .failure(let error):
                completionHandler(nil, nil, Self.nsError(from: error))
            case .success(let content):
                guard let dir = tempDir else {
                    completionHandler(nil, nil, Self.fpError(.serverUnreachable)); return
                }
                let destination = dir.appendingPathComponent(UUID().uuidString)
                do { try Data(content.text.utf8).write(to: destination) }
                catch { completionHandler(nil, nil, error); return }
                // The returned item's version MUST match the bytes just written,
                // not the (possibly newer) manifest hash: the GET body and its
                // ETag are one consistent snapshot. Labeling these bytes with a
                // stale manifest hash makes the next edit send a wrong If-Match
                // and falsely conflict.
                let item = (try? itemResult.get())
                    .map { $0.withContentHash(content.hash) }
                    .map(WriteFileProviderItem.init)
                completionHandler(destination, item, nil)
            }
            progress.completedUnitCount = 1
        }
        return progress
    }

    // MARK: Enumeration

    public func enumerator(
        for containerItemIdentifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest
    ) throws -> any NSFileProviderEnumerator {
        guard let wid = WriteItemIdentifier(containerItemIdentifier) else {
            throw Self.fpError(.noSuchItem)
        }
        guard let api = apiFactory() else { throw Self.fpError(.notAuthenticated) }
        return WriteEnumeratorAdapter(container: wid, core: makeEnumeratorCore(api))
    }

    // MARK: Create

    public func createItem(
        basedOn itemTemplate: NSFileProviderItem,
        fields: NSFileProviderItemFields,
        contents url: URL?,
        options: NSFileProviderCreateItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        let done: (NSFileProviderItem?, (any Error)?) -> Void = { item, error in
            completionHandler(item, [], false, error)
            progress.completedUnitCount = 1
        }
        guard case .folder(let parentId)? = WriteItemIdentifier(itemTemplate.parentItemIdentifier) else {
            // New items must land inside a workspace folder (root holds only the
            // system folders, which the app manages).
            done(nil, Self.readOnlyError()); return progress
        }
        guard let api = apiFactory() else { done(nil, Self.fpError(.notAuthenticated)); return progress }
        let isFolder = itemTemplate.contentType?.conforms(to: .folder) ?? false
        let filename = itemTemplate.filename
        // The template's itemIdentifier is stable across the framework's retries
        // of THIS create, so it is the right Idempotency-Key: a lost response
        // plus retry returns the original item instead of a duplicate.
        let idempotencyKey = itemTemplate.itemIdentifier.rawValue
        Task {
            if isFolder {
                guard let parentPath = await folderPath(of: parentId, api: api) else {
                    done(nil, Self.fpError(.noSuchItem)); return
                }
                switch await api.createFolder(parentPath: parentPath, name: filename, idempotencyKey: idempotencyKey) {
                case .success(let folder):
                    done(WriteFileProviderItem(
                        WriteItemMapper.item(for: folder, readOnly: false)), nil)
                case .failure(let error): done(nil, Self.nsError(from: error))
                }
            } else {
                let body = url.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
                switch await api.createFile(body: body, folderId: parentId, idempotencyKey: idempotencyKey) {
                case .failure(let error): done(nil, Self.nsError(from: error))
                case .success(let created):
                    // Give the new post the Finder-chosen name when the server's
                    // derived slug differs, so the file does not appear renamed.
                    let wanted = Self.slug(fromFilename: filename)
                    guard let id = created.id, !wanted.isEmpty, created.slug != wanted else {
                        done(Self.fileItem(created, parentId: parentId), nil); return
                    }
                    switch await api.patchFile(postId: id, folderId: nil, slug: wanted, ifMatch: created.hash) {
                    case .success(let renamed): done(Self.fileItem(renamed, parentId: parentId), nil)
                    case .failure: done(Self.fileItem(created, parentId: parentId), nil) // keep the create
                    }
                }
            }
        }
        return progress
    }

    // MARK: Modify (content edit, rename, move)

    public func modifyItem(
        _ item: NSFileProviderItem,
        baseVersion version: NSFileProviderItemVersion,
        changedFields: NSFileProviderItemFields,
        contents newContents: URL?,
        options: NSFileProviderModifyItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        let done: (NSFileProviderItem?, (any Error)?) -> Void = { item, error in
            completionHandler(item, [], false, error)
            progress.completedUnitCount = 1
        }
        guard case .file(let postId)? = WriteItemIdentifier(item.itemIdentifier) else {
            // Folder rename is the only folder mutation supported.
            if case .folder(let folderId)? = WriteItemIdentifier(item.itemIdentifier),
               changedFields.contains(.filename), let api = apiFactory() {
                Task {
                    switch await api.renameFolder(folderId: folderId, name: item.filename) {
                    case .success(let folder):
                        done(WriteFileProviderItem(
                            WriteItemMapper.item(for: folder, readOnly: false)), nil)
                    case .failure(let error): done(nil, Self.nsError(from: error))
                    }
                }
                return progress
            }
            done(nil, Self.readOnlyError()); return progress
        }
        guard let api = apiFactory() else { done(nil, Self.fpError(.notAuthenticated)); return progress }
        let core = makeEnumeratorCore(api)
        Task {
            // 1) Content edit: PUT with the base version's hash as If-Match. If
            // this fails, STOP: do not go on to rename/move, or a stale-content
            // conflict would still rename the file on the server while the edit
            // is lost. A 412 must surface as versionNoLongerAvailable so the
            // framework re-reads the current version and re-applies, rather than
            // looping on the same stale base hash.
            //
            // The rename/move PATCH must build on the bytes the PUT just wrote,
            // not the original base version: use the PUT's returned hash as the
            // PATCH If-Match so a concurrent metadata change slipping in between
            // the two requests conflicts (412) instead of being overwritten.
            let baseHash = String(decoding: version.contentVersion, as: UTF8.self)
            var patchBaseHash: String? = baseHash.isEmpty ? nil : baseHash
            if changedFields.contains(.contents) {
                let body = newContents.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
                switch await api.putFile(postId: postId, body: body, ifMatch: baseHash) {
                case .failure(let e): done(nil, Self.nsError(from: e)); return
                case .success(let saved): patchBaseHash = saved.hash
                }
            }
            // 2) Move and/or rename in one PATCH.
            let newFolderId: String? = changedFields.contains(.parentItemIdentifier)
                ? { if case .folder(let f)? = WriteItemIdentifier(item.parentItemIdentifier) { return f }; return nil }()
                : nil
            let newSlug: String? = changedFields.contains(.filename)
                ? Self.slug(fromFilename: item.filename) : nil
            if newFolderId != nil || (newSlug != nil && !(newSlug!.isEmpty)) {
                if case .failure(let e) = await api.patchFile(
                    postId: postId, folderId: newFolderId, slug: newSlug, ifMatch: patchBaseHash) {
                    done(nil, Self.nsError(from: e)); return
                }
            }
            // Return the item's current server state.
            switch await core.item(for: .file(postId)) {
            case .success(let updated): done(WriteFileProviderItem(updated), nil)
            case .failure(let error): done(nil, Self.nsError(from: error))
            }
        }
        return progress
    }

    // MARK: Delete

    public func deleteItem(
        identifier: NSFileProviderItemIdentifier,
        baseVersion version: NSFileProviderItemVersion,
        options: NSFileProviderDeleteItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping ((any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        let done: ((any Error)?) -> Void = { error in
            completionHandler(error); progress.completedUnitCount = 1
        }
        // Only files delete; folder delete is deferred (not advertised).
        guard case .file(let postId)? = WriteItemIdentifier(identifier) else {
            done(Self.readOnlyError()); return progress
        }
        guard let api = apiFactory() else { done(Self.fpError(.notAuthenticated)); return progress }
        // The base version's contentVersion IS the item's content hash bytes.
        // Sending it as If-Match gives stale-delete protection: the server 412s
        // if the row moved on underneath the deleting client.
        let hash = String(decoding: version.contentVersion, as: UTF8.self)
        let ifMatch = hash.isEmpty ? nil : hash
        Task {
            switch await api.deleteFile(postId: postId, ifMatch: ifMatch) {
            case .success: done(nil)
            case .failure(let error): done(Self.nsError(from: error))
            }
        }
        return progress
    }

    // MARK: Helpers

    /// Read the handoff from the shared keychain group and build the live client.
    /// nil = not signed in (the app has not published a token yet).
    static func handoffAPI() -> WriteSyncAPI? {
        guard let handoff = FileProviderHandoffStore.load(),
              let origin = URL(string: handoff.origin) else { return nil }
        return LiveWriteSyncAPI(origin: origin, token: handoff.token)
    }

    private func makeEnumeratorCore(_ api: WriteSyncAPI) -> WorkspaceEnumerator {
        WorkspaceEnumerator(api: api, readOnly: false, domainName: domain.displayName)
    }

    /// The path of a folder id (needed for createFolder, which takes a parent
    /// path). Resolved from the workspace listing.
    private func folderPath(of folderId: String, api: WriteSyncAPI) async -> String? {
        if case .success(let ws) = await api.workspace() {
            return ws.folders.first(where: { $0.id == folderId })?.path
        }
        return nil
    }

    private func fpTemporaryDirectory() -> URL? {
        try? NSFileProviderManager(for: domain)?.temporaryDirectoryURL()
    }

    private func sweepStaleTemporaries() {
        guard let dir = fpTemporaryDirectory(),
              let entries = try? FileManager.default.contentsOfDirectory(
                  at: dir, includingPropertiesForKeys: nil) else { return }
        for entry in entries { try? FileManager.default.removeItem(at: entry) }
    }

    private static func fileItem(_ entry: WriteManifestItem, parentId: String) -> NSFileProviderItem? {
        WriteItemMapper.item(for: entry, inFolder: parentId, readOnly: false)
            .map(WriteFileProviderItem.init)
    }

    /// Derive a slug from a Finder filename ("My Note.md" -> "my-note").
    static func slug(fromFilename filename: String) -> String {
        var base = filename
        if let dot = base.lastIndex(of: "."), base[base.index(after: dot)...].allSatisfy({ $0.isLetter }) {
            base = String(base[..<dot])
        }
        let lowered = base.lowercased()
        var out = ""
        var lastDash = false
        for scalar in lowered.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                out.unicodeScalars.append(scalar); lastDash = false
            } else if !lastDash {
                out.append("-"); lastDash = true
            }
        }
        return out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    private static func nsError(from error: WriteSyncError) -> NSError {
        WriteEnumeratorAdapter.bridge(error)
    }

    private static func fpError(_ code: NSFileProviderError.Code) -> NSError {
        NSError(domain: NSFileProviderErrorDomain, code: code.rawValue)
    }

    private static func readOnlyError() -> NSError {
        NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError)
    }
}
