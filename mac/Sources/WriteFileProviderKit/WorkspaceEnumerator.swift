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
    /// files. The working set -> every folder and document. File Provider can
    /// rebuild a domain from this enumeration after reimport, so parent folders
    /// must be present before children can reconcile. Trash -> empty for now. A
    /// file id is not a container and yields an empty list.
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
        case .file, .dataContainer, .attachmentsContainer,
             .attachmentWorkspace, .attachmentItem, .attachmentFile:
            // The central attachment tree spans workspaces and is served by the
            // extension-level enumerator. A per-workspace core must never alias
            // those synthetic identifiers into ordinary content.
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
        case .rootContainer:
            return .success(rootItem())
        case .workingSet, .trashContainer, .dataContainer,
             .attachmentsContainer, .attachmentWorkspace, .attachmentItem,
             .attachmentFile:
            // Both are virtual enumeration scopes. They are never concrete
            // items and must not be represented by the root's identifier.
            return .failure(.notFound)
        case .workspace:
            return .success(workspaceItem())
        case .folder(_, let id):
            switch await api.workspace() {
            case .failure(let e): return .failure(e)
            case .success(let ws):
                guard let folder = ws.folders.first(where: { $0.id == id }) else {
                    return .failure(.notFound)
                }
                let siblings: Result<[WriteItem], WriteSyncError>
                if let parentId = folder.parentId {
                    siblings = await folderChildren(folderId: parentId)
                } else {
                    siblings = await topLevelFolders()
                }
                switch siblings {
                case .failure(let error): return .failure(error)
                case .success(let items):
                    guard let item = items.first(where: { $0.identifier == identifier }) else {
                        return .failure(.notFound)
                    }
                    return .success(item)
                }
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

    /// A fixed-size anchor for the actual children mapped into one container.
    /// The global server cursor is intentionally not used here: a post edit in
    /// Notes must not invalidate Blog, the workspace root, or unchanged folders.
    public func containerAnchor(
        for container: WriteItemIdentifier
    ) async -> Result<Data, WriteSyncError> {
        switch await children(of: container) {
        case .failure(let error): return .failure(error)
        case .success(let items): return .success(Self.fingerprint(items))
        }
    }

    /// Canonical item-set fingerprint shared by per-workspace and aggregate
    /// enumerators. It is always 32 bytes, below File Provider's anchor limit.
    public static func fingerprint(_ items: [WriteItem]) -> Data {
        var canonical = Data()
        let sorted = items.sorted {
            if $0.identifier.rawValue != $1.identifier.rawValue {
                return $0.identifier.rawValue < $1.identifier.rawValue
            }
            if $0.parentIdentifier.rawValue != $1.parentIdentifier.rawValue {
                return $0.parentIdentifier.rawValue < $1.parentIdentifier.rawValue
            }
            return $0.filename < $1.filename
        }
        for item in sorted {
            let fields = [
                item.identifier.rawValue,
                item.parentIdentifier.rawValue,
                item.filename.precomposedStringWithCanonicalMapping,
                item.isFolder ? "folder" : "file",
                item.typeIdentifier,
                item.serverId ?? "",
                item.contentHash ?? "",
                item.documentSize.map(String.init) ?? "",
                item.creationDate.map { String($0.timeIntervalSince1970.bitPattern) } ?? "",
                item.contentModificationDate.map { String($0.timeIntervalSince1970.bitPattern) } ?? "",
                String(item.capabilities.rawValue),
            ]
            for field in fields {
                let data = Data(field.utf8)
                canonical.append(contentsOf: "\(data.count):".utf8)
                canonical.append(data)
            }
            canonical.append(0x0A)
        }
        return WriteStableDigest.sha256(canonical)
    }

    // MARK: - internals

    private func topLevelFolders() async -> Result<[WriteItem], WriteSyncError> {
        switch await api.workspace() {
        case .failure(let e): return .failure(e)
        case .success(let ws):
            let items = ws.folders
                .filter { $0.parentId == nil }
                .map { WriteItemMapper.item(for: $0, handle: handle, readOnly: readOnly) }
            return .success(WriteFilename.disambiguate(items))
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
            // Files and subfolders occupy the same Finder namespace.
            return .success(WriteFilename.disambiguate(subfolders + files))
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
        // File Provider also uses the working set to reconstruct a domain after
        // reimport. Omitting containers leaves every document blocked behind a
        // missing parent (`parentCreation`) on a cold or schema-migrated index.
        // Stable folder identifiers keep unchanged containers from being
        // recreated while still making the complete parent chain available.
        return .success(WriteFilename.disambiguate(folderItems + files))
    }

    private func findFile(postId: String) async -> Result<WriteItem, WriteSyncError> {
        let ws: WriteWorkspace
        switch await api.workspace() {
        case .failure(let error): return .failure(error)
        case .success(let value): ws = value
        }

        // Scan each manifest once. A moved item can briefly appear in both its
        // old and new parent; the later occurrence is authoritative.
        var found: WriteItem?
        for folder in ws.folders {
            switch await api.manifest(folderId: folder.id) {
            case .failure(let error): return .failure(error)
            case .success(let entries):
                let subfolders = ws.folders
                    .filter { $0.parentId == folder.id }
                    .map { WriteItemMapper.item(
                        for: $0, handle: handle, readOnly: readOnly) }
                let files = entries.compactMap { WriteItemMapper.item(
                    for: $0, inFolder: folder.id, handle: handle,
                    readOnly: readOnly) }
                let siblings = WriteFilename.disambiguate(
                    subfolders + files)
                if let item = siblings.first(where: {
                    $0.identifier == .file(handle: handle, id: postId)
                }) {
                    found = item
                }
            }
        }
        return found.map(Result.success) ?? .failure(.notFound)
    }

}
