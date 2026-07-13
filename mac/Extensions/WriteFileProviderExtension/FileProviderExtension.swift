import FileProvider
import Foundation
import os
import WriteFileProviderKit
import WriteFileProviderBridge

/// Diagnostics for a subsystem that can only be observed through the unified log
/// (the extension runs inside fileproviderd, not a window). Read with:
///   log show --last 15m --predicate 'subsystem == "net.writeapp.write"'
let fpLog = Logger(subsystem: "net.writeapp.write", category: "fileprovider")

/// Write's replicated File Provider. A single "Write" domain spans every
/// workspace the user has joined: the root lists one folder per workspace, and
/// inside each are that workspace's system folders and posts. Every folder/file
/// identifier is scoped by the workspace HANDLE, so the extension reads the
/// handle out of the identifier and resolves that workspace's token from the
/// handoff. The server (write.ramine.net) stays the source of truth.
///
/// The API client is resolved per request from the shared keychain handoff (so a
/// sign-in after launch is picked up without relaunch) via `apiFactory`, which
/// tests override to inject a fake.
public final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {

    private let domain: NSFileProviderDomain
    private let apiFactory: (String) -> WriteSyncAPI?

    public required convenience init(domain: NSFileProviderDomain) {
        self.init(domain: domain, apiFactory: { FileProviderExtension.handoffAPI(for: $0) })
    }

    /// Test seam: inject the API (keyed by workspace handle) instead of reading
    /// the shared keychain handoff.
    init(domain: NSFileProviderDomain, apiFactory: @escaping (String) -> WriteSyncAPI?) {
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
        switch wid {
        case .rootContainer, .workingSet, .trashContainer:
            completionHandler(Self.syntheticRootItem(name: domain.displayName), nil)
            return progress
        case .workspace(let handle):
            guard let descriptor = handoffDescriptors().first(where: { $0.handle == handle }) else {
                completionHandler(nil, Self.fpError(.noSuchItem)); return progress
            }
            completionHandler(WriteFileProviderItem(WriteItemMapper.workspaceItem(
                handle: handle, name: descriptor.name, readOnly: false)), nil)
            return progress
        case .folder(let handle, _), .file(let handle, _):
            guard let api = apiFactory(handle) else {
                completionHandler(nil, Self.fpError(.notAuthenticated)); return progress
            }
            let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
            Task {
                switch await core.item(for: wid) {
                case .success(let item): completionHandler(WriteFileProviderItem(item), nil)
                case .failure(let error): completionHandler(nil, Self.nsError(from: error))
                }
                progress.completedUnitCount = 1
            }
            return progress
        }
    }

    // MARK: Content materialization

    public func fetchContents(
        for itemIdentifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion?,
        request: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, (any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        guard case .file(let handle, let postId)? = WriteItemIdentifier(itemIdentifier) else {
            completionHandler(nil, nil, Self.fpError(.noSuchItem))
            return progress
        }
        guard let api = apiFactory(handle) else {
            completionHandler(nil, nil, Self.fpError(.notAuthenticated))
            return progress
        }
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        let tempDir = fpTemporaryDirectory()
        Task {
            let itemResult = await core.item(for: .file(handle: handle, id: postId))
            switch await api.fileText(postId: postId) {
            case .failure(let error):
                fpLog.error("fetchContents \(postId, privacy: .public) failed: \(String(describing: error), privacy: .public)")
                completionHandler(nil, nil, Self.nsError(from: error))
            case .success(let content):
                guard let dir = tempDir else {
                    fpLog.error("fetchContents \(postId, privacy: .public): no temp dir")
                    completionHandler(nil, nil, Self.fpError(.serverUnreachable)); return
                }
                let bytes = Data(content.text.utf8)
                let destination = dir.appendingPathComponent(UUID().uuidString)
                do { try bytes.write(to: destination) }
                catch {
                    fpLog.error("fetchContents \(postId, privacy: .public) write failed: \(String(describing: error), privacy: .public)")
                    completionHandler(nil, nil, error); return
                }
                fpLog.info("fetchContents \(postId, privacy: .public) delivered \(bytes.count) bytes")
                // The returned item MUST describe the bytes just written: its hash
                // (the GET body and its ETag are one consistent snapshot; a stale
                // manifest hash would make the next edit send a wrong If-Match and
                // falsely conflict) AND its size (the system uses documentSize as
                // the content length, so the enumeration-time nil would materialize
                // a zero-byte file even though these bytes are real).
                let item = (try? itemResult.get())
                    .map { $0.withContent(hash: content.hash, size: bytes.count) }
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
        switch wid {
        case .rootContainer:
            // The only cross-workspace container: one folder per workspace.
            return WorkspaceListEnumerator(descriptors: handoffDescriptors())
        case .workingSet:
            return AggregateWorkingSetEnumerator(
                descriptors: handoffDescriptors(), apiFactory: apiFactory)
        case .trashContainer:
            return EmptyEnumerator()
        case .workspace(let handle), .folder(let handle, _):
            guard let api = apiFactory(handle) else { throw Self.fpError(.notAuthenticated) }
            return WriteEnumeratorAdapter(
                container: wid, core: makeCore(api, handle: handle, name: descriptorName(for: handle)))
        case .file:
            throw Self.fpError(.noSuchItem)
        }
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
        guard case .folder(let handle, let parentId)? = WriteItemIdentifier(itemTemplate.parentItemIdentifier) else {
            // New items must land inside a workspace folder (the root holds the
            // workspace containers, and a workspace holds only its system folders).
            done(nil, Self.readOnlyError()); return progress
        }
        guard let api = apiFactory(handle) else { done(nil, Self.fpError(.notAuthenticated)); return progress }
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
                        WriteItemMapper.item(for: folder, handle: handle, readOnly: false)), nil)
                case .failure(let error): done(nil, Self.nsError(from: error))
                }
            } else {
                let body = url.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
                switch await api.createFile(body: body, folderId: parentId, idempotencyKey: idempotencyKey) {
                case .failure(let error): done(nil, Self.nsError(from: error))
                case .success(let created):
                    // Title the new post from the Finder filename (the filename IS
                    // the title now, not the slug). Leave the slug/URL to the
                    // server. Skip the PATCH when the title already matches.
                    let title = WriteFilename.titleFromFilename(filename)
                    guard let id = created.id, !title.isEmpty, created.title != title else {
                        done(Self.fileItem(created, parentId: parentId, handle: handle), nil); return
                    }
                    switch await api.patchFile(postId: id, folderId: nil, slug: nil, title: title, ifMatch: created.hash) {
                    case .success(let renamed): done(Self.fileItem(renamed, parentId: parentId, handle: handle), nil)
                    case .failure: done(Self.fileItem(created, parentId: parentId, handle: handle), nil) // keep the create
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
        guard case .file(let handle, let postId)? = WriteItemIdentifier(item.itemIdentifier) else {
            // Folder rename is the only folder mutation supported.
            if case .folder(let handle, let folderId)? = WriteItemIdentifier(item.itemIdentifier),
               changedFields.contains(.filename), let api = apiFactory(handle) {
                Task {
                    switch await api.renameFolder(folderId: folderId, name: item.filename) {
                    case .success(let folder):
                        done(WriteFileProviderItem(
                            WriteItemMapper.item(for: folder, handle: handle, readOnly: false)), nil)
                    case .failure(let error): done(nil, Self.nsError(from: error))
                    }
                }
                return progress
            }
            done(nil, Self.readOnlyError()); return progress
        }
        guard let api = apiFactory(handle) else { done(nil, Self.fpError(.notAuthenticated)); return progress }
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
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
            // 2) Move and/or retitle in one PATCH. A Finder rename changes the
            // TITLE (the filename is the title), never the slug/URL.
            let newFolderId: String? = changedFields.contains(.parentItemIdentifier)
                ? { if case .folder(_, let f)? = WriteItemIdentifier(item.parentItemIdentifier) { return f }; return nil }()
                : nil
            let newTitle: String? = changedFields.contains(.filename)
                ? WriteFilename.titleFromFilename(item.filename) : nil
            if newFolderId != nil || (newTitle != nil && !(newTitle!.isEmpty)) {
                var result = await api.patchFile(
                    postId: postId, folderId: newFolderId, slug: nil, title: newTitle, ifMatch: patchBaseHash)
                // If the base hash was stale (a metadata change landed since this
                // item was enumerated), the If-Match 412s. Re-fetch the current
                // hash and retry ONCE without a stale guard so a rename is not
                // wedged; the server's revision CAS still makes the write atomic.
                if case .failure(.conflict) = result {
                    let fresh = (try? await core.item(for: .file(handle: handle, id: postId)).get())?.contentHash
                    result = await api.patchFile(
                        postId: postId, folderId: newFolderId, slug: nil, title: newTitle, ifMatch: fresh)
                }
                if case .failure(let e) = result {
                    done(nil, Self.nsError(from: e)); return
                }
            }
            // Return the item's current server state.
            switch await core.item(for: .file(handle: handle, id: postId)) {
            case .success(let updated):
                fpLog.info("modifyItem \(postId, privacy: .public) saved to server")
                done(WriteFileProviderItem(updated), nil)
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
        guard case .file(let handle, let postId)? = WriteItemIdentifier(identifier) else {
            done(Self.readOnlyError()); return progress
        }
        guard let api = apiFactory(handle) else { done(Self.fpError(.notAuthenticated)); return progress }
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

    /// Build the live client for a workspace handle from the shared keychain
    /// handoff. nil = not signed in for that workspace (or at all).
    static func handoffAPI(for handle: String) -> WriteSyncAPI? {
        guard let handoff = FileProviderHandoffStore.load(),
              let descriptor = handoff.descriptor(for: handle),
              let origin = URL(string: descriptor.origin) else { return nil }
        return LiveWriteSyncAPI(origin: origin, token: descriptor.token)
    }

    /// The workspaces the app has handed off (one folder each under the root).
    private func handoffDescriptors() -> [FileProviderWorkspace] {
        FileProviderHandoffStore.load()?.workspaces ?? []
    }

    private func descriptorName(for handle: String) -> String {
        handoffDescriptors().first(where: { $0.handle == handle })?.name ?? handle
    }

    private func makeCore(_ api: WriteSyncAPI, handle: String, name: String) -> WorkspaceEnumerator {
        WorkspaceEnumerator(
            api: api, handle: handle, workspaceName: name,
            readOnly: false, domainName: domain.displayName)
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
        // Only orphans from a previous run. A fresh extension instance can be
        // created while another is mid fetchContents; deleting ALL temp files
        // (the old behavior) could remove a just-written body before the system
        // consumes it, materializing a zero-byte file. Keep anything recent.
        guard let dir = fpTemporaryDirectory(),
              let entries = try? FileManager.default.contentsOfDirectory(
                  at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-600) // 10 minutes
        for entry in entries {
            let mtime = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate
            if let mtime, mtime > cutoff { continue }
            try? FileManager.default.removeItem(at: entry)
        }
    }

    private static func fileItem(_ entry: WriteManifestItem, parentId: String, handle: String) -> NSFileProviderItem? {
        WriteItemMapper.item(for: entry, inFolder: parentId, handle: handle, readOnly: false)
            .map(WriteFileProviderItem.init)
    }

    /// The synthetic domain-root item (its children are the workspace folders).
    private static func syntheticRootItem(name: String) -> WriteFileProviderItem {
        WriteFileProviderItem(WriteItem(
            identifier: .rootContainer, parentIdentifier: .rootContainer,
            filename: name, isFolder: true, kind: .folder,
            typeIdentifier: WriteItem.folderTypeIdentifier, serverId: nil,
            contentHash: nil, documentSize: nil, creationDate: nil,
            contentModificationDate: nil, capabilities: .readOnlyFolder))
    }

    private static func nsError(from error: WriteSyncError) -> NSError {
        // Every write failure (create/modify/delete) funnels through here; log it
        // so a broken write path is visible in the unified log.
        fpLog.error("sync write error: \(String(describing: error), privacy: .public)")
        return WriteEnumeratorAdapter.bridge(error)
    }

    private static func fpError(_ code: NSFileProviderError.Code) -> NSError {
        NSError(domain: NSFileProviderErrorDomain, code: code.rawValue)
    }

    private static func readOnlyError() -> NSError {
        NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError)
    }
}
