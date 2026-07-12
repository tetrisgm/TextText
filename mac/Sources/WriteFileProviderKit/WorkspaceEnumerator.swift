import Foundation

/// Turns the workspace tree the sync API exposes into the flat, per-container
/// item lists the File Provider enumerates, plus single-item lookup and the
/// change cursor. Stateless: it holds only the API and the read/write posture,
/// so it is trivially testable against a fake API.
public struct WorkspaceEnumerator: Sendable {
    private let api: WriteSyncAPI
    private let readOnly: Bool
    /// The domain's display name, used as the root container's filename.
    public let domainName: String

    public init(api: WriteSyncAPI, readOnly: Bool = true, domainName: String = "Write") {
        self.api = api
        self.readOnly = readOnly
        self.domainName = domainName
    }

    /// The synthetic item for the domain root. Apple's convention is that the
    /// root's parent is itself.
    public func rootItem() -> WriteItem {
        let caps: WriteItemCapabilities = readOnly
            ? .readOnlyFolder
            : [.contentEnumerating, .addingSubItems]
        return WriteItem(
            identifier: .rootContainer,
            parentIdentifier: .rootContainer,
            filename: domainName,
            isFolder: true,
            kind: .folder,
            typeIdentifier: WriteItem.folderTypeIdentifier,
            serverId: nil,
            contentHash: nil,
            documentSize: nil,
            creationDate: nil,
            contentModificationDate: nil,
            capabilities: caps
        )
    }

    /// The children of a container. Root -> top-level folders; a folder -> its
    /// subfolders then its content files. The working set -> everything. Trash
    /// -> empty for now (soft-deleted items surface in Phase 4). A file id is
    /// not a container and yields an empty list.
    public func children(
        of container: WriteItemIdentifier
    ) async -> Result<[WriteItem], WriteSyncError> {
        switch container {
        case .rootContainer:
            return await topLevelFolders()
        case .folder(let id):
            return await folderChildren(folderId: id)
        case .workingSet:
            return await everything()
        case .trashContainer:
            return .success([])
        case .file:
            return .success([])
        }
    }

    /// Metadata for one item, however the system asks for it (out of any
    /// enumeration context). Files require a manifest scan because the manifest
    /// is per-folder; Phase 4 will back this with an index.
    public func item(
        for identifier: WriteItemIdentifier
    ) async -> Result<WriteItem, WriteSyncError> {
        switch identifier {
        case .rootContainer, .workingSet, .trashContainer:
            return .success(rootItem())
        case .folder(let id):
            switch await api.workspace() {
            case .failure(let e): return .failure(e)
            case .success(let ws):
                guard let folder = ws.folders.first(where: { $0.id == id }) else {
                    return .failure(.notFound)
                }
                return .success(WriteItemMapper.item(for: folder, readOnly: readOnly))
            }
        case .file(let id):
            return await findFile(postId: id)
        }
    }

    /// The current change cursor (immediate).
    public func currentCursor() async -> Result<String, WriteSyncError> {
        switch await api.changes(since: nil, wait: 0) {
        case .failure(let e): return .failure(e)
        case .success(let reply): return .success(reply.cursor)
        }
    }

    /// Long-poll for the cursor to move past `cursor`. Returns as soon as the
    /// workspace changes or `wait` seconds elapse.
    public func awaitChange(
        since cursor: String, wait: Int
    ) async -> Result<WriteChangeReply, WriteSyncError> {
        await api.changes(since: cursor, wait: wait)
    }

    // MARK: - internals

    private func topLevelFolders() async -> Result<[WriteItem], WriteSyncError> {
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let ws):
            let items = ws.folders
                .filter { $0.parentId == nil }
                .map { WriteItemMapper.item(for: $0, readOnly: readOnly) }
            return .success(items)
        }
    }

    private func folderChildren(
        folderId: String
    ) async -> Result<[WriteItem], WriteSyncError> {
        // Subfolders come from the workspace; files come from this folder's
        // manifest. Both are needed for a complete listing.
        let ws: WriteWorkspace
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let value): ws = value
        }
        // A folder id the workspace does not know is gone.
        guard ws.folders.contains(where: { $0.id == folderId }) else {
            return .failure(.notFound)
        }
        let subfolders = ws.folders
            .filter { $0.parentId == folderId }
            .map { WriteItemMapper.item(for: $0, readOnly: readOnly) }

        switch await api.manifest(folderId: folderId) {
        case .failure(let e): return .failure(e)
        case .success(let entries):
            let files = entries.compactMap {
                WriteItemMapper.item(for: $0, inFolder: folderId, readOnly: readOnly)
            }
            return .success(subfolders + files)
        }
    }

    private func everything() async -> Result<[WriteItem], WriteSyncError> {
        let ws: WriteWorkspace
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let value): ws = value
        }
        var items = ws.folders.map { WriteItemMapper.item(for: $0, readOnly: readOnly) }
        for folder in ws.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let e): return .failure(e)
            case .success(let entries):
                items += entries.compactMap {
                    WriteItemMapper.item(for: $0, inFolder: folder.id, readOnly: readOnly)
                }
            }
        }
        return .success(items)
    }

    private func findFile(postId: String) async -> Result<WriteItem, WriteSyncError> {
        let ws: WriteWorkspace
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let value): ws = value
        }
        for folder in ws.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let e): return .failure(e)
            case .success(let entries):
                if let entry = entries.first(where: { $0.id == postId }),
                   let item = WriteItemMapper.item(
                       for: entry, inFolder: folder.id, readOnly: readOnly) {
                    return .success(item)
                }
            }
        }
        return .failure(.notFound)
    }
}
