import FileProvider
import Foundation
import UniformTypeIdentifiers
import WriteFileProviderCore

// Add this file to an Xcode File Provider extension target.
// It is intentionally outside mac/Sources so SwiftPM does not build it.
@objc(WriteFileProviderExtension)
final class WriteFileProviderExtension: NSObject, NSFileProviderReplicatedExtension {
    private let domain: NSFileProviderDomain
    private let core: WriteFileProviderCore

    required init(domain: NSFileProviderDomain) {
        self.domain = domain
        self.core = WriteFileProviderCore(api: XcodeWiredSyncAPI(domain: domain))
        super.init()
    }

    func invalidate() {}

    func item(
        for identifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        schedule {
            do {
                let metadata = try await self.core.item(for: WriteFileProviderItemIdentifier(identifier))
                completionHandler(WriteFileProviderItemAdapter(metadata), nil)
            } catch {
                completionHandler(nil, error)
            }
        }
    }

    func fetchContents(
        for itemIdentifier: NSFileProviderItemIdentifier,
        version requestedVersion: NSFileProviderItemVersion?,
        request: NSFileProviderRequest,
        completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
    ) -> Progress {
        schedule {
            do {
                let fetched = try await self.core.fetchContents(for: WriteFileProviderItemIdentifier(itemIdentifier))
                let fileURL = try Self.writeTemporaryContents(fetched)
                completionHandler(fileURL, WriteFileProviderItemAdapter(fetched.metadata), nil)
            } catch {
                completionHandler(nil, nil, error)
            }
        }
    }

    func createItem(
        basedOn itemTemplate: NSFileProviderItem,
        fields: NSFileProviderItemFields,
        contents url: URL?,
        options: NSFileProviderCreateItemOptions,
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
    ) -> Progress {
        schedule {
            do {
                let contents = try url.map { try Data(contentsOf: $0) }
                let metadata = try await self.core.createItem(
                    parentIdentifier: WriteFileProviderItemIdentifier(itemTemplate.parentItemIdentifier),
                    filename: itemTemplate.filename,
                    contentType: itemTemplate.contentType.identifier,
                    contents: contents
                )
                completionHandler(WriteFileProviderItemAdapter(metadata), [], false, nil)
            } catch {
                completionHandler(nil, fields, false, error)
            }
        }
    }

    func modifyItem(
        _ item: NSFileProviderItem,
        baseVersion version: NSFileProviderItemVersion,
        changedFields: NSFileProviderItemFields,
        contents newContents: URL?,
        options: NSFileProviderModifyItemOptions,
        request: NSFileProviderRequest,
        completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
    ) -> Progress {
        schedule {
            do {
                let contents = try newContents.map { try Data(contentsOf: $0) }
                let metadata = try await self.core.modifyItem(
                    identifier: WriteFileProviderItemIdentifier(item.itemIdentifier),
                    baseVersion: WriteFileProviderItemVersion(fileProviderVersion: version),
                    newFilename: item.filename,
                    contents: contents
                )
                completionHandler(WriteFileProviderItemAdapter(metadata), [], false, nil)
            } catch {
                completionHandler(nil, changedFields, false, error)
            }
        }
    }

    func deleteItem(
        identifier: NSFileProviderItemIdentifier,
        baseVersion version: NSFileProviderItemVersion,
        options: NSFileProviderDeleteItemOptions,
        request: NSFileProviderRequest,
        completionHandler: @escaping (Error?) -> Void
    ) -> Progress {
        schedule {
            do {
                try await self.core.deleteItem(identifier: WriteFileProviderItemIdentifier(identifier))
                completionHandler(nil)
            } catch {
                completionHandler(error)
            }
        }
    }

    func enumerator(
        for containerItemIdentifier: NSFileProviderItemIdentifier,
        request: NSFileProviderRequest
    ) throws -> NSFileProviderEnumerator {
        WriteFileProviderEnumerator(
            core: core,
            containerIdentifier: WriteFileProviderItemIdentifier(containerItemIdentifier)
        )
    }

    private func schedule(_ body: @escaping () async -> Void) -> Progress {
        let progress = Progress(totalUnitCount: 1)
        Task {
            guard !progress.isCancelled else { return }
            await body()
            progress.completedUnitCount = 1
        }
        return progress
    }

    private static func writeTemporaryContents(_ fetched: WriteFetchedFile) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WriteFileProvider", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension((fetched.metadata.filename as NSString).pathExtension)
        try fetched.contents.write(to: url, options: .atomic)
        return url
    }
}

private final class WriteFileProviderEnumerator: NSObject, NSFileProviderEnumerator {
    private let core: WriteFileProviderCore
    private let containerIdentifier: WriteFileProviderItemIdentifier

    init(core: WriteFileProviderCore, containerIdentifier: WriteFileProviderItemIdentifier) {
        self.core = core
        self.containerIdentifier = containerIdentifier
    }

    func invalidate() {}

    func enumerateItems(
        for observer: NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        Task {
            do {
                let token = page == .initialPageSortedByName ? nil : WriteFileProviderPageToken(data: page.rawValue)
                let result = try await core.enumerateItems(in: containerIdentifier, pageToken: token)
                observer.didEnumerate(result.items.map(WriteFileProviderItemAdapter.init))
                observer.finishEnumerating(upTo: result.nextPageToken.map { NSFileProviderPage($0.data) })
            } catch {
                observer.finishEnumeratingWithError(error)
            }
        }
    }

    func enumerateChanges(
        for observer: NSFileProviderChangeObserver,
        from anchor: NSFileProviderSyncAnchor
    ) {
        Task {
            do {
                let decoded = WriteFileProviderChangeAnchor(data: anchor.rawValue)
                let result = try await core.enumerateChanges(since: decoded)
                if result.requiresFullEnumeration {
                    observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired))
                    return
                }
                for change in result.changes {
                    switch change {
                    case .updated(let metadata):
                        observer.didUpdate(WriteFileProviderItemAdapter(metadata))
                    case .deleted(let identifier):
                        observer.didDeleteItems(withIdentifiers: [identifier.fileProviderIdentifier])
                    }
                }
                observer.finishEnumeratingChanges(
                    upTo: NSFileProviderSyncAnchor(result.anchor.data),
                    moreComing: false
                )
            } catch {
                observer.finishEnumeratingWithError(error)
            }
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        completionHandler(NSFileProviderSyncAnchor(WriteFileProviderChangeAnchor().data))
    }
}

private final class WriteFileProviderItemAdapter: NSObject, NSFileProviderItem {
    private let metadata: WriteFileProviderItemMetadata

    init(_ metadata: WriteFileProviderItemMetadata) {
        self.metadata = metadata
    }

    var itemIdentifier: NSFileProviderItemIdentifier {
        metadata.identifier.fileProviderIdentifier
    }

    var parentItemIdentifier: NSFileProviderItemIdentifier {
        metadata.parentIdentifier.fileProviderIdentifier
    }

    var filename: String {
        metadata.filename
    }

    var contentType: UTType {
        UTType(metadata.contentType) ?? .data
    }

    var contentModificationDate: Date? {
        metadata.contentModificationDate
    }

    var documentSize: NSNumber? {
        metadata.size.map { NSNumber(value: $0) }
    }

    var itemVersion: NSFileProviderItemVersion {
        NSFileProviderItemVersion(
            contentVersion: metadata.versions.contentVersion,
            metadataVersion: metadata.versions.metadataVersion
        )
    }

    var capabilities: NSFileProviderItemCapabilities {
        if metadata.isDirectory {
            return [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems]
        }
        return [.allowsReading, .allowsWriting, .allowsDeleting, .allowsRenaming]
    }
}

private extension WriteFileProviderItemIdentifier {
    init(_ identifier: NSFileProviderItemIdentifier) {
        if identifier == .rootContainer {
            self = .rootContainer
        } else if identifier == .workingSet {
            self = .workingSet
        } else {
            self.init(rawValue: identifier.rawValue)
        }
    }

    var fileProviderIdentifier: NSFileProviderItemIdentifier {
        if isRootContainer { return .rootContainer }
        if isWorkingSet { return .workingSet }
        return NSFileProviderItemIdentifier(rawValue)
    }
}

private extension WriteFileProviderItemVersion {
    init(fileProviderVersion: NSFileProviderItemVersion) {
        self.init(
            contentVersion: fileProviderVersion.contentVersion,
            metadataVersion: fileProviderVersion.metadataVersion
        )
    }
}

private final class XcodeWiredSyncAPI: WriteFileProviderAPI {
    private let domain: NSFileProviderDomain

    init(domain: NSFileProviderDomain) {
        self.domain = domain
    }

    func workspace() async throws -> WriteWorkspace {
        throw notConfigured()
    }

    func manifest(folderId: String, etag: String?) async throws -> WriteManifestResponse {
        throw notConfigured()
    }

    func fetchMarkdown(itemId: String) async throws -> WriteFetchedMarkdown {
        throw notConfigured()
    }

    func createFolder(parentPath: String, name: String) async throws -> WriteWorkspaceFolder {
        throw notConfigured()
    }

    func createMarkdown(
        in folder: WriteWorkspaceFolder,
        proposedFilename: String,
        contents: Data
    ) async throws -> WriteManifestItem {
        throw notConfigured()
    }

    func modifyMarkdown(
        itemId: String,
        baseVersion: String?,
        contents: Data
    ) async throws -> WriteManifestItem {
        throw notConfigured()
    }

    func deleteMarkdown(itemId: String) async throws {
        throw notConfigured()
    }

    func pollRemoteChanges(since cursor: String?, waitSeconds: Int) async throws -> WriteRemoteChangePoll {
        throw notConfigured()
    }

    private func notConfigured() -> Error {
        NSError(
            domain: "net.example.write.fileprovider",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey: "Wire XcodeWiredSyncAPI to the app group credentials and sync API before packaging \(domain.identifier.rawValue)."
            ]
        )
    }
}
