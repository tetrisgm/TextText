import Foundation

public final class WriteFileProviderCore {
    private let api: any WriteFileProviderAPI
    private let defaultPageSize: Int

    public init(api: any WriteFileProviderAPI, defaultPageSize: Int = 200) {
        self.api = api
        self.defaultPageSize = max(1, defaultPageSize)
    }

    public func item(for identifier: WriteFileProviderItemIdentifier) async throws -> WriteFileProviderItemMetadata {
        if identifier.isRootContainer {
            return WriteFileProviderMetadataMapper.rootItem()
        }
        if identifier.isWorkingSet {
            return WriteFileProviderMetadataMapper.workingSetItem()
        }

        let workspace = try await api.workspace()
        if let folderId = identifier.folderId {
            guard let folder = workspace.folders.first(where: { $0.id == folderId }) else {
                throw WriteFileProviderCoreError.unknownItem(identifier.rawValue)
            }
            return WriteFileProviderMetadataMapper.folderItem(folder, allFolders: workspace.folders)
        }

        if let markdownId = identifier.markdownId {
            return try await metadataForMarkdown(id: markdownId, workspace: workspace)
        }

        throw WriteFileProviderCoreError.unknownItem(identifier.rawValue)
    }

    public func enumerateItems(
        in containerIdentifier: WriteFileProviderItemIdentifier,
        pageToken: WriteFileProviderPageToken? = nil,
        pageSize: Int? = nil
    ) async throws -> WriteFileProviderEnumerationPage {
        let allItems = try await allItems(in: containerIdentifier)
        let limit = max(1, pageSize ?? defaultPageSize)
        let offset = min(pageToken?.offset ?? 0, allItems.count)
        let end = min(offset + limit, allItems.count)
        let pageItems = Array(allItems[offset..<end])
        let next = end < allItems.count ? WriteFileProviderPageToken(offset: end) : nil
        return WriteFileProviderEnumerationPage(items: pageItems, nextPageToken: next)
    }

    public func enumerateChanges(
        since anchor: WriteFileProviderChangeAnchor?,
        waitSeconds: Int = 25
    ) async throws -> WriteFileProviderChangeSet {
        let poll = try await api.pollRemoteChanges(since: anchor?.cursor, waitSeconds: waitSeconds)
        return WriteFileProviderChangeSet(
            changes: [],
            anchor: WriteFileProviderChangeAnchor(cursor: poll.cursor),
            requiresFullEnumeration: poll.changed
        )
    }

    public func fetchContents(
        for identifier: WriteFileProviderItemIdentifier
    ) async throws -> WriteFetchedFile {
        guard let markdownId = identifier.markdownId else {
            throw WriteFileProviderCoreError.notMarkdownItem(identifier.rawValue)
        }
        var metadata = try await item(for: identifier)
        let fetched = try await api.fetchMarkdown(itemId: markdownId)
        metadata.size = Int64(fetched.contents.count)
        if let contentVersion = fetched.contentVersion {
            metadata.versions.contentVersion = Data(contentVersion.utf8)
        }
        return WriteFetchedFile(metadata: metadata, contents: fetched.contents)
    }

    public func createItem(
        parentIdentifier: WriteFileProviderItemIdentifier,
        filename: String,
        contentType: String,
        contents: Data?
    ) async throws -> WriteFileProviderItemMetadata {
        let workspace = try await api.workspace()
        if contentType == WriteFileProviderMetadataMapper.folderContentType {
            let created = try await api.createFolder(
                parentPath: try parentPath(for: parentIdentifier, workspace: workspace),
                name: filename
            )
            var folders = workspace.folders
            folders.append(created)
            return WriteFileProviderMetadataMapper.folderItem(created, allFolders: folders)
        }

        guard let parentFolderId = parentIdentifier.folderId,
              let folder = workspace.folders.first(where: { $0.id == parentFolderId }) else {
            throw WriteFileProviderCoreError.invalidParent(parentIdentifier.rawValue)
        }
        let item = try await api.createMarkdown(
            in: folder,
            proposedFilename: filename,
            contents: contents ?? Data()
        )
        return try WriteFileProviderMetadataMapper.markdownItem(
            item,
            in: folder,
            size: Int64((contents ?? Data()).count)
        )
    }

    public func modifyItem(
        identifier: WriteFileProviderItemIdentifier,
        baseVersion: WriteFileProviderItemVersion?,
        newFilename: String? = nil,
        contents: Data?
    ) async throws -> WriteFileProviderItemMetadata {
        guard let markdownId = identifier.markdownId else {
            throw WriteFileProviderCoreError.unsupportedOperation("Only markdown file modification is supported in Phase 1")
        }

        let current = try await item(for: identifier)
        if let newFilename, newFilename != current.filename, contents == nil {
            throw WriteFileProviderCoreError.unsupportedOperation("Metadata-only rename is not supported in Phase 1")
        }
        guard let contents else { return current }

        let item = try await api.modifyMarkdown(
            itemId: markdownId,
            baseVersion: baseVersion?.contentVersionString,
            contents: contents
        )
        guard let parentFolderId = current.parentIdentifier.folderId else {
            throw WriteFileProviderCoreError.invalidParent(current.parentIdentifier.rawValue)
        }
        let workspace = try await api.workspace()
        guard let folder = workspace.folders.first(where: { $0.id == parentFolderId }) else {
            throw WriteFileProviderCoreError.invalidParent(current.parentIdentifier.rawValue)
        }
        return try WriteFileProviderMetadataMapper.markdownItem(item, in: folder, size: Int64(contents.count))
    }

    public func deleteItem(identifier: WriteFileProviderItemIdentifier) async throws {
        guard let markdownId = identifier.markdownId else {
            throw WriteFileProviderCoreError.unsupportedOperation("Only markdown file deletion is supported in Phase 1")
        }
        try await api.deleteMarkdown(itemId: markdownId)
    }

    private func allItems(
        in containerIdentifier: WriteFileProviderItemIdentifier
    ) async throws -> [WriteFileProviderItemMetadata] {
        let workspace = try await api.workspace()

        if containerIdentifier.isRootContainer {
            return workspace.folders
                .filter { parentId(for: $0, allFolders: workspace.folders) == nil }
                .map { WriteFileProviderMetadataMapper.folderItem($0, allFolders: workspace.folders) }
                .sortedForFileProvider()
        }

        if containerIdentifier.isWorkingSet {
            var items: [WriteFileProviderItemMetadata] = []
            for folder in workspace.folders {
                items.append(contentsOf: try await markdownItems(in: folder))
            }
            return items.sorted {
                switch ($0.contentModificationDate, $1.contentModificationDate) {
                case let (left?, right?):
                    return left == right ? $0.filename < $1.filename : left > right
                case (.some, nil):
                    return true
                case (nil, .some):
                    return false
                case (nil, nil):
                    return $0.filename < $1.filename
                }
            }
        }

        if let folderId = containerIdentifier.folderId {
            guard let folder = workspace.folders.first(where: { $0.id == folderId }) else {
                throw WriteFileProviderCoreError.unknownItem(containerIdentifier.rawValue)
            }
            let childFolders = workspace.folders
                .filter { parentId(for: $0, allFolders: workspace.folders) == folder.id }
                .map { WriteFileProviderMetadataMapper.folderItem($0, allFolders: workspace.folders) }
            let files = try await markdownItems(in: folder)
            return (childFolders + files).sortedForFileProvider()
        }

        throw WriteFileProviderCoreError.invalidParent(containerIdentifier.rawValue)
    }

    private func metadataForMarkdown(
        id markdownId: String,
        workspace: WriteWorkspace
    ) async throws -> WriteFileProviderItemMetadata {
        for folder in workspace.folders {
            let items = try await markdownItems(in: folder)
            if let match = items.first(where: { $0.identifier.markdownId == markdownId }) {
                return match
            }
        }
        throw WriteFileProviderCoreError.unknownItem(WriteFileProviderItemIdentifier.markdown(markdownId).rawValue)
    }

    private func markdownItems(in folder: WriteWorkspaceFolder) async throws -> [WriteFileProviderItemMetadata] {
        switch try await api.manifest(folderId: folder.id, etag: nil) {
        case .notModified:
            return []
        case .manifest(let items, _):
            return try items.map { try WriteFileProviderMetadataMapper.markdownItem($0, in: folder) }
        }
    }

    private func parentPath(
        for identifier: WriteFileProviderItemIdentifier,
        workspace: WriteWorkspace
    ) throws -> String {
        if identifier.isRootContainer { return "" }
        guard let folderId = identifier.folderId,
              let folder = workspace.folders.first(where: { $0.id == folderId }) else {
            throw WriteFileProviderCoreError.invalidParent(identifier.rawValue)
        }
        return folder.path
    }

    private func parentId(
        for folder: WriteWorkspaceFolder,
        allFolders: [WriteWorkspaceFolder]
    ) -> String? {
        if let parentId = folder.parentId, !parentId.isEmpty {
            return parentId
        }
        guard let slash = folder.path.lastIndex(of: "/") else { return nil }
        let parentPath = String(folder.path[..<slash])
        return allFolders.first(where: { $0.path == parentPath })?.id
    }
}

private extension Array where Element == WriteFileProviderItemMetadata {
    func sortedForFileProvider() -> [WriteFileProviderItemMetadata] {
        sorted {
            if $0.isDirectory != $1.isDirectory { return $0.isDirectory && !$1.isDirectory }
            return $0.filename.localizedStandardCompare($1.filename) == .orderedAscending
        }
    }
}
