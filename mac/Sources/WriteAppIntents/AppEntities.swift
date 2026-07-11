import AppIntents
import Foundation

@available(macOS 13.0, *)
public struct WriteDocumentEntity: AppEntity {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Document"
    public static var defaultQuery = WriteDocumentEntityQuery()

    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?

    public var displayRepresentation: DisplayRepresentation {
        let subtitle = folderPath.isEmpty ? kind : "\(kind) in \(folderPath)"
        return DisplayRepresentation(title: "\(title)", subtitle: "\(subtitle)")
    }

    public init(id: String, title: String, kind: String, folderPath: String, modifiedDate: Date?) {
        self.id = id
        self.title = title
        self.kind = kind
        self.folderPath = folderPath
        self.modifiedDate = modifiedDate
    }

    public init(record: WorkspaceDocumentRecord) {
        self.init(
            id: record.id,
            title: record.title,
            kind: record.kind,
            folderPath: record.folderPath,
            modifiedDate: record.modifiedDate
        )
    }
}

@available(macOS 13.0, *)
public struct WriteDocumentEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [WriteDocumentEntity] {
        let actions = WorkspaceIntentActions()
        return identifiers.compactMap { id in
            try? WriteDocumentEntity(record: actions.document(id: id))
        }
    }

    public func entities(matching string: String) async throws -> [WriteDocumentEntity] {
        try WorkspaceIntentActions().searchDocuments(query: string, limit: 20).map(WriteDocumentEntity.init(record:))
    }

    public func suggestedEntities() async throws -> [WriteDocumentEntity] {
        try WorkspaceIntentActions().recentDocuments(limit: 10).map(WriteDocumentEntity.init(record:))
    }
}

@available(macOS 13.0, *)
public struct WriteFolderEntity: AppEntity {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Folder"
    public static var defaultQuery = WriteFolderEntityQuery()

    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(folderPath)")
    }

    public init(record: WorkspaceFolderRecord) {
        self.id = record.id
        self.title = record.title
        self.kind = record.kind
        self.folderPath = record.folderPath
        self.modifiedDate = record.modifiedDate
    }
}

@available(macOS 13.0, *)
public struct WriteFolderEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [WriteFolderEntity] {
        let folders = try WorkspaceIntentActions().folders()
        return identifiers.compactMap { id in
            folders.first { $0.id == id }.map(WriteFolderEntity.init(record:))
        }
    }

    public func entities(matching string: String) async throws -> [WriteFolderEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let folders = try WorkspaceIntentActions().folders()
        return folders
            .filter { query.isEmpty || $0.folderPath.lowercased().contains(query) || $0.title.lowercased().contains(query) }
            .map(WriteFolderEntity.init(record:))
    }

    public func suggestedEntities() async throws -> [WriteFolderEntity] {
        try WorkspaceIntentActions().folders().prefix(20).map(WriteFolderEntity.init(record:))
    }
}

@available(macOS 13.0, *)
public struct WriteBookmarkEntity: AppEntity {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Bookmark"
    public static var defaultQuery = WriteBookmarkEntityQuery()

    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?
    public var url: URL?

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(url?.absoluteString ?? folderPath)")
    }

    public init(record: WorkspaceDocumentRecord) {
        self.id = record.id
        self.title = record.title
        self.kind = record.kind
        self.folderPath = record.folderPath
        self.modifiedDate = record.modifiedDate
        self.url = record.publishedURL
    }
}

@available(macOS 13.0, *)
public struct WriteBookmarkEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [WriteBookmarkEntity] {
        let actions = WorkspaceIntentActions()
        return identifiers.compactMap { id in
            try? WriteBookmarkEntity(record: actions.document(id: id))
        }
    }

    public func entities(matching string: String) async throws -> [WriteBookmarkEntity] {
        try WorkspaceIntentActions().searchDocuments(query: string, limit: 20)
            .filter { $0.kind == "bookmark" || $0.relativePath.hasPrefix("Bookmarks/") }
            .map(WriteBookmarkEntity.init(record:))
    }

    public func suggestedEntities() async throws -> [WriteBookmarkEntity] {
        try WorkspaceIntentActions().bookmarkDocuments(limit: 10).map(WriteBookmarkEntity.init(record:))
    }
}

@available(macOS 13.0, *)
public struct WritePublicationEntity: AppEntity {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Publication"
    public static var defaultQuery = WritePublicationEntityQuery()

    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?
    public var status: String
    public var publishedURL: URL?

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(status)")
    }

    public init(record: WorkspacePublicationRecord) {
        self.id = record.id
        self.title = record.title
        self.kind = record.kind
        self.folderPath = record.folderPath
        self.modifiedDate = record.modifiedDate
        self.status = record.status
        self.publishedURL = record.publishedURL
    }
}

@available(macOS 13.0, *)
public struct WritePublicationEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [WritePublicationEntity] {
        let actions = WorkspaceIntentActions()
        return identifiers.compactMap { id in
            guard let document = try? actions.document(id: id), document.status == "published" else { return nil }
            return WritePublicationEntity(record: WorkspacePublicationRecord(document: document, status: "published"))
        }
    }

    public func entities(matching string: String) async throws -> [WritePublicationEntity] {
        try WorkspaceIntentActions().searchDocuments(query: string, limit: 20)
            .filter { $0.status == "published" }
            .map { WritePublicationEntity(record: WorkspacePublicationRecord(document: $0, status: "published")) }
    }

    public func suggestedEntities() async throws -> [WritePublicationEntity] {
        try WorkspaceIntentActions().recentDocuments(limit: 20)
            .filter { $0.status == "published" }
            .map { WritePublicationEntity(record: WorkspacePublicationRecord(document: $0, status: "published")) }
    }
}

@available(macOS 13.0, *)
public struct WriteBlogEntity: AppEntity {
    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Blog"
    public static var defaultQuery = WriteBlogEntityQuery()

    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(folderPath)")
    }
}

@available(macOS 13.0, *)
public struct WriteBlogEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [WriteBlogEntity] {
        let blogs = blogEntities()
        return identifiers.compactMap { id in blogs.first { $0.id == id } }
    }

    public func entities(matching string: String) async throws -> [WriteBlogEntity] {
        let query = string.lowercased()
        return blogEntities().filter { query.isEmpty || $0.title.lowercased().contains(query) || $0.folderPath.lowercased().contains(query) }
    }

    public func suggestedEntities() async throws -> [WriteBlogEntity] {
        blogEntities()
    }

    private func blogEntities() -> [WriteBlogEntity] {
        let root = WorkspaceIntentActions().root.appendingPathComponent("Blogs", isDirectory: true)
        let children = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return children.filter { url in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
        }.map { url in
            let path = "Blogs/\(url.lastPathComponent)"
            let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
            return WriteBlogEntity(
                id: url.lastPathComponent,
                title: url.lastPathComponent,
                kind: "blog",
                folderPath: path,
                modifiedDate: date
            )
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}
