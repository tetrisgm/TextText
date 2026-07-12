import FileProvider
import Foundation
import WriteFileProviderKit
import WriteFileProviderBridge

/// Write's replicated File Provider. Read-only in Phase 2: it enumerates the
/// workspace from the server and materializes file bodies on demand. The three
/// mutation methods are required by `NSFileProviderReplicatedExtension` even for
/// a read-only provider (a direct filesystem write can still reach them), so
/// they exist and reject; read-only is a runtime posture, not a smaller protocol.
///
/// The server (write.ramine.net /api/sync/v1) is the source of truth. The
/// extension reads the workspace token + origin from the shared app-group
/// container each request, so a sign-in that lands after the extension launched
/// is picked up without a relaunch.
public final class FileProviderExtension: NSObject, NSFileProviderReplicatedExtension {

    private let domain: NSFileProviderDomain

    public required init(domain: NSFileProviderDomain) {
        self.domain = domain
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
        guard let api = currentAPI() else {
            completionHandler(nil, Self.fpError(.notAuthenticated))
            return progress
        }
        let core = makeEnumeratorCore(api)
        Task {
            let result = await core.item(for: wid)
            switch result {
            case .success(let item):
                completionHandler(WriteFileProviderItem(item), nil)
            case .failure(let error):
                completionHandler(nil, Self.nsError(from: error))
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
        guard let api = currentAPI() else {
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
                    completionHandler(nil, nil, Self.fpError(.serverUnreachable))
                    return
                }
                let destination = dir.appendingPathComponent(UUID().uuidString)
                do {
                    try Data(content.text.utf8).write(to: destination)
                } catch {
                    completionHandler(nil, nil, error)
                    return
                }
                // The item's contentVersion derives from the same server hash as
                // these bytes (WriteFileProviderItem), so metadata and content
                // agree. The system clones then unlinks `destination`; we must
                // not touch it after handing it over.
                let item = (try? itemResult.get()).map(WriteFileProviderItem.init)
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
        guard let api = currentAPI() else {
            throw Self.fpError(.notAuthenticated)
        }
        return WriteEnumeratorAdapter(container: wid, core: makeEnumeratorCore(api))
    }

    // MARK: Mutations (required by the protocol; read-only rejects them)

    public func createItem(
        basedOn itemTemplate: NSFileProviderItem,
        fields: NSFileProviderItemFields,
        contents url: URL?,
        options: NSFileProviderCreateItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, (any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        completionHandler(nil, [], false, Self.readOnlyError())
        progress.completedUnitCount = 1
        return progress
    }

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
        completionHandler(nil, [], false, Self.readOnlyError())
        progress.completedUnitCount = 1
        return progress
    }

    public func deleteItem(
        identifier: NSFileProviderItemIdentifier,
        baseVersion version: NSFileProviderItemVersion,
        options: NSFileProviderDeleteItemOptions = [],
        request: NSFileProviderRequest,
        completionHandler: @escaping ((any Error)?) -> Void
    ) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        completionHandler(Self.readOnlyError())
        progress.completedUnitCount = 1
        return progress
    }

    // MARK: Helpers

    /// Read the handoff freshly each call so a later sign-in is picked up without
    /// a relaunch. nil means not signed in yet (Finder shows a needs-auth state
    /// until the app signals the enumerator).
    private func currentAPI() -> LiveWriteSyncAPI? {
        guard
            let group = Bundle.main.object(forInfoDictionaryKey: "WriteAppGroupIdentifier") as? String,
            !group.isEmpty, group != "WRITE_APP_GROUP",
            let container = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: group),
            let data = try? Data(
                contentsOf: container.appendingPathComponent(FileProviderHandoff.filename)),
            let handoff = FileProviderHandoff.decode(data),
            let origin = URL(string: handoff.origin)
        else { return nil }
        return LiveWriteSyncAPI(origin: origin, token: handoff.token)
    }

    private func makeEnumeratorCore(_ api: LiveWriteSyncAPI) -> WorkspaceEnumerator {
        WorkspaceEnumerator(api: api, readOnly: true, domainName: domain.displayName)
    }

    /// The system-managed, same-volume temp directory for materialized bodies.
    /// Never `NSTemporaryDirectory()` (wrong volume; the clone would fail).
    private func fpTemporaryDirectory() -> URL? {
        try? NSFileProviderManager(for: domain)?.temporaryDirectoryURL()
    }

    /// A crash during a previous fetch can leave a temp file behind; clear them
    /// on launch so the directory does not accrete.
    private func sweepStaleTemporaries() {
        guard let dir = fpTemporaryDirectory(),
              let entries = try? FileManager.default.contentsOfDirectory(
                  at: dir, includingPropertiesForKeys: nil) else { return }
        for entry in entries { try? FileManager.default.removeItem(at: entry) }
    }

    private static func nsError(from error: WriteSyncError) -> NSError {
        WriteEnumeratorAdapter.bridge(error)
    }

    private static func fpError(_ code: NSFileProviderError.Code) -> NSError {
        NSError(domain: NSFileProviderErrorDomain, code: code.rawValue)
    }

    /// Read-only rejection. Finder never offers these (capabilities carry no
    /// write bits); this only fires on a direct filesystem mutation.
    private static func readOnlyError() -> NSError {
        NSError(domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError)
    }
}
