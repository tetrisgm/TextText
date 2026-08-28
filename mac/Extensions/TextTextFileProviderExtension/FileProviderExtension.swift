import AppKit
import FileProvider
import Foundation
import os
import TextTextFileProviderKit
import TextTextFileProviderBridge

/// Diagnostics for a subsystem that can only be observed through the unified log
/// (the extension runs inside fileproviderd, not a window). Read with:
///   log show --last 15m --predicate 'subsystem == "app.texttext"'
let fpLog = Logger(subsystem: "app.texttext", category: "fileprovider")

/// Coordinates the `Progress` returned to fileproviderd with one asynchronous
/// task and exactly one completion callback. Cancellation wins any race with a
/// late network reply and actively cancels the child task.
private final class FileProviderRequestState: @unchecked Sendable {
    let progress = Progress(totalUnitCount: 1)

    private let lock = NSLock()
    private var task: Task<Void, Never>?
    private var finished = false

    func install(_ task: Task<Void, Never>) {
        lock.lock()
        if finished {
            lock.unlock()
            task.cancel()
            return
        }
        self.task = task
        lock.unlock()
    }

    @discardableResult
    func complete(_ body: () -> Void) -> Bool {
        guard transitionToFinished(cancelTask: false) else { return false }
        body()
        return true
    }

    func cancel(_ body: () -> Void) {
        guard transitionToFinished(cancelTask: true) else { return }
        body()
    }

    private func transitionToFinished(cancelTask: Bool) -> Bool {
        let taskToCancel: Task<Void, Never>?
        lock.lock()
        guard !finished else {
            lock.unlock()
            return false
        }
        finished = true
        taskToCancel = cancelTask ? task : nil
        task = nil
        lock.unlock()

        progress.cancellationHandler = nil
        if cancelTask { taskToCancel?.cancel() }
        progress.completedUnitCount = 1
        return true
    }
}

/// TextText's replicated File Provider. A single "TextText" domain spans every
/// workspace the user has joined: the root lists one folder per workspace, and
/// inside each are that workspace's system folders and posts. Every folder/file
/// identifier is scoped by the workspace HANDLE, so the extension reads the
/// handle out of the identifier and resolves that workspace's token from the
/// handoff. The server (TextText.app) stays the source of truth.
///
/// The API client is resolved per request from the shared keychain handoff (so a
/// sign-in after launch is picked up without relaunch) via `apiFactory`, which
/// tests override to inject a fake.
public final class FileProviderExtension: NSObject,
    NSFileProviderReplicatedExtension, NSFileProviderCustomAction
{

    static let copyTextTextLinkActionIdentifier = NSFileProviderExtensionActionIdentifier(
        "app.texttext.fileprovider.copy-texttext-link")
    static let shareActionIdentifier = NSFileProviderExtensionActionIdentifier(
        "app.texttext.fileprovider.share")
    static let manageAccessActionIdentifier = NSFileProviderExtensionActionIdentifier(
        "app.texttext.fileprovider.manage-access")

    private let domain: NSFileProviderDomain
    private let apiFactory: (String) -> TextTextSyncAPI?
    private let descriptorsProvider: () -> [FileProviderWorkspace]
    private let temporaryDirectoryProvider: (() -> URL?)?
    private let copyLinkHandler: (String) -> Bool
    private let openURLHandler: (URL) -> Bool

    public required convenience init(domain: NSFileProviderDomain) {
        self.init(domain: domain, apiFactory: { FileProviderExtension.handoffAPI(for: $0) })
    }

    /// Test seam: inject the API (keyed by workspace handle) instead of reading
    /// the shared keychain handoff.
    init(
        domain: NSFileProviderDomain,
        apiFactory: @escaping (String) -> TextTextSyncAPI?,
        descriptorsProvider: @escaping () -> [FileProviderWorkspace] = {
            FileProviderHandoffStore.load()?.workspaces ?? []
        },
        temporaryDirectoryProvider: (() -> URL?)? = nil,
        copyLinkHandler: @escaping (String) -> Bool = FileProviderExtension.copyToPasteboard,
        openURLHandler: @escaping (URL) -> Bool = FileProviderExtension.openURL
    ) {
        self.domain = domain
        self.apiFactory = apiFactory
        self.descriptorsProvider = descriptorsProvider
        self.temporaryDirectoryProvider = temporaryDirectoryProvider
        self.copyLinkHandler = copyLinkHandler
        self.openURLHandler = openURLHandler
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
        let requestState = FileProviderRequestState()
        let finish: (NSFileProviderItem?, (any Error)?) -> Void = { item, error in
            _ = requestState.complete { completionHandler(item, error) }
        }
        requestState.progress.cancellationHandler = { [weak requestState] in
            requestState?.cancel { completionHandler(nil, Self.cancelledError()) }
        }
        guard let wid = TextTextItemIdentifier(identifier) else {
            finish(nil, Self.fpError(.noSuchItem))
            return requestState.progress
        }
        switch wid {
        case .rootContainer:
            finish(Self.syntheticRootItem(name: domain.displayName), nil)
            return requestState.progress
        case .workingSet, .trashContainer:
            // These are virtual enumeration scopes, not aliases for the domain
            // root. Returning the root item here gives File Provider an item
            // whose identifier does not match the one it requested and leaves
            // its hidden trash container in a permanent reconciliation loop.
            finish(nil, Self.fpError(.noSuchItem))
            return requestState.progress
        case .dataContainer:
            finish(TextTextFileProviderItem(
                TextTextCentralAttachments.dataContainerItem()), nil)
            return requestState.progress
        case .attachmentsContainer:
            finish(TextTextFileProviderItem(
                TextTextCentralAttachments.attachmentsContainerItem()), nil)
            return requestState.progress
        case .attachmentWorkspace, .attachmentItem, .attachmentFile:
            let enumerator = CentralAttachmentsEnumerator(
                container: wid, descriptors: handoffDescriptors(),
                apiFactory: apiFactory)
            let task = Task {
                switch await enumerator.item(for: wid) {
                case .success(let item): finish(TextTextFileProviderItem(item), nil)
                case .failure(let error): finish(nil, Self.nsError(from: error))
                }
            }
            requestState.install(task)
            return requestState.progress
        case .workspace(let handle):
            guard let item = WorkspaceListEnumerator.item(
                for: handle, in: handoffDescriptors()
            ) else {
                finish(nil, Self.fpError(.noSuchItem)); return requestState.progress
            }
            finish(TextTextFileProviderItem(item), nil)
            return requestState.progress
        case .folder(let handle, _), .file(let handle, _):
            guard let api = apiFactory(handle) else {
                finish(nil, Self.fpError(.notAuthenticated)); return requestState.progress
            }
            let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
            let task = Task {
                switch await core.item(for: wid) {
                case .success(let item): finish(TextTextFileProviderItem(item), nil)
                case .failure(let error): finish(nil, Self.nsError(from: error))
                }
            }
            requestState.install(task)
            return requestState.progress
        }
    }

    // MARK: Content materialization

    public func fetchContents(
        for itemIdentifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion?,
        request: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, (any Error)?) -> Void
    ) -> Progress {
        let requestState = FileProviderRequestState()
        let finish: (URL?, NSFileProviderItem?, (any Error)?) -> Bool = { url, item, error in
            requestState.complete { completionHandler(url, item, error) }
        }
        requestState.progress.cancellationHandler = { [weak requestState] in
            requestState?.cancel {
                completionHandler(nil, nil, Self.cancelledError())
            }
        }
        guard let requestedIdentifier = TextTextItemIdentifier(itemIdentifier) else {
            _ = finish(nil, nil, Self.fpError(.noSuchItem))
            return requestState.progress
        }
        if case .attachmentFile(let handle, let postId, let filename) = requestedIdentifier {
            guard let api = apiFactory(handle) else {
                _ = finish(nil, nil, Self.fpError(.notAuthenticated))
                return requestState.progress
            }
            let tempDir = fpTemporaryDirectory()
            let task = Task {
                let enumerator = CentralAttachmentsEnumerator(
                    container: .attachmentItem(handle: handle, id: postId),
                    descriptors: handoffDescriptors(), apiFactory: apiFactory)
                let metadata: TextTextItem
                switch await enumerator.item(for: requestedIdentifier) {
                case .failure(let error):
                    _ = finish(nil, nil, Self.nsError(from: error)); return
                case .success(let value): metadata = value
                }
                guard let rawURL = metadata.manifestURL,
                      let artifactURL = URL(string: rawURL),
                      let dir = tempDir else {
                    _ = finish(nil, nil, Self.fpError(.cannotSynchronize)); return
                }
                let content: TextTextArtifactContent
                switch await api.artifactData(url: artifactURL) {
                case .failure(let error):
                    _ = finish(nil, nil, Self.nsError(from: error)); return
                case .success(let value): content = value
                }
                let destination = dir.appendingPathComponent(UUID().uuidString)
                do { try content.data.write(to: destination) } catch {
                    _ = finish(nil, nil, error); return
                }
                let item = TextTextFileProviderItem(metadata.withContent(
                    hash: metadata.contentHash, size: content.data.count))
                if let requestedVersion,
                   !Self.requestedVersion(requestedVersion, matches: item.itemVersion) {
                    try? FileManager.default.removeItem(at: destination)
                    _ = finish(nil, nil, Self.fpError(.versionNoLongerAvailable))
                    return
                }
                guard !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: destination); return
                }
                if !finish(destination, item, nil) {
                    try? FileManager.default.removeItem(at: destination)
                }
                fpLog.info("fetchContents attachment \(filename, privacy: .public) delivered \(content.data.count) bytes")
            }
            requestState.install(task)
            return requestState.progress
        }
        guard case .file(let handle, let postId) = requestedIdentifier else {
            _ = finish(nil, nil, Self.fpError(.noSuchItem))
            return requestState.progress
        }
        guard let api = apiFactory(handle) else {
            _ = finish(nil, nil, Self.fpError(.notAuthenticated))
            return requestState.progress
        }
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        let tempDir = fpTemporaryDirectory()
        let task = Task {
            switch await consistentFetch(postId: postId, core: core, api: api) {
            case .failure(let error):
                fpLog.error("fetchContents \(postId, privacy: .public) failed: \(String(describing: error), privacy: .public)")
                _ = finish(nil, nil, Self.nsError(from: error))
            case .success(let revision):
                guard !Task.isCancelled else { return }
                guard let dir = tempDir else {
                    fpLog.error("fetchContents \(postId, privacy: .public): no temp dir")
                    _ = finish(nil, nil, Self.fpError(.serverUnreachable)); return
                }

                let representation = revision.item.representation ?? .markdown
                let destination: URL
                let materializedSize: Int?
                let deliveredByteCount: Int
                do {
                    switch representation {
                    case .textbundle, .textpack:
                        let manifest: TextTextArtifactManifest
                        switch await api.documentArtifacts(postId: postId) {
                        case .failure(.notFound) where revision.item.kind != .bookmark:
                            let selectedHash = revision.content.hash ?? ""
                            manifest = TextTextArtifactManifest(
                                postId: postId,
                                slug: "",
                                fileHash: representation.isTextBundleFamily
                                    ? ""
                                    : selectedHash,
                                documentHash: representation.isTextBundleFamily
                                    ? selectedHash
                                    : nil,
                                artifacts: [])
                        case .failure(let error):
                            _ = finish(nil, nil, Self.nsError(from: error)); return
                        case .success(let value): manifest = value
                        }
                        guard manifest.postId == postId,
                              manifest.contentHash(for: representation)
                                == revision.content.hash else {
                            _ = finish(
                                nil, nil,
                                Self.nsError(from: .network(
                                    "Document assets changed during materialization")))
                            return
                        }
                        var assets: [TextTextTextBundlePackage.MaterializedAsset] = []
                        for artifact in TextTextDocumentAssets.validatedInlineAssets(
                            manifest, handle: handle
                        ) {
                            guard let artifactURL = URL(string: artifact.url) else {
                                _ = finish(nil, nil, Self.fpError(.cannotSynchronize)); return
                            }
                            let downloaded: TextTextArtifactContent
                            switch await api.artifactData(url: artifactURL) {
                            case .failure(let error):
                                _ = finish(nil, nil, Self.nsError(from: error)); return
                            case .success(let value): downloaded = value
                            }
                            assets.append(.init(
                                filename: artifact.filename,
                                data: downloaded.data,
                                remoteURL: artifact.url,
                                contentType: artifact.contentType ?? downloaded.contentType))
                        }
                        let package = try TextTextTextBundlePackage.materialize(
                            canonicalMarkdown: revision.content.text,
                            documentJSON: revision.content.documentJSON,
                            // The look travels with the file. Without it a
                            // textpack dragged into Bear, or handed to anyone
                            // outside this workspace, carries a recipe's cook
                            // time and no idea how a recipe reads.
                            templateJSON: revision.content.templateJSON,
                            assets: assets,
                            sourceURL: revision.item.manifestURL,
                            in: dir)
                        if representation == .textpack {
                            // A .textpack is a single leaf zip file: zip the
                            // textbundle and return the FILE, so its name and
                            // content are one node (phantom-free), unlike the open
                            // package. It carries a zip UTI, so no cache corruption.
                            let textpackURL = try TextTextTextBundlePackage.zipToTextPack(
                                packageURL: package.url, in: dir)
                            try? FileManager.default.removeItem(at: package.url)
                            guard let zipped = try textpackURL.resourceValues(
                                forKeys: [.fileSizeKey]).fileSize else {
                                throw TextTextTextBundleError.invalidPackage(
                                    "Textpack size is unavailable")
                            }
                            destination = textpackURL
                            materializedSize = zipped
                            deliveredByteCount = zipped
                        } else {
                            // File Provider owns package transport. Returning the real
                            // directory lets the framework preserve package semantics;
                            // manually returning a coordinated ZIP leaves Finder with a
                            // regular file carrying a package UTI and corrupts its cache.
                            destination = package.url
                            materializedSize = nil
                            deliveredByteCount = package.logicalSize
                        }
                    case .markdown, .text:
                        var text = revision.content.text
                        if representation == .markdown {
                            switch await plainDocumentContext(
                                item: revision.item, api: api) {
                            case .failure(let error):
                                _ = finish(nil, nil, Self.nsError(from: error)); return
                            case .success(let context):
                                text = TextTextCentralAttachments.localMarkdown(
                                    canonical: text, manifest: context.manifest,
                                    handle: handle,
                                    workspaceFilename: context.workspaceFilename,
                                    documentFilename: context.documentFilename,
                                    folderDepth: context.folderDepth)
                            }
                        }
                        let bytes = Data(text.utf8)
                        destination = dir.appendingPathComponent(UUID().uuidString)
                        try bytes.write(to: destination)
                        materializedSize = bytes.count
                        deliveredByteCount = bytes.count
                    }
                } catch {
                    fpLog.error("fetchContents \(postId, privacy: .public) write failed: \(String(describing: error), privacy: .public)")
                    _ = finish(nil, nil, error); return
                }
                let item = TextTextFileProviderItem(revision.item.withContent(
                    hash: revision.content.hash, size: materializedSize))
                if let requestedVersion,
                   !Self.requestedVersion(requestedVersion, matches: item.itemVersion) {
                    try? FileManager.default.removeItem(at: destination)
                    _ = finish(nil, nil, Self.fpError(.versionNoLongerAvailable))
                    return
                }
                guard !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: destination)
                    return
                }
                fpLog.info("fetchContents \(postId, privacy: .public) delivered \(deliveredByteCount) bytes")
                // The returned item MUST describe the bytes just written: its hash
                // (the GET body and its ETag are one consistent snapshot; a stale
                // manifest hash would make the next edit send a wrong If-Match and
                // falsely conflict). Regular files also need their exact byte size.
                // Packages intentionally keep documentSize nil because the framework
                // transports the directory as a package and owns its wire encoding.
                if !finish(destination, item, nil) {
                    try? FileManager.default.removeItem(at: destination)
                }
            }
        }
        requestState.install(task)
        return requestState.progress
    }

    // MARK: Enumeration

    public func enumerator(
        for containerItemIdentifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest
    ) throws -> any NSFileProviderEnumerator {
        guard let wid = TextTextItemIdentifier(containerItemIdentifier) else {
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
            // TextText exposes permanent deletion, not Finder trash semantics. Per
            // File Provider's contract, an extension that does not advertise
            // allowsTrashing must reject this enumerator explicitly.
            throw Self.readOnlyError()
        case .dataContainer, .attachmentsContainer, .attachmentWorkspace,
             .attachmentItem:
            return CentralAttachmentsEnumerator(
                container: wid, descriptors: handoffDescriptors(),
                apiFactory: apiFactory)
        case .workspace(let handle), .folder(let handle, _):
            guard let api = apiFactory(handle) else { throw Self.fpError(.notAuthenticated) }
            return TextTextEnumeratorAdapter(
                container: wid,
                core: makeCore(api, handle: handle, name: descriptorName(for: handle)),
                snapshots: Self.anchorSnapshotStore())
        case .file, .attachmentFile:
            throw Self.fpError(.noSuchItem)
        }
    }

    // MARK: Finder actions

    public func performAction(
        identifier actionIdentifier: NSFileProviderExtensionActionIdentifier,
        onItemsWithIdentifiers itemIdentifiers: [NSFileProviderItemIdentifier],
        completionHandler: @escaping ((any Error)?) -> Void
    ) -> Progress {
        let requestState = FileProviderRequestState()
        let finish: ((any Error)?) -> Void = { error in
            _ = requestState.complete { completionHandler(error) }
        }
        requestState.progress.cancellationHandler = { [weak requestState] in
            requestState?.cancel { completionHandler(Self.cancelledError()) }
        }

        guard itemIdentifiers.count == 1,
              case .file(let handle, let postId)? = TextTextItemIdentifier(itemIdentifiers[0]) else {
            finish(Self.readOnlyError())
            return requestState.progress
        }

        if actionIdentifier == Self.copyTextTextLinkActionIdentifier {
            guard let api = apiFactory(handle) else {
                finish(Self.fpError(.notAuthenticated))
                return requestState.progress
            }
            let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
            let task = Task {
                let item: TextTextItem
                switch await core.item(for: .file(handle: handle, id: postId)) {
                case .failure(let error):
                    finish(Self.nsError(from: error))
                    return
                case .success(let value):
                    item = value
                }
                guard !Task.isCancelled else { return }
                guard let link = resolvedManifestLink(for: item, handle: handle) else {
                    finish(Self.actionError("This item does not have a valid TextText link."))
                    return
                }
                let copied = await MainActor.run { copyLinkHandler(link) }
                guard !Task.isCancelled else { return }
                finish(copied ? nil : Self.actionError("The TextText link could not be copied."))
            }
            requestState.install(task)
            return requestState.progress
        }

        let action: String
        if actionIdentifier == Self.shareActionIdentifier {
            action = "share"
        } else if actionIdentifier == Self.manageAccessActionIdentifier {
            action = "manage-access"
        } else {
            finish(Self.readOnlyError())
            return requestState.progress
        }

        guard let api = apiFactory(handle) else {
            finish(Self.fpError(.notAuthenticated))
            return requestState.progress
        }
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        let task = Task {
            let item: TextTextItem
            switch await core.item(for: .file(handle: handle, id: postId)) {
            case .failure(let error):
                finish(Self.nsError(from: error))
                return
            case .success(let value):
                item = value
            }
            guard !Task.isCancelled else { return }
            guard let link = resolvedManifestLink(for: item, handle: handle),
                  let url = Self.appActionURL(action: action, postId: postId, link: link) else {
                finish(Self.actionError("This item does not have a valid TextText link."))
                return
            }
            let opened = await MainActor.run { openURLHandler(url) }
            guard !Task.isCancelled else { return }
            finish(opened ? nil : Self.actionError("The TextText action could not be opened."))
        }
        requestState.install(task)
        return requestState.progress
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
        let requestState = FileProviderRequestState()
        let finish: (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?
        ) -> Void = { item, pending, shouldFetch, error in
            _ = requestState.complete {
                completionHandler(item, pending, shouldFetch, error)
            }
        }
        let done: (NSFileProviderItem?, (any Error)?) -> Void = { item, error in
            finish(item, [], false, error)
        }
        requestState.progress.cancellationHandler = { [weak requestState] in
            requestState?.cancel {
                completionHandler(nil, [], false, Self.cancelledError())
            }
        }
        if options.contains(.mayAlreadyExist) {
            // Releases 0.65-0.67 exposed bookmark assets as visible sibling
            // folders. A schema upgrade intentionally drops those disk objects;
            // their bytes now live inside the bookmark's TextBundle package.
            if Self.isLegacyBookmarkSidecar(itemTemplate) {
                done(nil, nil)
                return requestState.progress
            }
            let task = Task {
                guard !Task.isCancelled else { return }
                switch await existingItemForReimport(matching: itemTemplate) {
                case .success(let existing?):
                    fpLog.info(
                        "adopted reimported item \(existing.identifier.rawValue, privacy: .public) for '\(itemTemplate.filename, privacy: .public)'"
                    )
                    done(TextTextFileProviderItem(existing), nil)
                    return
                case .failure(let error):
                    done(nil, Self.nsError(from: error))
                    return
                case .success(nil):
                    // This is genuinely new disk content. Continue through the
                    // normal create path when its parent is writable.
                    break
                }
                createOrdinaryItem(
                    basedOn: itemTemplate, contents: url,
                    requestState: requestState, finish: finish, done: done)
            }
            requestState.install(task)
            return requestState.progress
        }
        createOrdinaryItem(
            basedOn: itemTemplate, contents: url,
            requestState: requestState, finish: finish, done: done)
        return requestState.progress
    }

    /// Reimport scans the existing disk tree and invokes `createItem` with
    /// `.mayAlreadyExist`. Match the disk object to the authoritative provider
    /// item before considering a server create. Stable identifiers are cheapest;
    /// a parent-scoped filename lookup covers restored File Provider databases
    /// whose temporary disk identifiers no longer carry TextText's identity.
    private func existingItemForReimport(
        matching template: NSFileProviderItem
    ) async -> Result<TextTextItem?, TextTextSyncError> {
        if let identifier = TextTextItemIdentifier(rawValue: template.itemIdentifier.rawValue),
           let handle = identifier.workspaceHandle,
           let api = apiFactory(handle) {
            let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
            switch await core.item(for: identifier) {
            case .success(let item): return .success(item)
            case .failure(.notFound): break
            case .failure(let error): return .failure(error)
            }
        }

        guard let parent = TextTextItemIdentifier(
            rawValue: template.parentItemIdentifier.rawValue
        ) else { return .success(nil) }
        let wantsFolder = template.contentType?.conforms(to: .folder) ?? false

        if parent == .rootContainer {
            let candidates = WorkspaceListEnumerator.items(handoffDescriptors())
            return Self.matchReimportCandidate(
                candidates, filename: template.filename, isFolder: wantsFolder)
        }

        guard let handle = parent.workspaceHandle,
              let api = apiFactory(handle) else {
            return .failure(.http(401, "Not authenticated"))
        }
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        switch await core.children(of: parent) {
        case .failure(let error): return .failure(error)
        case .success(let candidates):
            return Self.matchReimportCandidate(
                candidates, filename: template.filename, isFolder: wantsFolder)
        }
    }

    private static func matchReimportCandidate(
        _ candidates: [TextTextItem], filename: String, isFolder: Bool
    ) -> Result<TextTextItem?, TextTextSyncError> {
        let requested = filename.precomposedStringWithCanonicalMapping
        let eligible = candidates.filter { $0.isFolder == isFolder }
        let exact = eligible.filter {
            let candidate = $0.filename.precomposedStringWithCanonicalMapping
            return equivalentFilename(candidate, requested)
        }
        if exact.count == 1 { return .success(exact[0]) }
        if exact.count > 1 { return .failure(.conflict) }
        guard !isFolder else { return .success(nil) }

        // A restored File Provider database can hand back an older representation
        // (`.md` before a TextBundle migration), a raw unsafe spelling, or a
        // canonically equivalent Unicode spelling. Compare semantic titles only
        // after the exact parent-scoped lookup and adopt only an unambiguous item.
        let requestedRepresentation = TextTextFileRepresentation.inferred(
            fromFilename: filename) ?? .markdown
        let requestedTitle = TextTextFilename.titleFromFilename(
            filename, representation: requestedRepresentation)
        let semantic = eligible.filter {
            let representation = $0.representation
                ?? TextTextFileRepresentation.inferred(fromFilename: $0.filename)
                ?? .markdown
            let candidateTitle = TextTextFilename.titleFromFilename(
                $0.filename, stableId: $0.serverId,
                representation: representation)
            return equivalentFilename(candidateTitle, requestedTitle)
        }
        if semantic.count == 1 { return .success(semantic[0]) }
        if semantic.count > 1 { return .failure(.conflict) }
        return .success(nil)
    }

    private static func equivalentFilename(_ lhs: String, _ rhs: String) -> Bool {
        let candidate = lhs.precomposedStringWithCanonicalMapping
        let requested = rhs.precomposedStringWithCanonicalMapping
        return candidate.compare(
            requested, options: [.caseInsensitive, .widthInsensitive],
            locale: Locale(identifier: "en_US_POSIX")) == .orderedSame
    }

    private static func isLegacyBookmarkSidecar(_ item: NSFileProviderItem) -> Bool {
        if let identifier = TextTextItemIdentifier(rawValue: item.itemIdentifier.rawValue) {
            switch identifier {
            case .folder(_, let id):
                if TextTextLegacyBookmarkSidecars.postId(fromFolderServerId: id) != nil {
                    return true
                }
            case .file(_, let id):
                if TextTextLegacyBookmarkSidecars.assetIdentity(fromFileServerId: id) != nil {
                    return true
                }
            default: break
            }
        }
        return item.filename.lowercased().hasSuffix(".assets")
            && (item.contentType?.conforms(to: .folder) ?? false)
    }

    private func createOrdinaryItem(
        basedOn itemTemplate: NSFileProviderItem,
        contents url: URL?,
        requestState: FileProviderRequestState,
        finish: @escaping (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?
        ) -> Void,
        done: @escaping (NSFileProviderItem?, (any Error)?) -> Void
    ) {
        guard case .folder(let handle, let parentId)? = TextTextItemIdentifier(itemTemplate.parentItemIdentifier) else {
            // New items must land inside a workspace folder (the root holds the
            // workspace containers, and a workspace holds only its system folders).
            done(nil, Self.readOnlyError()); return
        }
        guard let api = apiFactory(handle) else {
            done(nil, Self.fpError(.notAuthenticated)); return
        }
        let filename = itemTemplate.filename
        let representation = TextTextFileRepresentation.inferred(fromFilename: filename)
            ?? (itemTemplate.contentType?.identifier == TextTextTextBundlePackage.typeIdentifier
                ? .textbundle : .markdown)
        let isTextBundle = representation == .textbundle
        let isFolder = !isTextBundle
            && (itemTemplate.contentType?.conforms(to: .folder) ?? false)
        // The template's itemIdentifier is stable across the framework's retries
        // of THIS create, so it is the right Idempotency-Key: a lost response
        // plus retry returns the original item instead of a duplicate.
        let idempotencyKey = itemTemplate.itemIdentifier.rawValue
        let task = Task {
            guard !Task.isCancelled else { return }
            if isFolder {
                guard let parentPath = await folderPath(of: parentId, api: api) else {
                    done(nil, Self.fpError(.noSuchItem)); return
                }
                guard !Task.isCancelled else { return }
                let folderName = TextTextFilename.decodeComponent(filename)
                switch await api.createFolder(
                    parentPath: parentPath, name: folderName,
                    idempotencyKey: idempotencyKey
                ) {
                case .success(let folder):
                    done(TextTextFileProviderItem(
                        TextTextItemMapper.item(for: folder, handle: handle, readOnly: false)), nil)
                case .failure(let error): done(nil, Self.nsError(from: error))
                }
            } else {
                let body: String
                var packageContents: TextTextTextBundleContents?
                if let url {
                    do {
                        if representation.isTextBundleFamily {
                            guard let temporaryDirectory = fpTemporaryDirectory() else {
                                done(nil, Self.fpError(.serverUnreachable)); return
                            }
                            // read() auto-detects an open `.textbundle` directory vs
                            // a zipped `.textpack` and unzips the latter.
                            let contents = try TextTextTextBundlePackage.read(
                                from: url, in: temporaryDirectory)
                            packageContents = contents
                            body = contents.markdown
                        } else {
                            body = try String(contentsOf: url, encoding: .utf8)
                        }
                    } catch {
                        done(nil, Self.unreadableContentsError(error)); return
                    }
                } else {
                    // File Provider may create a genuinely empty document without
                    // supplying a contents URL. A supplied but unreadable URL is
                    // handled above and must never become an empty server write.
                    body = ""
                }
                guard !Task.isCancelled else { return }
                let hasLocalAssets = packageContents?.assets.contains {
                    $0.remoteURL == nil
                } ?? false
                switch await api.createFile(
                    // A package asset URL cannot be assigned until the server
                    // has issued a stable post id. Create an empty revision,
                    // upload immutable assets, then commit the Markdown last.
                    body: hasLocalAssets ? "" : body,
                    documentJSON: hasLocalAssets ? nil : packageContents?.documentJSON,
                    folderId: parentId,
                    representation: representation,
                    idempotencyKey: idempotencyKey
                ) {
                case .failure(let error): done(nil, Self.nsError(from: error))
                case .success(let initial):
                    let core = makeCore(
                        api, handle: handle, name: descriptorName(for: handle))
                    var created = initial
                    if hasLocalAssets, let packageContents {
                        let initialHash = initial.contentHash(for: representation)
                        guard let postId = initial.id, !postId.isEmpty,
                              !initialHash.isEmpty else {
                            done(nil, Self.fpError(.cannotSynchronize)); return
                        }
                        let canonical: UploadedPackageContents
                        switch await uploadLocalPackageAssets(
                            packageContents, postId: postId, handle: handle, api: api
                        ) {
                        case .failure(let error):
                            _ = await api.deleteFile(postId: postId, ifMatch: initialHash)
                            done(nil, Self.nsError(from: error)); return
                        case .success(let value): canonical = value
                        }
                        guard !Task.isCancelled else { return }
                        switch await api.putFile(
                            postId: postId, body: canonical.markdown,
                            documentJSON: canonical.documentJSON,
                            ifMatch: initialHash
                        ) {
                        case .failure(let error):
                            _ = await api.deleteFile(
                                postId: postId, ifMatch: initialHash)
                            done(nil, Self.nsError(from: error)); return
                        case .success(let saved): created = saved
                        }
                    }
                    // Title the new post from the Finder filename (the filename IS
                    // the title now, not the slug). Leave the slug/URL to the
                    // server. Skip the PATCH when the title already matches.
                    let title = TextTextFilename.titleFromFilename(
                        filename, representation: representation)
                    let createdHash = created.contentHash(for: representation)
                    guard let id = created.id, !createdHash.isEmpty,
                          !title.isEmpty, created.title != title else {
                        await finishCreatedFile(
                            created, parentId: parentId, handle: handle,
                            core: core, done: done)
                        return
                    }
                    guard !Task.isCancelled else { return }
                    switch await api.patchFile(
                        postId: id, folderId: nil, slug: nil, title: title,
                        ifMatch: createdHash) {
                    case .success(let renamed):
                        await finishCreatedFile(
                            renamed, parentId: parentId, handle: handle,
                            core: core, done: done)
                    case .failure(let error) where Self.canDefer(error):
                        // The body exists server-side. Keep that successful create
                        // and ask File Provider to retry only the title/filename.
                        finish(
                            Self.fileItem(created, parentId: parentId, handle: handle),
                            [.filename], false, nil)
                    case .failure:
                        // A permanent title rejection cannot be retried. Return the
                        // created server item so Finder adopts its authoritative name.
                        await finishCreatedFile(
                            created, parentId: parentId, handle: handle,
                            core: core, done: done)
                    }
                }
            }
        }
        requestState.install(task)
    }

    /// A create completion and the next enumeration must describe the same
    /// server item with the same version. In particular, mapping a POST/PATCH
    /// response alone skips the enumerator's sibling-aware filename
    /// disambiguation, so a duplicate title can return `Name.textpack` here but
    /// `Name [id].textpack` from enumerateChanges. Because filename is part of
    /// metadataVersion, File Provider then keeps the local create pending.
    /// Re-read the parent through the canonical child path. When the committed
    /// item is visible, return that exact enumerated value. A test double or a
    /// briefly lagging read that omits it still gets the write response run
    /// through the same sibling disambiguation before completion.
    private func finishCreatedFile(
        _ entry: TextTextManifestItem, parentId: String, handle: String,
        core: WorkspaceEnumerator,
        done: @escaping (NSFileProviderItem?, (any Error)?) -> Void
    ) async {
        guard let responseItem = TextTextItemMapper.item(
            for: entry, inFolder: parentId, handle: handle, readOnly: false
        ) else {
            done(nil, Self.fpError(.cannotSynchronize))
            return
        }
        switch await core.children(of: .folder(handle: handle, id: parentId)) {
        case .failure(let error):
            done(nil, Self.nsError(from: error))
        case .success(let children):
            if let canonical = children.first(where: {
                $0.identifier == responseItem.identifier
            }) {
                done(TextTextFileProviderItem(canonical), nil)
                return
            }
            var canonicalChildren = children
            canonicalChildren.append(responseItem)
            let canonical = TextTextFilename.disambiguate(canonicalChildren)
                .first { $0.identifier == responseItem.identifier }
            guard let canonical else {
                done(nil, Self.fpError(.cannotSynchronize))
                return
            }
            done(TextTextFileProviderItem(canonical), nil)
        }
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
        let requestState = FileProviderRequestState()
        let finish: (
            NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?
        ) -> Void = { item, pending, shouldFetch, error in
            _ = requestState.complete {
                completionHandler(item, pending, shouldFetch, error)
            }
        }
        let done: (NSFileProviderItem?, (any Error)?) -> Void = {
            finish($0, [], false, $1)
        }
        requestState.progress.cancellationHandler = { [weak requestState] in
            requestState?.cancel {
                completionHandler(nil, [], false, Self.cancelledError())
            }
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
        guard case .file(let handle, let postId)? = TextTextItemIdentifier(item.itemIdentifier) else {
            // Finder changes a directory's local mtime when its children are
            // materialized or edited. File Provider reports that as a metadata
            // upload even though TextText has no server-side directory mtime. It
            // must be acknowledged, otherwise macOS retries it forever and
            // draws a cloud error badge on an otherwise fully synced folder.
            // Renames remain the only container field sent to the server;
            // moves and content changes are still rejected below.
            guard changedFields.subtracting(Self.supportedContainerFields).isEmpty else {
                done(nil, Self.readOnlyError()); return requestState.progress
            }
            if case .folder(let handle, let folderId)? = TextTextItemIdentifier(item.itemIdentifier),
               let api = apiFactory(handle) {
                let identifier = TextTextItemIdentifier.folder(handle: handle, id: folderId)
                let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
                let task = Task {
                    let current: TextTextItem
                    switch await core.item(for: identifier) {
                    case .failure(let error): done(nil, Self.nsError(from: error)); return
                    case .success(let value): current = value
                    }
                    guard changedFields.contains(.filename) else {
                        fpLog.info("modifyItem folder \(folderId, privacy: .public) acknowledged local metadata")
                        done(TextTextFileProviderItem(current), nil)
                        return
                    }
                    guard Self.metadataBase(version, matches: current) else {
                        finishModifyConflict(
                            current: current, changedFields: changedFields,
                            options: options, finish: finish)
                        return
                    }
                    guard item.filename != current.filename else {
                        done(TextTextFileProviderItem(current), nil)
                        return
                    }
                    guard !Task.isCancelled else { return }
                    let suffix = TextTextFilename.collisionSuffix(folderId)
                    var component = item.filename
                    if component.hasSuffix(suffix) { component.removeLast(suffix.count) }
                    let folderName = TextTextFilename.decodeComponent(component)
                    switch await api.renameFolder(folderId: folderId, name: folderName) {
                    case .success(let folder):
                        fpLog.info("modifyItem folder \(folderId, privacy: .public) renamed to '\(folder.name, privacy: .public)'")
                        done(TextTextFileProviderItem(
                            TextTextItemMapper.item(for: folder, handle: handle, readOnly: false)), nil)
                    case .failure(.conflict):
                        await resolveModifyConflict(
                            identifier: identifier, core: core,
                            changedFields: changedFields, options: options,
                            finish: finish)
                    case .failure(let error): done(nil, Self.nsError(from: error))
                    }
                }
                requestState.install(task)
                return requestState.progress
            }
            // Renaming the workspace container renames the workspace itself (its
            // display name). Decode the portable Finder component before sending
            // the human label back to the server.
            if case .workspace(let handle)? = TextTextItemIdentifier(item.itemIdentifier),
               let api = apiFactory(handle) {
                let task = Task {
                    let current: TextTextItem
                    switch await currentWorkspaceItem(handle: handle, api: api) {
                    case .failure(let error): done(nil, Self.nsError(from: error)); return
                    case .success(let value): current = value
                    }
                    guard changedFields.contains(.filename) else {
                        fpLog.info("modifyItem workspace \(handle, privacy: .public) acknowledged local metadata")
                        done(TextTextFileProviderItem(current), nil)
                        return
                    }
                    guard Self.metadataBase(version, matches: current) else {
                        finishModifyConflict(
                            current: current, changedFields: changedFields,
                            options: options, finish: finish)
                        return
                    }
                    guard item.filename != current.filename else {
                        done(TextTextFileProviderItem(current), nil)
                        return
                    }
                    guard !Task.isCancelled else { return }
                    let suffix = TextTextFilename.collisionSuffix(handle)
                    var component = item.filename
                    if component.hasSuffix(suffix) { component.removeLast(suffix.count) }
                    switch await api.renameWorkspace(
                        name: TextTextFilename.decodeComponent(component)
                    ) {
                    case .success(let blog):
                        fpLog.info("modifyItem workspace \(handle, privacy: .public) renamed to '\(blog.name, privacy: .public)'")
                        // The app owns credential handoff publication. Writing it
                        // here can race sign-out and restore stale credentials;
                        // the server result is enough to settle this FP request.
                        done(TextTextFileProviderItem(TextTextItemMapper.workspaceItem(
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
                requestState.install(task)
                return requestState.progress
            }
            done(nil, Self.readOnlyError()); return requestState.progress
        }
        guard let api = apiFactory(handle) else {
            done(nil, Self.fpError(.notAuthenticated)); return requestState.progress
        }
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        let task = Task {
            let changesMetadata = changedFields.contains(.filename)
                || changedFields.contains(.parentItemIdentifier)
            guard let baseHash = Self.usableBaseHash(version) else {
                await resolveModifyConflict(
                    identifier: .file(handle: handle, id: postId), core: core,
                    changedFields: changedFields, options: options, finish: finish)
                return
            }
            var currentItem: TextTextItem?
            if changesMetadata || changedFields.contains(.contents) {
                let current: TextTextItem
                switch await core.item(for: .file(handle: handle, id: postId)) {
                case .failure(let error): done(nil, Self.nsError(from: error)); return
                case .success(let value): current = value
                }
                guard !changesMetadata || Self.metadataBase(version, matches: current) else {
                    finishModifyConflict(
                        current: current, changedFields: changedFields,
                        options: options, finish: finish)
                    return
                }
                currentItem = current
            }

            var body: String?
            var documentJSON: String?
            if changedFields.contains(.contents) {
                guard let newContents else {
                    done(nil, Self.unreadableContentsError(nil)); return
                }
                do {
                    if currentItem?.representation?.isTextBundleFamily == true {
                        guard let temporaryDirectory = fpTemporaryDirectory() else {
                            done(nil, Self.fpError(.serverUnreachable)); return
                        }
                        // read() unzips a `.textpack` and reads an open `.textbundle`.
                        let contents = try TextTextTextBundlePackage.read(
                            from: newContents, in: temporaryDirectory)
                        switch await uploadLocalPackageAssets(
                            contents, postId: postId, handle: handle, api: api
                        ) {
                        case .failure(let error):
                            done(nil, Self.nsError(from: error)); return
                        case .success(let canonical):
                            body = canonical.markdown
                            documentJSON = canonical.documentJSON
                        }
                    } else {
                        let local = try String(contentsOf: newContents, encoding: .utf8)
                        if currentItem?.representation == .markdown,
                           let currentItem {
                            switch await plainDocumentContext(
                                item: currentItem, api: api) {
                            case .failure(let error):
                                done(nil, Self.nsError(from: error)); return
                            case .success(let context):
                                body = TextTextCentralAttachments.canonicalMarkdown(
                                    local: local, manifest: context.manifest,
                                    handle: handle,
                                    workspaceFilename: context.workspaceFilename,
                                    documentFilename: context.documentFilename,
                                    folderDepth: context.folderDepth)
                            }
                        } else {
                            body = local
                        }
                    }
                } catch {
                    done(nil, Self.unreadableContentsError(error)); return
                }
            } else {
                body = nil
                documentJSON = nil
            }

            // Validate the complete intent before applying either half of a
            // compound content+move operation. A malformed, foreign, or missing
            // destination must never turn into a successful unchanged move (and
            // must not leave a content PUT committed first).
            var newFolderId: String?
            if changedFields.contains(.parentItemIdentifier),
               item.parentItemIdentifier.rawValue
                    != currentItem?.parentIdentifier.rawValue {
                guard case .folder(let parentHandle, let folderId)? =
                        TextTextItemIdentifier(item.parentItemIdentifier),
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
               item.filename != currentItem?.filename {
                let representation = currentItem?.representation
                    ?? TextTextFileRepresentation.inferred(fromFilename: item.filename)
                    ?? .markdown
                let title = TextTextFilename.titleFromFilename(
                    item.filename, stableId: postId,
                    representation: representation)
                guard !title.isEmpty else {
                    done(nil, Self.fpError(.cannotSynchronize)); return
                }
                newTitle = title
            } else {
                newTitle = nil
            }

            if body == nil, newFolderId == nil, newTitle == nil,
               let currentItem {
                done(TextTextFileProviderItem(currentItem), nil)
                return
            }

            guard !Task.isCancelled else { return }

            // A metadata PATCH following a content PUT must build on the exact
            // hash returned by that PUT, not on the original base.
            var patchBaseHash = baseHash
            var savedContentItem: TextTextManifestItem?
            if let body {
                switch await api.putFile(
                    postId: postId, body: body, documentJSON: documentJSON,
                    ifMatch: baseHash) {
                case .failure(.conflict):
                    await resolveModifyConflict(
                        identifier: .file(handle: handle, id: postId), core: core,
                        changedFields: changedFields, options: options, finish: finish)
                    return
                case .failure(let error): done(nil, Self.nsError(from: error)); return
                case .success(let saved):
                    let representation = currentItem?.representation ?? .markdown
                    let savedHash = saved.contentHash(for: representation)
                    guard !savedHash.isEmpty else {
                        done(nil, Self.fpError(.cannotSynchronize)); return
                    }
                    patchBaseHash = savedHash
                    savedContentItem = saved
                }
            }

            if newFolderId != nil || newTitle != nil {
                guard !Task.isCancelled else { return }
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
                    let pending = changedFields.intersection(Self.serverMetadataFields)
                    if Self.canDefer(error), !pending.isEmpty,
                       let savedContentItem,
                       let parent = currentItem?.parentIdentifier,
                       case .folder(let parentHandle, let parentId) = parent,
                       parentHandle == handle,
                       let partial = Self.fileItem(
                            savedContentItem, parentId: parentId, handle: handle) {
                        fpLog.info("modifyItem \(postId, privacy: .public) saved content; metadata remains pending")
                        finish(partial, pending, false, nil)
                    } else {
                        done(nil, Self.nsError(from: error))
                    }
                    return
                }
            }
            // Return the item's current server state.
            switch await core.item(for: .file(handle: handle, id: postId)) {
            case .success(let updated):
                fpLog.info("modifyItem \(postId, privacy: .public) saved to server")
                done(TextTextFileProviderItem(updated), nil)
            case .failure(let error): done(nil, Self.nsError(from: error))
            }
        }
        requestState.install(task)
        return requestState.progress
    }

    // MARK: Delete

    public func deleteItem(
        identifier: NSFileProviderItemIdentifier,
        baseVersion version: NSFileProviderItemVersion,
        options: NSFileProviderDeleteItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping ((any Error)?) -> Void
    ) -> Progress {
        let requestState = FileProviderRequestState()
        let done: ((any Error)?) -> Void = { error in
            _ = requestState.complete { completionHandler(error) }
        }
        requestState.progress.cancellationHandler = { [weak requestState] in
            requestState?.cancel { completionHandler(Self.cancelledError()) }
        }
        // Only files delete; folder delete is deferred (not advertised).
        guard case .file(let handle, let postId)? = TextTextItemIdentifier(identifier) else {
            done(Self.readOnlyError()); return requestState.progress
        }
        guard let api = apiFactory(handle) else {
            done(Self.fpError(.notAuthenticated)); return requestState.progress
        }
        let itemIdentifier = TextTextItemIdentifier.file(handle: handle, id: postId)
        let core = makeCore(api, handle: handle, name: descriptorName(for: handle))
        let task = Task {
            guard let hash = Self.usableBaseHash(version),
                  Self.isUsableBaseComponent(version.metadataVersion) else {
                done(await rejectedDeletionError(identifier: itemIdentifier, core: core))
                return
            }
            let current: TextTextItem
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
            guard !Task.isCancelled else { return }
            switch await api.deleteFile(postId: postId, ifMatch: hash) {
            case .success: done(nil)
            case .failure(.notFound): done(nil)
            case .failure(.conflict):
                done(await rejectedDeletionError(identifier: itemIdentifier, core: core))
            case .failure(let error): done(Self.nsError(from: error))
            }
        }
        requestState.install(task)
        return requestState.progress
    }

    // MARK: Helpers

    /// Resolve package-local `assets/<name>` references to immutable server
    /// URLs. Assets whose TextBundle metadata still matches their bytes retain
    /// their existing URL; new or replaced bytes upload first, and the caller
    /// commits the returned Markdown in one final PUT.
    private struct UploadedPackageContents {
        let markdown: String
        let documentJSON: String?
    }

    private func uploadLocalPackageAssets(
        _ contents: TextTextTextBundleContents, postId: String, handle: String,
        api: TextTextSyncAPI
    ) async -> Result<UploadedPackageContents, TextTextSyncError> {
        var markdown = contents.markdown
        var remoteURLsByFilename: [String: String] = [:]
        for asset in contents.assets
            .filter({ $0.remoteURL == nil })
            .sorted(by: { $0.filename < $1.filename }) {
            guard !Task.isCancelled else {
                return .failure(.network("cancelled"))
            }
            guard TextTextDocumentAssets.isSafeFilename(asset.filename),
                  let contentType = asset.contentType
                    ?? TextTextDocumentAssets.inferredContentType(filename: asset.filename) else {
                return .failure(.rejected(
                    "Only image and video assets with portable filenames are supported"))
            }
            let uploaded: TextTextArtifact
            switch await api.uploadAsset(
                postId: postId, filename: asset.filename, data: asset.data,
                contentType: contentType
            ) {
            case .failure(let error): return .failure(error)
            case .success(let value): uploaded = value
            }
            guard uploaded.role == "asset",
                  let url = URL(string: uploaded.url),
                  TextTextDocumentAssets.isTextTextHostedAssetURL(
                    url, handle: handle, postId: postId) else {
                return .failure(.rejected("Server returned an invalid asset URL"))
            }
            remoteURLsByFilename[asset.filename] = uploaded.url
        }
        markdown = TextTextDocumentAssets.canonicalMarkdown(
            local: markdown, remoteURLsByFilename: remoteURLsByFilename)
        do {
            let documentJSON = try TextTextTextBundlePackage.canonicalDocumentJSON(
                local: contents.documentJSON,
                remoteURLsByFilename: remoteURLsByFilename)
            return .success(UploadedPackageContents(
                markdown: markdown, documentJSON: documentJSON))
        } catch {
            return .failure(.decode("document.json could not be canonicalized"))
        }
    }

    private struct PlainDocumentContext {
        let manifest: TextTextArtifactManifest
        let workspaceFilename: String
        let documentFilename: String
        let folderDepth: Int
    }

    /// Resolve the one synthetic attachment path used by an imported Markdown
    /// file. The hierarchy comes from stable server ids, not from parsing the
    /// user-visible path, so punctuation such as `?` can never corrupt identity.
    private func plainDocumentContext(
        item: TextTextItem, api: TextTextSyncAPI
    ) async -> Result<PlainDocumentContext, TextTextSyncError> {
        guard case .file(let handle, let postId) = item.identifier,
              item.representation == .markdown,
              case .folder(let parentHandle, let folderId) = item.parentIdentifier,
              parentHandle == handle else { return .failure(.notFound) }

        async let workspaceResult = api.workspace()
        async let artifactResult = api.documentArtifacts(postId: postId)

        let workspace: TextTextWorkspace
        switch await workspaceResult {
        case .failure(let error): return .failure(error)
        case .success(let value): workspace = value
        }

        let manifest: TextTextArtifactManifest
        switch await artifactResult {
        case .failure(.notFound):
            manifest = TextTextArtifactManifest(
                postId: postId, slug: "", fileHash: item.contentHash ?? "",
                artifacts: [])
        case .failure(let error): return .failure(error)
        case .success(let value): manifest = value
        }
        guard manifest.postId == postId,
              manifest.fileHash == item.contentHash else {
            return .failure(.network(
                "Document assets changed during Markdown materialization"))
        }

        var depth = 0
        var current: String? = folderId
        var visited = Set<String>()
        while let id = current {
            guard visited.insert(id).inserted,
                  let folder = workspace.folders.first(where: { $0.id == id }) else {
                return .failure(.decode("Invalid workspace folder hierarchy"))
            }
            depth += 1
            current = folder.parentId
        }

        return .success(PlainDocumentContext(
            manifest: manifest,
            workspaceFilename: TextTextCentralAttachments.workspaceFolderFilename(
                displayName: descriptorName(for: handle), handle: handle),
            documentFilename: TextTextCentralAttachments.documentFolderFilename(for: item),
            folderDepth: depth))
    }

    private struct FetchedRevision {
        let item: TextTextItem
        let content: TextTextFileContent
    }

    private func consistentFetch(
        postId: String, core: WorkspaceEnumerator, api: TextTextSyncAPI
    ) async -> Result<FetchedRevision, TextTextSyncError> {
        let identifier = TextTextItemIdentifier.file(handle: core.handle, id: postId)
        for attempt in 1...3 {
            let before: TextTextItem
            switch await core.item(for: identifier) {
            case .failure(let error): return .failure(error)
            case .success(let item): before = item
            }

            let content: TextTextFileContent
            switch await api.fileContent(
                postId: postId,
                representation: before.representation ?? .markdown) {
            case .failure(let error): return .failure(error)
            case .success(let value): content = value
            }

            let after: TextTextItem
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
        guard isUsableBaseComponent(version.contentVersion) else { return nil }
        return TextTextFileProviderItem.serverHash(from: version.contentVersion)
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
        _ version: NSFileProviderItemVersion, matches current: TextTextItem
    ) -> Bool {
        guard isUsableBaseComponent(version.metadataVersion) else { return false }
        return TextTextFileProviderItem(current).itemVersion.metadataVersion
            == version.metadataVersion
    }

    /// Container fields TextText can settle without losing an actual structural
    /// edit. Finder owns the local-only metadata; `.filename` is the one field
    /// persisted to the TextText server. Parent and contents are intentionally
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

    private static var serverMetadataFields: NSFileProviderItemFields {
        [.filename, .parentItemIdentifier]
    }

    /// A partial write may defer only failures that can succeed unchanged on a
    /// retry. Permanent validation/auth/not-found failures must surface instead
    /// of leaving an item pending forever.
    private static func canDefer(_ error: TextTextSyncError) -> Bool {
        switch error {
        case .network(_), .decode(_): return true
        case .http(let status, _): return (500...599).contains(status)
        case .notFound, .conflict, .rejected(_): return false
        }
    }

    private func resolveModifyConflict(
        identifier: TextTextItemIdentifier,
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
        current: TextTextItem,
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
        finish(TextTextFileProviderItem(current), [], !current.isFolder, nil)
    }

    private func rejectedDeletionError(
        identifier: TextTextItemIdentifier, core: WorkspaceEnumerator
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

    private static func rejectedDeletionError(current: TextTextItem) -> NSError {
        NSError.fileProviderErrorForRejectedDeletion(
            of: TextTextFileProviderItem(current))
    }

    private func currentWorkspaceItem(
        handle: String, api: TextTextSyncAPI
    ) async -> Result<TextTextItem, TextTextSyncError> {
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
    static func handoffAPI(for handle: String) -> TextTextSyncAPI? {
        guard let handoff = FileProviderHandoffStore.load(),
              let descriptor = handoff.descriptor(for: handle),
              let origin = URL(string: descriptor.origin) else { return nil }
        return LiveTextTextSyncAPI(origin: origin, token: descriptor.token)
    }

    /// The workspaces the app has handed off (one folder each under the root).
    private func handoffDescriptors() -> [FileProviderWorkspace] {
        descriptorsProvider()
    }

    private func descriptorName(for handle: String) -> String {
        handoffDescriptors().first(where: { $0.handle == handle })?.name ?? handle
    }

    /// Use the manifest URL verbatim when absolute, or resolve an origin-relative
    /// value against the exact origin handed off for this workspace. Never infer
    /// a link from the mutable slug or display filename.
    private func resolvedManifestLink(for item: TextTextItem, handle: String) -> String? {
        guard let raw = item.manifestURL?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return nil }
        let resolved: URL?
        if let absolute = URL(string: raw), absolute.scheme != nil {
            resolved = absolute
        } else if let originString = handoffDescriptors()
                    .first(where: { $0.handle == handle })?.origin,
                  let origin = URL(string: originString) {
            resolved = URL(string: raw, relativeTo: origin)?.absoluteURL
        } else {
            resolved = nil
        }
        guard let resolved,
              let scheme = resolved.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              resolved.host != nil else { return nil }
        return resolved.absoluteString
    }

    static func appActionURL(action: String, postId: String, link: String) -> URL? {
        guard !postId.isEmpty,
              let target = URL(string: link),
              let scheme = target.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              target.host != nil else { return nil }
        var pathAllowed = CharacterSet.urlPathAllowed
        pathAllowed.remove(charactersIn: "/?#")
        guard let encodedId = postId.addingPercentEncoding(withAllowedCharacters: pathAllowed)
        else { return nil }
        var components = URLComponents()
        components.scheme = "texttext-app"
        components.host = "item"
        components.percentEncodedPath = "/\(encodedId)"
        components.queryItems = [
            URLQueryItem(name: "action", value: action),
            URLQueryItem(name: "url", value: target.absoluteString),
        ]
        return components.url
    }

    private static func copyToPasteboard(_ link: String) -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.setString(link, forType: .string)
    }

    private static func openURL(_ url: URL) -> Bool {
        NSWorkspace.shared.open(url)
    }

    private func makeCore(_ api: TextTextSyncAPI, handle: String, name: String) -> WorkspaceEnumerator {
        WorkspaceEnumerator(
            api: api, handle: handle, workspaceName: name,
            readOnly: false, domainName: domain.displayName)
    }

    /// The path of a folder id (needed for createFolder, which takes a parent
    /// path). Resolved from the workspace listing.
    private func folderPath(of folderId: String, api: TextTextSyncAPI) async -> String? {
        if case .success(let ws) = await api.workspace() {
            return ws.folders.first(where: { $0.id == folderId })?.path
        }
        return nil
    }

    private func fpTemporaryDirectory() -> URL? {
        if let temporaryDirectoryProvider { return temporaryDirectoryProvider() }
        return try? NSFileProviderManager(for: domain)?.temporaryDirectoryURL()
    }

    /// The per-container anchor snapshots that turn an anchor mismatch into a
    /// precise change delta. Lives in the sandboxed Caches (a pure cache: loss
    /// just falls back to the full-reconcile expiry), NOT the FP temporary
    /// directory, which sweepStaleTemporaries prunes on a 10-minute horizon.
    static func anchorSnapshotStore() -> AnchorSnapshotStore? {
        guard let caches = FileManager.default.urls(
            for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return AnchorSnapshotStore(
            directory: caches.appendingPathComponent("texttext-anchor-snapshots", isDirectory: true))
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

    private static func fileItem(_ entry: TextTextManifestItem, parentId: String, handle: String) -> NSFileProviderItem? {
        TextTextItemMapper.item(for: entry, inFolder: parentId, handle: handle, readOnly: false)
            .map(TextTextFileProviderItem.init)
    }

    /// The synthetic domain-root item (its children are the workspace folders).
    private static func syntheticRootItem(name: String) -> TextTextFileProviderItem {
        TextTextFileProviderItem(TextTextItem(
            identifier: .rootContainer, parentIdentifier: .rootContainer,
            filename: name, isFolder: true, kind: .folder,
            typeIdentifier: TextTextItem.folderTypeIdentifier, serverId: nil,
            contentHash: nil, documentSize: nil, creationDate: nil,
            contentModificationDate: nil, capabilities: .readOnlyFolder))
    }

    private static func nsError(from error: TextTextSyncError) -> NSError {
        // Every write failure (create/modify/delete) funnels through here; log it
        // so a broken write path is visible in the unified log.
        fpLog.error("sync write error: \(String(describing: error), privacy: .public)")
        return TextTextEnumeratorAdapter.bridge(error)
    }

    private static func fpError(_ code: NSFileProviderError.Code) -> NSError {
        NSError(domain: NSFileProviderErrorDomain, code: code.rawValue)
    }

    private static func actionError(_ description: String) -> NSError {
        NSError(
            domain: NSFileProviderErrorDomain,
            code: NSFileProviderError.cannotSynchronize.rawValue,
            userInfo: [NSLocalizedDescriptionKey: description])
    }

    private static func cancelledError() -> NSError {
        NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError)
    }

    private static func readOnlyError() -> NSError {
        NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError)
    }
}
