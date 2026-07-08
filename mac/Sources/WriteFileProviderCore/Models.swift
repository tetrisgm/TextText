import Foundation

public struct WriteWorkspaceBlog: Codable, Equatable {
    public var handle: String
    public var name: String
    public var username: String?

    public init(handle: String, name: String, username: String? = nil) {
        self.handle = handle
        self.name = name
        self.username = username
    }
}

public struct WriteWorkspaceFolder: Codable, Equatable {
    public var id: String
    public var name: String
    public var path: String
    public var mode: String
    public var parentId: String?

    public init(id: String, name: String, path: String, mode: String, parentId: String? = nil) {
        self.id = id
        self.name = name
        self.path = path
        self.mode = mode
        self.parentId = parentId
    }
}

public struct WriteWorkspace: Codable, Equatable {
    public var blog: WriteWorkspaceBlog
    public var folders: [WriteWorkspaceFolder]

    public init(blog: WriteWorkspaceBlog, folders: [WriteWorkspaceFolder]) {
        self.blog = blog
        self.folders = folders
    }
}

public struct WriteManifestItem: Codable, Equatable {
    public var file: String
    public var kind: String
    public var slug: String
    public var title: String
    public var status: String
    public var hash: String
    public var id: String?
    public var date: String?
    public var createdAt: String?
    public var updatedAt: String?
    public var url: String?

    public init(
        file: String,
        kind: String,
        slug: String,
        title: String,
        status: String,
        hash: String,
        id: String? = nil,
        date: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil,
        url: String? = nil
    ) {
        self.file = file
        self.kind = kind
        self.slug = slug
        self.title = title
        self.status = status
        self.hash = hash
        self.id = id
        self.date = date
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.url = url
    }
}

public enum WriteManifestResponse: Equatable {
    case notModified
    case manifest([WriteManifestItem], etag: String?)
}

public struct WriteFileProviderItemIdentifier: RawRepresentable, Codable, Hashable, ExpressibleByStringLiteral {
    public static let rootContainer = WriteFileProviderItemIdentifier(rawValue: "root")
    public static let workingSet = WriteFileProviderItemIdentifier(rawValue: "working-set")

    public var rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.rawValue = value
    }

    public static func folder(_ id: String) -> WriteFileProviderItemIdentifier {
        WriteFileProviderItemIdentifier(rawValue: "folder:\(id)")
    }

    public static func markdown(_ id: String) -> WriteFileProviderItemIdentifier {
        WriteFileProviderItemIdentifier(rawValue: "post:\(id)")
    }

    public var folderId: String? {
        rawValue.hasPrefix("folder:") ? String(rawValue.dropFirst("folder:".count)) : nil
    }

    public var markdownId: String? {
        rawValue.hasPrefix("post:") ? String(rawValue.dropFirst("post:".count)) : nil
    }

    public var isRootContainer: Bool { self == .rootContainer }
    public var isWorkingSet: Bool { self == .workingSet }
}

public struct WriteFileProviderItemVersion: Codable, Equatable {
    public var contentVersion: Data
    public var metadataVersion: Data

    public init(contentVersion: Data, metadataVersion: Data) {
        self.contentVersion = contentVersion
        self.metadataVersion = metadataVersion
    }

    public init(contentVersion: String, metadataVersion: String? = nil) {
        self.contentVersion = Data(contentVersion.utf8)
        self.metadataVersion = Data((metadataVersion ?? contentVersion).utf8)
    }

    public var contentVersionString: String? {
        String(data: contentVersion, encoding: .utf8)
    }
}

public struct WriteFileProviderItemMetadata: Codable, Equatable {
    public var identifier: WriteFileProviderItemIdentifier
    public var parentIdentifier: WriteFileProviderItemIdentifier
    public var filename: String
    public var contentType: String
    public var contentModificationDate: Date?
    public var size: Int64?
    public var versions: WriteFileProviderItemVersion
    public var isDirectory: Bool

    public init(
        identifier: WriteFileProviderItemIdentifier,
        parentIdentifier: WriteFileProviderItemIdentifier,
        filename: String,
        contentType: String,
        contentModificationDate: Date? = nil,
        size: Int64? = nil,
        versions: WriteFileProviderItemVersion,
        isDirectory: Bool
    ) {
        self.identifier = identifier
        self.parentIdentifier = parentIdentifier
        self.filename = filename
        self.contentType = contentType
        self.contentModificationDate = contentModificationDate
        self.size = size
        self.versions = versions
        self.isDirectory = isDirectory
    }
}

public enum WriteFileProviderCoreError: Error, Equatable, LocalizedError {
    case invalidParent(String)
    case missingItemIdentifier
    case notMarkdownItem(String)
    case unknownItem(String)
    case unsupportedOperation(String)

    public var errorDescription: String? {
        switch self {
        case .invalidParent(let id):
            return "Invalid File Provider parent: \(id)"
        case .missingItemIdentifier:
            return "The server manifest item did not include an id"
        case .notMarkdownItem(let id):
            return "The item is not a markdown file: \(id)"
        case .unknownItem(let id):
            return "Unknown File Provider item: \(id)"
        case .unsupportedOperation(let message):
            return message
        }
    }
}

public enum WriteFileProviderMetadataMapper {
    public static let folderContentType = "public.folder"
    public static let markdownContentType = "net.daringfireball.markdown"

    public static func rootItem(displayName: String = "Write") -> WriteFileProviderItemMetadata {
        WriteFileProviderItemMetadata(
            identifier: .rootContainer,
            parentIdentifier: .rootContainer,
            filename: displayName,
            contentType: folderContentType,
            versions: WriteFileProviderItemVersion(contentVersion: "root", metadataVersion: "root:\(displayName)"),
            isDirectory: true
        )
    }

    public static func workingSetItem() -> WriteFileProviderItemMetadata {
        WriteFileProviderItemMetadata(
            identifier: .workingSet,
            parentIdentifier: .rootContainer,
            filename: "Working Set",
            contentType: folderContentType,
            versions: WriteFileProviderItemVersion(contentVersion: "working-set"),
            isDirectory: true
        )
    }

    public static func folderItem(
        _ folder: WriteWorkspaceFolder,
        allFolders: [WriteWorkspaceFolder]
    ) -> WriteFileProviderItemMetadata {
        let parent = parentIdentifier(for: folder, allFolders: allFolders)
        let metadataVersion = [
            folder.id,
            folder.parentId ?? "",
            folder.path,
            folder.name,
            folder.mode,
        ].joined(separator: "\n")
        return WriteFileProviderItemMetadata(
            identifier: .folder(folder.id),
            parentIdentifier: parent,
            filename: folderDisplayName(folder),
            contentType: folderContentType,
            versions: WriteFileProviderItemVersion(contentVersion: metadataVersion, metadataVersion: metadataVersion),
            isDirectory: true
        )
    }

    public static func markdownItem(
        _ item: WriteManifestItem,
        in folder: WriteWorkspaceFolder,
        size: Int64? = nil
    ) throws -> WriteFileProviderItemMetadata {
        guard let id = item.id, !id.isEmpty else { throw WriteFileProviderCoreError.missingItemIdentifier }
        let filename = markdownFilename(for: item)
        let metadataVersion = [
            id,
            folder.id,
            filename,
            item.hash,
            item.title,
            item.status,
            item.date ?? "",
            item.createdAt ?? "",
            item.updatedAt ?? "",
        ].joined(separator: "\n")
        return WriteFileProviderItemMetadata(
            identifier: .markdown(id),
            parentIdentifier: .folder(folder.id),
            filename: filename,
            contentType: markdownContentType,
            contentModificationDate: bestDate(for: item),
            size: size,
            versions: WriteFileProviderItemVersion(contentVersion: item.hash, metadataVersion: metadataVersion),
            isDirectory: false
        )
    }

    public static func bestDate(for item: WriteManifestItem) -> Date? {
        parseDate(item.updatedAt) ?? parseDate(item.date) ?? parseDate(item.createdAt)
    }

    public static func markdownFilename(for item: WriteManifestItem) -> String {
        let existing = item.file.trimmingCharacters(in: .whitespacesAndNewlines)
        if !existing.isEmpty { return existing }
        let slug = item.slug.trimmingCharacters(in: .whitespacesAndNewlines)
        return slug.isEmpty ? "untitled.md" : "\(slug).md"
    }

    private static func folderDisplayName(_ folder: WriteWorkspaceFolder) -> String {
        let name = folder.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return folder.path.split(separator: "/").last.map(String.init) ?? folder.path
    }

    private static func parentIdentifier(
        for folder: WriteWorkspaceFolder,
        allFolders: [WriteWorkspaceFolder]
    ) -> WriteFileProviderItemIdentifier {
        if let parentId = folder.parentId, !parentId.isEmpty {
            return .folder(parentId)
        }
        guard let parentPath = parentPath(for: folder.path),
              let inferred = allFolders.first(where: { $0.path == parentPath }) else {
            return .rootContainer
        }
        return .folder(inferred.id)
    }

    private static func parentPath(for path: String) -> String? {
        guard let lastSlash = path.lastIndex(of: "/") else { return nil }
        return String(path[..<lastSlash])
    }

    private static func parseDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }

        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: value) { return date }

        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: value)
    }
}
