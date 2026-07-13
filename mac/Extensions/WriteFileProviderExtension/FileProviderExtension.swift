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
    private let descriptorsProvider: () -> [FileProviderWorkspace]
    private let temporaryDirectoryProvider: (() -> URL?)?

    public required convenience init(domain: NSFileProviderDomain) {
        self.init(domain: domain, apiFactory: { FileProviderExtension.handoffAPI(for: $0) })
    }

    /// Test seam: inject the API (keyed by workspace handle) instead of reading
    /// the shared keychain handoff.
    init(
        domain: NSFileProviderDomain,
        apiFactory: @escaping (String) -> WriteSyncAPI?,
        descriptorsProvider: @escaping () -> [FileProviderWorkspace] = {
            FileProviderHandoffStore.load()?.workspaces ?? []
        },
        temporaryDirectoryProvider: (() -> URL?)? = nil
    ) {
        self.domain = domain
        self.apiFactory = apiFactory
        self.descriptorsProvider = descriptorsProvider
        self.temporaryDirectoryProvider = temporaryDirectoryProvider
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
            guard let item = WorkspaceListEnumerator.item(
                for: handle, in: handoffDescriptors()
            ) else {
                completionHandler(nil, Self.fpError(.noSuchItem)); return progress
            }
            completionHandler(WriteFileProviderItem(item), nil)
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
            defer { progress.completedUnitCount = 1 }
            switch await consistentFetch(postId: postId, core: core, api: api) {
            case .failure(let error):
                fpLog.error("fetchContents \(postId, privacy: .public) failed: \(String(describing: error), privacy: .public)")
                completionHandler(nil, nil, Self.nsError(from: error))
            case .success(let revision):
                let bytes = Data(revision.content.text.utf8)
                let item = WriteFileProviderItem(revision.item.withContent(
                    hash: revision.content.hash, size: bytes.count))
                if let requestedVersion,
                   !Self.requestedVersion(requestedVersion, matches: item.itemVersion) {
                    completionHandler(
                        nil, nil, Self.fpError(.versionNoLongerAvailable))
                    return
                }
                guard let dir = tempDir else {
                    fpLog.error("fetchContents \(postId, privacy: .public): no temp dir")
                    completionHandler(nil, nil, Self.fpError(.serverUnreachable)); return
                }
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
                completionHandler(destination, item, nil)
            }
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
                let folderName = WriteFilename.decodeComponent(filename)
                switch await api.createFolder(
                    parentPath: parentPath, name: folderName,
                    idempotencyKey: idempotencyKey
                ) {
                case .success(let folder):
                    done(WriteFileProviderItem(
                        WriteItemMapper.item(for: folder, handle: handle, readOnly: false)), nil)
                case .failure(let error): done(nil, Self.nsError(from: error))
                }
            } else {
                let body: String
                if let url {
                    do {
                        body = try String(contentsOf: url, encoding: .utf8)
                    } catch {
                        done(nil, Self.unreadableContentsError(error)); return
                    }
                } else {
                    // File Provider may create a genuinely empty document without
                    // supplying a contents URL. A supplied but unreadable URL is
                    // handled above and must never become an empty server write.
                    body = ""
                }
                switch await api.createFile(body: body, folderId: parentId, idempotencyKey: idempotencyKey) {
                case .failure(let error): done(nil, Self.nsError(from: error))
                case .success(let created):
                    // Title the new post from the Finder filename (the filename IS
                    // the title now, not the slug). Leave the slug/URL to the
                    // server. Skip the PATCH when the title already matches.
                    let title = WriteFilename.titleFromFilename(filename)
                    guard let id = created.id, !created.hash.isEmpty,
                          !title.isEmpty, created.title != title else {
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
        let finish: (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?
        ) -> Void = { item, pending, shouldFetch, error in
            completionHandler(item, pending, shouldFetch, error)
            progress.completedUnitCount = 1
        }
        let done: (NSFileProviderItem?, (any Error)?) -> Void = {
            finish($0, [], false, $1)
        }
        let fields = [
            changedFields.contains(.filename) ? "name" : nil,
            changedFields.contains(.parentItemIdentifier) ? "parent" : nil,
            changedFields.contains(.contents) ? "contents" : nil,
            changedFields.contains(.contentModificationDate) ? "mtime" : nil,
            changedFields.contains(.creationDate) ? "created" : nil,
            changedFields.contains(.lastUsedDate) ? "lastUsed" : nil,
        ].compactMap { $0 }.joined(separator: "+")
        fpLog.info("modifyItem \(item.itemIdentifier.rawValue, privacy: .public) fields=[\(fields, privacy: .public)] name='\(item.filename, privacy: .public)'")
        guard case .file(let handle, let postId)? = WriteItemIdentifier(item.itemIdentifier) else {
            // Finder changes a directory's local mtime when its children are
            // materialized or edited. File Provider reports that as a metadata
            // upload even though Write has no server-side directory mtime. It
            // must be acknowledged, otherwise macOS retries it forever and
            // draws a cloud error badge on an otherwise fully synced folder.
            // Renames remain the only container field sent to the server;
            // moves and content changes are still rejected below.
            guard changedFields.subtracting(Self.supportedContainerFields).isEmpty else {
                done(nil, Self.readOnlyError()); return progress
            }
            if case .folder(let handle, let folderId)? = WriteItemIdentifier(item.itemIdentifier),
               let api = apiFactory(handle) {
                let identifier = WriteItemIdentifier.folder(handle: handle, id: folderId)
                let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
                Task {
                    let current: WriteItem
                    switch await core.item(for: identifier) {
                    case .failure(let error): done(nil, Self.nsError(from: error)); return
                    case .success(let value): current = value
                    }
                    guard changedFields.contains(.filename) else {
                        fpLog.info("modifyItem folder \(folderId, privacy: .public) acknowledged local metadata")
                        done(WriteFileProviderItem(current), nil)
                        return
                    }
                    guard Self.metadataBase(version, matches: current) else {
                        finishModifyConflict(
                            current: current, changedFields: changedFields,
                            options: options, finish: finish)
                        return
                    }
                    guard item.filename != current.filename else {
                        done(WriteFileProviderItem(current), nil)
                        return
                    }
                    let suffix = WriteFilename.collisionSuffix(folderId)
                    var component = item.filename
                    if component.hasSuffix(suffix) { component.removeLast(suffix.count) }
                    let folderName = WriteFilename.decodeComponent(component)
                    switch await api.renameFolder(folderId: folderId, name: folderName) {
                    case .success(let folder):
                        fpLog.info("modifyItem folder \(folderId, privacy: .public) renamed to '\(folder.name, privacy: .public)'")
                        done(WriteFileProviderItem(
                            WriteItemMapper.item(for: folder, handle: handle, readOnly: false)), nil)
                    case .failure(.conflict):
                        await resolveModifyConflict(
                            identifier: identifier, core: core,
                            changedFields: changedFields, options: options,
                            finish: finish)
                    case .failure(let error): done(nil, Self.nsError(from: error))
                    }
                }
                return progress
            }
            // Renaming the workspace container renames the workspace itself (its
            // display name). Decode the portable Finder component before sending
            // the human label back to the server.
            if case .workspace(let handle)? = WriteItemIdentifier(item.itemIdentifier),
               let api = apiFactory(handle) {
                Task {
                    let current: WriteItem
                    switch await currentWorkspaceItem(handle: handle, api: api) {
                    case .failure(let error): done(nil, Self.nsError(from: error)); return
                    case .success(let value): current = value
                    }
                    guard changedFields.contains(.filename) else {
                        fpLog.info("modifyItem workspace \(handle, privacy: .public) acknowledged local metadata")
                        done(WriteFileProviderItem(current), nil)
                        return
                    }
                    guard Self.metadataBase(version, matches: current) else {
                        finishModifyConflict(
                            current: current, changedFields: changedFields,
                            options: options, finish: finish)
                        return
                    }
                    guard item.filename != current.filename else {
                        done(WriteFileProviderItem(current), nil)
                        return
                    }
                    let suffix = WriteFilename.collisionSuffix(handle)
                    var component = item.filename
                    if component.hasSuffix(suffix) { component.removeLast(suffix.count) }
                    switch await api.renameWorkspace(
                        name: WriteFilename.decodeComponent(component)
                    ) {
                    case .success(let blog):
                        fpLog.info("modifyItem workspace \(handle, privacy: .public) renamed to '\(blog.name, privacy: .public)'")
                        // Write the fresh name back into the shared handoff so a
                        // later domain re-registration reads it (not the app's
                        // lagging cache); the anchor now includes the name, so the
                        // app's next authoritative republish still converges.
                        FileProviderHandoffStore.updateWorkspaceName(handle: handle, name: blog.name)
                        done(WriteFileProviderItem(WriteItemMapper.workspaceItem(
                            handle: handle, name: blog.name, readOnly: false)), nil)
                    case .failure(.conflict):
                        switch await currentWorkspaceItem(handle: handle, api: api) {
                        case .success(let remote):
                            finishModifyConflict(
                                current: remote, changedFields: changedFields,
                                options: options, finish: finish)
                        case .failure(let error): done(nil, Self.nsError(from: error))
                        }
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
            let changesMetadata = changedFields.contains(.filename)
                || changedFields.contains(.parentItemIdentifier)
            guard let baseHash = Self.usableBaseHash(version) else {
                await resolveModifyConflict(
                    identifier: .file(handle: handle, id: postId), core: core,
                    changedFields: changedFields, options: options, finish: finish)
                return
            }
            var currentMetadataItem: WriteItem?
            if changesMetadata {
                let current: WriteItem
                switch await core.item(for: .file(handle: handle, id: postId)) {
                case .failure(let error): done(nil, Self.nsError(from: error)); return
                case .success(let value): current = value
                }
                guard Self.metadataBase(version, matches: current) else {
                    finishModifyConflict(
                        current: current, changedFields: changedFields,
                        options: options, finish: finish)
                    return
                }
                currentMetadataItem = current
            }

            let body: String?
            if changedFields.contains(.contents) {
                guard let newContents else {
                    done(nil, Self.unreadableContentsError(nil)); return
                }
                do { body = try String(contentsOf: newContents, encoding: .utf8) }
                catch { done(nil, Self.unreadableContentsError(error)); return }
            } else {
                body = nil
            }

            // Validate the complete intent before applying either half of a
            // compound content+move operation. A malformed, foreign, or missing
            // destination must never turn into a successful unchanged move (and
            // must not leave a content PUT committed first).
            var newFolderId: String?
            if changedFields.contains(.parentItemIdentifier),
               item.parentItemIdentifier.rawValue
                    != currentMetadataItem?.parentIdentifier.rawValue {
                guard case .folder(let parentHandle, let folderId)? =
                        WriteItemIdentifier(item.parentItemIdentifier),
                      parentHandle == handle else {
                    done(nil, Self.fpError(.noSuchItem)); return
                }
                switch await api.workspace() {
                case .failure(let error): done(nil, Self.nsError(from: error)); return
                case .success(let workspace):
                    guard workspace.folders.contains(where: { $0.id == folderId }) else {
                        done(nil, Self.fpError(.noSuchItem)); return
                    }
                    newFolderId = folderId
                }
            }
            let newTitle: String?
            if changedFields.contains(.filename),
               item.filename != currentMetadataItem?.filename {
                let title = WriteFilename.titleFromFilename(item.filename, stableId: postId)
                guard !title.isEmpty else {
                    done(nil, Self.fpError(.cannotSynchronize)); return
                }
                newTitle = title
            } else {
                newTitle = nil
            }

            if body == nil, newFolderId == nil, newTitle == nil,
               let currentMetadataItem {
                done(WriteFileProviderItem(currentMetadataItem), nil)
                return
            }

            // A metadata PATCH following a content PUT must build on the exact
            // hash returned by that PUT, not on the original base.
            var patchBaseHash = baseHash
            if let body {
                switch await api.putFile(postId: postId, body: body, ifMatch: baseHash) {
                case .failure(.conflict):
                    await resolveModifyConflict(
                        identifier: .file(handle: handle, id: postId), core: core,
                        changedFields: changedFields, options: options, finish: finish)
                    return
                case .failure(let error): done(nil, Self.nsError(from: error)); return
                case .success(let saved):
                    guard !saved.hash.isEmpty else {
                        done(nil, Self.fpError(.cannotSynchronize)); return
                    }
                    patchBaseHash = saved.hash
                }
            }

            if newFolderId != nil || newTitle != nil {
                switch await api.patchFile(
                    postId: postId, folderId: newFolderId, slug: nil,
                    title: newTitle, ifMatch: patchBaseHash
                ) {
                case .success: break
                case .failure(.conflict):
                    // A fresh hash is not fresh rename/move intent. Return the
                    // current remote item (or the explicit fail-on-conflict error)
                    // and never replay stale metadata against it.
                    await resolveModifyConflict(
                        identifier: .file(handle: handle, id: postId), core: core,
                        changedFields: changedFields, options: options, finish: finish)
                    return
                case .failure(let error):
                    done(nil, Self.nsError(from: error)); return
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
        let itemIdentifier = WriteItemIdentifier.file(handle: handle, id: postId)
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        Task {
            guard let hash = Self.usableBaseHash(version),
                  Self.isUsableBaseComponent(version.metadataVersion) else {
                done(await rejectedDeletionError(identifier: itemIdentifier, core: core))
                return
            }
            let current: WriteItem
            switch await core.item(for: itemIdentifier) {
            case .failure(.notFound): done(nil); return
            case .failure(let error): done(Self.nsError(from: error)); return
            case .success(let value): current = value
            }
            guard current.contentHash == hash,
                  Self.metadataBase(version, matches: current) else {
                done(Self.rejectedDeletionError(current: current))
                return
            }
            switch await api.deleteFile(postId: postId, ifMatch: hash) {
            case .success: done(nil)
            case .failure(.notFound): done(nil)
            case .failure(.conflict):
                done(await rejectedDeletionError(identifier: itemIdentifier, core: core))
            case .failure(let error): done(Self.nsError(from: error))
            }
        }
        return progress
    }

    // MARK: Helpers

    private struct FetchedRevision {
        let item: WriteItem
        let content: WriteFileContent
    }

    private func consistentFetch(
        postId: String, core: WorkspaceEnumerator, api: WriteSyncAPI
    ) async -> Result<FetchedRevision, WriteSyncError> {
        let identifier = WriteItemIdentifier.file(handle: core.handle, id: postId)
        for attempt in 1...3 {
            let before: WriteItem
            switch await core.item(for: identifier) {
            case .failure(let error): return .failure(error)
            case .success(let item): before = item
            }

            let content: WriteFileContent
            switch await api.fileText(postId: postId) {
            case .failure(let error): return .failure(error)
            case .success(let value): content = value
            }

            let after: WriteItem
            switch await core.item(for: identifier) {
            case .failure(let error): return .failure(error)
            case .success(let item): after = item
            }

            if let hash = content.hash, !hash.isEmpty,
               before == after, after.contentHash == hash {
                return .success(FetchedRevision(item: after, content: content))
            }
            fpLog.info("fetchContents \(postId, privacy: .public) revision moved during attempt \(attempt, privacy: .public)")
        }
        return .failure(.network("Could not read one stable file revision"))
    }

    private static func isUsableBaseComponent(_ component: Data) -> Bool {
        !component.isEmpty && component != NSFileProviderItemVersion.beforeFirstSyncComponent
    }

    private static func usableBaseHash(_ version: NSFileProviderItemVersion) -> String? {
        guard isUsableBaseComponent(version.contentVersion),
              let hash = String(data: version.contentVersion, encoding: .utf8),
              !hash.isEmpty else { return nil }
        return hash
    }

    private static func requestedVersion(
        _ requested: NSFileProviderItemVersion,
        matches current: NSFileProviderItemVersion
    ) -> Bool {
        if isUsableBaseComponent(requested.contentVersion),
           requested.contentVersion != current.contentVersion {
            return false
        }
        if isUsableBaseComponent(requested.metadataVersion),
           requested.metadataVersion != current.metadataVersion {
            return false
        }
        return true
    }

    private static func metadataBase(
        _ version: NSFileProviderItemVersion, matches current: WriteItem
    ) -> Bool {
        guard isUsableBaseComponent(version.metadataVersion) else { return false }
        return WriteFileProviderItem(current).itemVersion.metadataVersion
            == version.metadataVersion
    }

    /// Container fields Write can settle without losing an actual structural
    /// edit. Finder owns the local-only metadata; `.filename` is the one field
    /// persisted to the Write server. Parent and contents are intentionally
    /// absent because folder/workspace moves and container bodies are unsupported.
    private static var supportedContainerFields: NSFileProviderItemFields {
        [
            .filename,
            .lastUsedDate,
            .tagData,
            .favoriteRank,
            .creationDate,
            .contentModificationDate,
            .fileSystemFlags,
            .extendedAttributes,
        ]
    }

    private func resolveModifyConflict(
        identifier: WriteItemIdentifier,
        core: WorkspaceEnumerator,
        changedFields: NSFileProviderItemFields,
        options: NSFileProviderModifyItemOptions,
        finish: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?
        ) -> Void
    ) async {
        if #available(macOS 26.0, *), options.contains(.failOnConflict) {
            finish(nil, [], false, Self.fpError(.localVersionConflictingWithServer))
            return
        }
        switch await core.item(for: identifier) {
        case .success(let current):
            finishModifyConflict(
                current: current, changedFields: changedFields,
                options: options, finish: finish)
        case .failure(let error):
            finish(nil, [], false, Self.nsError(from: error))
        }
    }

    private func finishModifyConflict(
        current: WriteItem,
        changedFields: NSFileProviderItemFields,
        options: NSFileProviderModifyItemOptions,
        finish: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?
        ) -> Void
    ) {
        if #available(macOS 26.0, *), options.contains(.failOnConflict) {
            finish(nil, [], false, Self.fpError(.localVersionConflictingWithServer))
            return
        }
        // Returning the current remote item is File Provider's normal conflict
        // resolution contract. Files request fresh bytes because revision-only
        // frontmatter, title, or body may all have changed with the content hash.
        finish(WriteFileProviderItem(current), [], !current.isFolder, nil)
    }

    private func rejectedDeletionError(
        identifier: WriteItemIdentifier, core: WorkspaceEnumerator
    ) async -> (any Error)? {
        switch await core.item(for: identifier) {
        case .success(let current):
            return Self.rejectedDeletionError(current: current)
        case .failure(.notFound):
            return nil
        case .failure(let error):
            return Self.nsError(from: error)
        }
    }

    private static func rejectedDeletionError(current: WriteItem) -> NSError {
        NSError.fileProviderErrorForRejectedDeletion(
            of: WriteFileProviderItem(current))
    }

    private func currentWorkspaceItem(
        handle: String, api: WriteSyncAPI
    ) async -> Result<WriteItem, WriteSyncError> {
        switch await api.workspace() {
        case .failure(let error): return .failure(error)
        case .success(let workspace):
            var descriptors = handoffDescriptors()
            if let index = descriptors.firstIndex(where: { $0.handle == handle }) {
                descriptors[index].name = workspace.blog.name
            } else {
                descriptors.append(FileProviderWorkspace(
                    name: workspace.blog.name, handle: handle, origin: "", token: ""))
            }
            guard let item = WorkspaceListEnumerator.item(for: handle, in: descriptors) else {
                return .failure(.notFound)
            }
            return .success(item)
        }
    }

    private static func unreadableContentsError(_ underlying: (any Error)?) -> NSError {
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: "The modified file contents could not be read."
        ]
        if let underlying { userInfo[NSUnderlyingErrorKey] = underlying }
        return NSError(
            domain: NSFileProviderErrorDomain,
            code: NSFileProviderError.cannotSynchronize.rawValue,
            userInfo: userInfo)
    }

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
        descriptorsProvider()
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
        if let temporaryDirectoryProvider { return temporaryDirectoryProvider() }
        return try? NSFileProviderManager(for: domain)?.temporaryDirectoryURL()
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
