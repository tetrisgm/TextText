import AppIntents
import Foundation

@available(macOS 13.0, *)
public struct TextTextDocumentEntity: AppEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Document")
    public static var defaultQuery = TextTextDocumentEntityQuery()

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
public struct TextTextDocumentEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [TextTextDocumentEntity] {
        let actions = WorkspaceIntentActions()
        return identifiers.compactMap { id in
            try? TextTextDocumentEntity(record: actions.document(id: id))
        }
    }

    public func entities(matching string: String) async throws -> [TextTextDocumentEntity] {
        try WorkspaceIntentActions().searchDocuments(query: string, limit: 20).map(TextTextDocumentEntity.init(record:))
    }

    public func suggestedEntities() async throws -> [TextTextDocumentEntity] {
        try WorkspaceIntentActions().recentDocuments(limit: 10).map(TextTextDocumentEntity.init(record:))
    }
}

@available(macOS 13.0, *)
public struct TextTextFolderEntity: AppEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Folder")
    public static var defaultQuery = TextTextFolderEntityQuery()

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
public struct TextTextFolderEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [TextTextFolderEntity] {
        let folders = try WorkspaceIntentActions().folders()
        return identifiers.compactMap { id in
            folders.first { $0.id == id }.map(TextTextFolderEntity.init(record:))
        }
    }

    public func entities(matching string: String) async throws -> [TextTextFolderEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let folders = try WorkspaceIntentActions().folders()
        return folders
            .filter { query.isEmpty || $0.folderPath.lowercased().contains(query) || $0.title.lowercased().contains(query) }
            .map(TextTextFolderEntity.init(record:))
    }

    public func suggestedEntities() async throws -> [TextTextFolderEntity] {
        try WorkspaceIntentActions().folders().prefix(20).map(TextTextFolderEntity.init(record:))
    }
}

@available(macOS 13.0, *)
public struct TextTextBookmarkEntity: AppEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Bookmark")
    public static var defaultQuery = TextTextBookmarkEntityQuery()

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
public struct TextTextBookmarkEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [TextTextBookmarkEntity] {
        let actions = WorkspaceIntentActions()
        return identifiers.compactMap { id in
            try? TextTextBookmarkEntity(record: actions.document(id: id))
        }
    }

    public func entities(matching string: String) async throws -> [TextTextBookmarkEntity] {
        try WorkspaceIntentActions().searchDocuments(query: string, limit: 20)
            .filter { $0.kind == "bookmark" || $0.relativePath.hasPrefix("Bookmarks/") }
            .map(TextTextBookmarkEntity.init(record:))
    }

    public func suggestedEntities() async throws -> [TextTextBookmarkEntity] {
        try WorkspaceIntentActions().bookmarkDocuments(limit: 10).map(TextTextBookmarkEntity.init(record:))
    }
}

@available(macOS 13.0, *)
public struct TextTextPublicationEntity: AppEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Publication")
    public static var defaultQuery = TextTextPublicationEntityQuery()

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
public struct TextTextPublicationEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [TextTextPublicationEntity] {
        let actions = WorkspaceIntentActions()
        return identifiers.compactMap { id in
            guard let document = try? actions.document(id: id), document.status == "published" else { return nil }
            return TextTextPublicationEntity(record: WorkspacePublicationRecord(document: document, status: "published"))
        }
    }

    public func entities(matching string: String) async throws -> [TextTextPublicationEntity] {
        try WorkspaceIntentActions().searchDocuments(query: string, limit: 20)
            .filter { $0.status == "published" }
            .map { TextTextPublicationEntity(record: WorkspacePublicationRecord(document: $0, status: "published")) }
    }

    public func suggestedEntities() async throws -> [TextTextPublicationEntity] {
        try WorkspaceIntentActions().recentDocuments(limit: 20)
            .filter { $0.status == "published" }
            .map { TextTextPublicationEntity(record: WorkspacePublicationRecord(document: $0, status: "published")) }
    }
}

@available(macOS 13.0, *)
public struct TextTextBlogEntity: AppEntity {
    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Blog")
    public static var defaultQuery = TextTextBlogEntityQuery()

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
public struct TextTextBlogEntityQuery: EntityStringQuery {
    public init() {}

    public func entities(for identifiers: [String]) async throws -> [TextTextBlogEntity] {
        let blogs = blogEntities()
        return identifiers.compactMap { id in blogs.first { $0.id == id } }
    }

    public func entities(matching string: String) async throws -> [TextTextBlogEntity] {
        let query = string.lowercased()
        return blogEntities().filter { query.isEmpty || $0.title.lowercased().contains(query) || $0.folderPath.lowercased().contains(query) }
    }

    public func suggestedEntities() async throws -> [TextTextBlogEntity] {
        blogEntities()
    }

    private func blogEntities() -> [TextTextBlogEntity] {
        // Blog folders come from the server workspace (mode "blog"), not a
        // filesystem scan of the mount.
        let folders = (try? WorkspaceIntentActions().folders()) ?? []
        return folders
            .filter { $0.kind == "blog" }
            .map { folder in
                TextTextBlogEntity(
                    id: folder.id,
                    title: folder.title,
                    kind: "blog",
                    folderPath: folder.folderPath,
                    modifiedDate: folder.modifiedDate
                )
            }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}
