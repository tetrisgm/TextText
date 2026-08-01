import FileProvider
import Foundation
import TextTextFileProviderBridge
import TextTextFileProviderKit

/// Read-only synthetic hierarchy for assets referenced by imported plain files:
/// Data / Attachments / Workspace / Document / asset. TextText-created TextBundles
/// remain self-contained and are deliberately excluded.
final class CentralAttachmentsEnumerator: NSObject, NSFileProviderEnumerator {
    private let container: TextTextItemIdentifier
    private let descriptors: [FileProviderWorkspace]
    private let apiFactory: (String) -> TextTextSyncAPI?

    init(
        container: TextTextItemIdentifier,
        descriptors: [FileProviderWorkspace],
        apiFactory: @escaping (String) -> TextTextSyncAPI?
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
                observer.didEnumerate(items.map(TextTextFileProviderItem.init))
                observer.finishEnumerating(upTo: nil)
            case .failure(let error):
                observer.finishEnumeratingWithError(TextTextEnumeratorAdapter.bridge(error))
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
                observer.finishEnumeratingWithError(TextTextEnumeratorAdapter.bridge(error))
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

    func items() async -> Result<[TextTextItem], TextTextSyncError> {
        switch container {
        case .dataContainer:
            return .success([TextTextCentralAttachments.attachmentsContainerItem()])
        case .attachmentsContainer:
            return .success(descriptors.map {
                TextTextCentralAttachments.workspaceItem(
                    handle: $0.handle, displayName: $0.name)
            })
        case .attachmentWorkspace(let handle):
            return await documentItems(handle: handle)
        case .attachmentItem(let handle, let postId):
            switch await documentContext(handle: handle, postId: postId) {
            case .failure(let error): return .failure(error)
            case .success(let context):
                return .success(context.artifacts.map {
                    TextTextCentralAttachments.assetItem(
                        $0, handle: handle, postId: postId)
                })
            }
        case .rootContainer, .workingSet, .trashContainer, .workspace, .folder,
             .file, .attachmentFile:
            return .failure(.notFound)
        }
    }

    func item(for identifier: TextTextItemIdentifier) async
        -> Result<TextTextItem, TextTextSyncError> {
        switch identifier {
        case .dataContainer:
            return .success(TextTextCentralAttachments.dataContainerItem())
        case .attachmentsContainer:
            return .success(TextTextCentralAttachments.attachmentsContainerItem())
        case .attachmentWorkspace(let handle):
            guard let descriptor = descriptors.first(where: { $0.handle == handle }) else {
                return .failure(.notFound)
            }
            return .success(TextTextCentralAttachments.workspaceItem(
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
                return .success(TextTextCentralAttachments.assetItem(
                    artifact, handle: handle, postId: postId))
            }
        case .rootContainer, .workingSet, .trashContainer, .workspace, .folder,
             .file:
            return .failure(.notFound)
        }
    }

    private struct DocumentContext {
        let document: TextTextItem
        let artifacts: [TextTextArtifact]
    }

    private func documentItems(
        handle: String
    ) async -> Result<[TextTextItem], TextTextSyncError> {
        guard let api = apiFactory(handle) else {
            return .failure(.http(401, "Not authenticated"))
        }
        let workspace: TextTextWorkspace
        switch await api.workspace() {
        case .failure(let error): return .failure(error)
        case .success(let value): workspace = value
        }

        var sourceItems: [TextTextItem] = []
        for folder in workspace.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let error): return .failure(error)
            case .success(let entries):
                sourceItems.append(contentsOf: entries.compactMap {
                    TextTextItemMapper.item(
                        for: $0, inFolder: folder.id, handle: handle,
                        readOnly: false)
                }.filter { item in
                    item.representation == .markdown || item.representation == .text
                })
            }
        }

        return await withTaskGroup(of: TextTextItem?.self) { group in
            for item in sourceItems {
                group.addTask {
                    guard let postId = item.serverId else { return nil }
                    guard case .success(let manifest) = await api.documentArtifacts(
                        postId: postId),
                        manifest.postId == postId,
                        manifest.fileHash == item.contentHash,
                        !TextTextDocumentAssets.validatedInlineAssets(
                            manifest, handle: handle).isEmpty else { return nil }
                    return TextTextCentralAttachments.documentItem(for: item)
                }
            }
            var documents: [TextTextItem] = []
            for await item in group {
                if let item { documents.append(item) }
            }
            documents.sort { $0.filename.localizedStandardCompare($1.filename) == .orderedAscending }
            return .success(documents)
        }
    }

    private func documentContext(
        handle: String, postId: String
    ) async -> Result<DocumentContext, TextTextSyncError> {
        guard let api = apiFactory(handle) else {
            return .failure(.http(401, "Not authenticated"))
        }
        let descriptor = descriptors.first(where: { $0.handle == handle })
        let core = WorkspaceEnumerator(
            api: api, handle: handle,
            workspaceName: descriptor?.name ?? handle, readOnly: false)
        let source: TextTextItem
        switch await core.item(for: .file(handle: handle, id: postId)) {
        case .failure(let error): return .failure(error)
        case .success(let value): source = value
        }
        guard source.representation == .markdown || source.representation == .text,
              let document = TextTextCentralAttachments.documentItem(for: source) else {
            return .failure(.notFound)
        }
        let manifest: TextTextArtifactManifest
        switch await api.documentArtifacts(postId: postId) {
        case .failure(let error): return .failure(error)
        case .success(let value): manifest = value
        }
        guard manifest.postId == postId,
              manifest.fileHash == source.contentHash else {
            return .failure(.network("Document assets changed during enumeration"))
        }
        let artifacts = TextTextDocumentAssets.validatedInlineAssets(
            manifest, handle: handle)
        guard !artifacts.isEmpty else { return .failure(.notFound) }
        return .success(DocumentContext(document: document, artifacts: artifacts))
    }
}
