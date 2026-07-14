import FileProvider
import Foundation
import WriteFileProviderBridge
import WriteFileProviderKit

/// Read-only synthetic hierarchy for assets referenced by imported plain files:
/// Data / Attachments / Workspace / Document / asset. Write-created TextBundles
/// remain self-contained and are deliberately excluded.
final class CentralAttachmentsEnumerator: NSObject, NSFileProviderEnumerator {
    private let container: WriteItemIdentifier
    private let descriptors: [FileProviderWorkspace]
    private let apiFactory: (String) -> WriteSyncAPI?

    init(
        container: WriteItemIdentifier,
        descriptors: [FileProviderWorkspace],
        apiFactory: @escaping (String) -> WriteSyncAPI?
    ) {
        self.container = container
        self.descriptors = descriptors
        self.apiFactory = apiFactory
    }

    func invalidate() {}

    func enumerateItems(
        for observer: any NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        Task {
            switch await items() {
            case .success(let items):
                observer.didEnumerate(items.map(WriteFileProviderItem.init))
                observer.finishEnumerating(upTo: nil)
            case .failure(let error):
                observer.finishEnumeratingWithError(WriteEnumeratorAdapter.bridge(error))
            }
        }
    }

    func currentSyncAnchor(
        completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void
    ) {
        Task {
            switch await items() {
            case .success(let items):
                completionHandler(NSFileProviderSyncAnchor(
                    WorkspaceEnumerator.fingerprint(items)))
            case .failure:
                completionHandler(nil)
            }
        }
    }

    func enumerateChanges(
        for observer: any NSFileProviderChangeObserver,
        from syncAnchor: NSFileProviderSyncAnchor
    ) {
        Task {
            switch await items() {
            case .failure(let error):
                observer.finishEnumeratingWithError(WriteEnumeratorAdapter.bridge(error))
            case .success(let items):
                let current = WorkspaceEnumerator.fingerprint(items)
                if syncAnchor.rawValue == current {
                    observer.finishEnumeratingChanges(
                        upTo: syncAnchor, moreComing: false)
                } else {
                    observer.finishEnumeratingWithError(NSError(
                        domain: NSFileProviderErrorDomain,
                        code: NSFileProviderError.syncAnchorExpired.rawValue))
                }
            }
        }
    }

    func items() async -> Result<[WriteItem], WriteSyncError> {
        switch container {
        case .dataContainer:
            return .success([WriteCentralAttachments.attachmentsContainerItem()])
        case .attachmentsContainer:
            return .success(descriptors.map {
                WriteCentralAttachments.workspaceItem(
                    handle: $0.handle, displayName: $0.name)
            })
        case .attachmentWorkspace(let handle):
            return await documentItems(handle: handle)
        case .attachmentItem(let handle, let postId):
            switch await documentContext(handle: handle, postId: postId) {
            case .failure(let error): return .failure(error)
            case .success(let context):
                return .success(context.artifacts.map {
                    WriteCentralAttachments.assetItem(
                        $0, handle: handle, postId: postId)
                })
            }
        case .rootContainer, .workingSet, .trashContainer, .workspace, .folder,
             .file, .attachmentFile:
            return .failure(.notFound)
        }
    }

    func item(for identifier: WriteItemIdentifier) async
        -> Result<WriteItem, WriteSyncError> {
        switch identifier {
        case .dataContainer:
            return .success(WriteCentralAttachments.dataContainerItem())
        case .attachmentsContainer:
            return .success(WriteCentralAttachments.attachmentsContainerItem())
        case .attachmentWorkspace(let handle):
            guard let descriptor = descriptors.first(where: { $0.handle == handle }) else {
                return .failure(.notFound)
            }
            return .success(WriteCentralAttachments.workspaceItem(
                handle: handle, displayName: descriptor.name))
        case .attachmentItem(let handle, let postId):
            switch await documentContext(handle: handle, postId: postId) {
            case .failure(let error): return .failure(error)
            case .success(let context): return .success(context.document)
            }
        case .attachmentFile(let handle, let postId, let filename):
            switch await documentContext(handle: handle, postId: postId) {
            case .failure(let error): return .failure(error)
            case .success(let context):
                guard let artifact = context.artifacts.first(where: {
                    $0.filename == filename
                }) else { return .failure(.notFound) }
                return .success(WriteCentralAttachments.assetItem(
                    artifact, handle: handle, postId: postId))
            }
        case .rootContainer, .workingSet, .trashContainer, .workspace, .folder,
             .file:
            return .failure(.notFound)
        }
    }

    private struct DocumentContext {
        let document: WriteItem
        let artifacts: [WriteArtifact]
    }

    private func documentItems(
        handle: String
    ) async -> Result<[WriteItem], WriteSyncError> {
        guard let api = apiFactory(handle) else {
            return .failure(.http(401, "Not authenticated"))
        }
        let workspace: WriteWorkspace
        switch await api.workspace() {
        case .failure(let error): return .failure(error)
        case .success(let value): workspace = value
        }

        var sourceItems: [WriteItem] = []
        for folder in workspace.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let error): return .failure(error)
            case .success(let entries):
                sourceItems.append(contentsOf: entries.compactMap {
                    WriteItemMapper.item(
                        for: $0, inFolder: folder.id, handle: handle,
                        readOnly: false)
                }.filter { item in
                    item.representation == .markdown || item.representation == .text
                })
            }
        }

        return await withTaskGroup(of: WriteItem?.self) { group in
            for item in sourceItems {
                group.addTask {
                    guard let postId = item.serverId else { return nil }
                    guard case .success(let manifest) = await api.documentArtifacts(
                        postId: postId),
                        manifest.postId == postId,
                        manifest.fileHash == item.contentHash,
                        !WriteDocumentAssets.validatedInlineAssets(
                            manifest, handle: handle).isEmpty else { return nil }
                    return WriteCentralAttachments.documentItem(for: item)
                }
            }
            var documents: [WriteItem] = []
            for await item in group {
                if let item { documents.append(item) }
            }
            documents.sort { $0.filename.localizedStandardCompare($1.filename) == .orderedAscending }
            return .success(documents)
        }
    }

    private func documentContext(
        handle: String, postId: String
    ) async -> Result<DocumentContext, WriteSyncError> {
        guard let api = apiFactory(handle) else {
            return .failure(.http(401, "Not authenticated"))
        }
        let descriptor = descriptors.first(where: { $0.handle == handle })
        let core = WorkspaceEnumerator(
            api: api, handle: handle,
            workspaceName: descriptor?.name ?? handle, readOnly: false)
        let source: WriteItem
        switch await core.item(for: .file(handle: handle, id: postId)) {
        case .failure(let error): return .failure(error)
        case .success(let value): source = value
        }
        guard source.representation == .markdown || source.representation == .text,
              let document = WriteCentralAttachments.documentItem(for: source) else {
            return .failure(.notFound)
        }
        let manifest: WriteArtifactManifest
        switch await api.documentArtifacts(postId: postId) {
        case .failure(let error): return .failure(error)
        case .success(let value): manifest = value
        }
        guard manifest.postId == postId,
              manifest.fileHash == source.contentHash else {
            return .failure(.network("Document assets changed during enumeration"))
        }
        let artifacts = WriteDocumentAssets.validatedInlineAssets(
            manifest, handle: handle)
        guard !artifacts.isEmpty else { return .failure(.notFound) }
        return .success(DocumentContext(document: document, artifacts: artifacts))
    }
}
