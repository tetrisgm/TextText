import Foundation

public struct WriteFetchedMarkdown: Equatable {
    public var contents: Data
    public var contentVersion: String?

    public init(contents: Data, contentVersion: String? = nil) {
        self.contents = contents
        self.contentVersion = contentVersion
    }
}

public struct WriteFetchedFile: Equatable {
    public var metadata: WriteFileProviderItemMetadata
    public var contents: Data

    public init(metadata: WriteFileProviderItemMetadata, contents: Data) {
        self.metadata = metadata
        self.contents = contents
    }
}

public protocol WriteFileProviderAPI {
    func workspace() async throws -> WriteWorkspace
    func manifest(folderId: String, etag: String?) async throws -> WriteManifestResponse
    func fetchMarkdown(itemId: String) async throws -> WriteFetchedMarkdown
    func createFolder(parentPath: String, name: String) async throws -> WriteWorkspaceFolder
    func createMarkdown(
        in folder: WriteWorkspaceFolder,
        proposedFilename: String,
        contents: Data
    ) async throws -> WriteManifestItem
    func modifyMarkdown(
        itemId: String,
        baseVersion: String?,
        contents: Data
    ) async throws -> WriteManifestItem
    func deleteMarkdown(itemId: String) async throws
    func pollRemoteChanges(since cursor: String?, waitSeconds: Int) async throws -> WriteRemoteChangePoll
}
