import Foundation

/// Turns the workspace tree the sync API exposes into the flat, per-container
/// item lists the File Provider enumerates, plus single-item lookup and the
/// change cursor. Stateless: it holds only the API, the read/write posture, and
/// the workspace it serves (handle + display name), so it is trivially testable
/// against a fake API. One core serves ONE workspace; the extension builds a
/// core per workspace and lists them under the domain root.
public struct WorkspaceEnumerator: Sendable {
    private let api: WriteSyncAPI
    private let readOnly: Bool
    /// The workspace handle every folder/file identifier is scoped by.
    public let handle: String
    /// The workspace's display name, used as the workspace container's filename.
    public let workspaceName: String
    /// The domain's display name, used as the root container's filename.
    public let domainName: String

    public init(
        api: WriteSyncAPI, handle: String, workspaceName: String,
        readOnly: Bool = true, domainName: String = "Write"
    ) {
        self.api = api
        self.handle = handle
        self.workspaceName = workspaceName
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

    /// This workspace's container item (a child of the domain root).
    public func workspaceItem() -> WriteItem {
        WriteItemMapper.workspaceItem(handle: handle, name: workspaceName, readOnly: readOnly)
    }

    /// The children of a container. Root -> this workspace container; a workspace
    /// -> its top-level folders; a folder -> its subfolders then its content
    /// files. The working set -> everything. Trash -> empty for now. A file id is
    /// not a container and yields an empty list.
    public func children(
        of container: WriteItemIdentifier
    ) async -> Result<[WriteItem], WriteSyncError> {
        switch container {
        case .rootContainer:
            return .success([workspaceItem()])
        case .workspace:
            return await topLevelFolders()
        case .folder(_, let id):
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
        case .workspace:
            return .success(workspaceItem())
        case .folder(_, let id):
            switch await api.workspace() {
            case .failure(let e): return .failure(e)
            case .success(let ws):
                guard let folder = ws.folders.first(where: { $0.id == id }) else {
                    return .failure(.notFound)
                }
                return .success(WriteItemMapper.item(for: folder, handle: handle, readOnly: readOnly))
            }
        case .file(_, let id):
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
                .map { WriteItemMapper.item(for: $0, handle: handle, readOnly: readOnly) }
            return .success(items)
        }
    }

    private func folderChildren(
        folderId: String
    ) async -> Result<[WriteItem], WriteSyncError> {
        // Subfolders come from the workspace; files come from this folder's
        // manifest. Fetch BOTH concurrently: a cold first enumeration (right
        // after a domain register) that does two round-trips SEQUENTIALLY can
        // exceed the system's enumeration timeout and get cached as an empty
        // folder. One round-trip's worth of latency stays inside the window.
        async let wsResult = api.workspace()
        async let manifestResult = api.manifest(folderId: folderId)

        let ws: WriteWorkspace
        switch await wsResult {
        case .failure(let e): return .failure(e)
        case .success(let value): ws = value
        }
        // A folder id the workspace does not know is gone.
        guard ws.folders.contains(where: { $0.id == folderId }) else {
            return .failure(.notFound)
        }
        let subfolders = ws.folders
            .filter { $0.parentId == folderId }
            .map { WriteItemMapper.item(for: $0, handle: handle, readOnly: readOnly) }

        switch await manifestResult {
        case .failure(let e): return .failure(e)
        case .success(let entries):
            let files = entries.compactMap {
                WriteItemMapper.item(for: $0, inFolder: folderId, handle: handle, readOnly: readOnly)
            }
            // Break any residual same-title collisions within this folder.
            return .success(subfolders + WriteFilename.disambiguate(files))
        }
    }

    private func everything() async -> Result<[WriteItem], WriteSyncError> {
        let ws: WriteWorkspace
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let value): ws = value
        }
        let folderItems = ws.folders.map {
            WriteItemMapper.item(for: $0, handle: handle, readOnly: readOnly)
        }
        // Folders are fetched sequentially, so a post that moved between two of
        // them can surface under BOTH its old and new parent. Dedupe by id and
        // keep the LATER occurrence: since the move happened after the earlier
        // folder was fetched, the later fetch reflects the current server
        // folder. This stops an item appearing under two parents in Finder.
        var indexById: [WriteItemIdentifier: Int] = [:]
        var files: [WriteItem] = []
        for folder in ws.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let e): return .failure(e)
            case .success(let entries):
                for entry in entries {
                    guard let item = WriteItemMapper.item(
                        for: entry, inFolder: folder.id, handle: handle, readOnly: readOnly)
                    else { continue }
                    if let existing = indexById[item.identifier] {
                        files[existing] = item // current parent wins over the stale one
                    } else {
                        indexById[item.identifier] = files.count
                        files.append(item)
                    }
                }
            }
        }
        // disambiguate groups by parent, so cross-folder same-names are left
        // alone and only genuine intra-folder collisions get a suffix.
        return .success(folderItems + WriteFilename.disambiguate(files))
    }

    private func findFile(postId: String) async -> Result<WriteItem, WriteSyncError> {
        let ws: WriteWorkspace
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let value): ws = value
        }
        // Keep scanning every folder rather than returning the first hit: a post
        // that moved can still linger in its old folder's manifest alongside the
        // new one. The LATER occurrence (a folder fetched after the move) is the
        // current parent, so the last match wins.
        var found: WriteItem?
        for folder in ws.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let e): return .failure(e)
            case .success(let entries):
                if let entry = entries.first(where: { $0.id == postId }),
                   let item = WriteItemMapper.item(
                       for: entry, inFolder: folder.id, handle: handle, readOnly: readOnly) {
                    found = item
                }
            }
        }
        if let found { return .success(found) }
        return .failure(.notFound)
    }
}
