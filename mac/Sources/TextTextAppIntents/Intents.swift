import AppIntents
import Foundation

@available(macOS 13.0, *)
public struct CreateDocumentIntent: AppIntent {
    public static var title: LocalizedStringResource = "Create document"
    public static var description = IntentDescription("Create a note in your signed-in TextText workspace.")

    @Parameter(title: "Title")
    public var titleText: String

    @Parameter(title: "Body", default: "")
    public var body: String

    @Parameter(title: "Folder path", default: "")
    public var folderPath: String

    public static var parameterSummary: some ParameterSummary {
        Summary("Create \(\.$titleText) in \(\.$folderPath)") { \.$body }
    }

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextDocumentEntity> {
        let record = try NativeItemActions().create(title: titleText, body: body, folder: folderPath)
        return .result(value: TextTextDocumentEntity(record: record))
    }
}

@available(macOS 13.0, *)
public struct OpenDocumentIntent: AppIntent {
    public static var title: LocalizedStringResource = "Open document"
    public static var description = IntentDescription("Open an accessible item in TextText.")

    @Parameter(title: "Document")
    public var document: TextTextDocumentEntity

    public static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$document)")
    }

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<URL> {
        let url = try NativeItemActions().open(id: document.id)
        let opened = await NativeWorkspaceCommandRegistry.openURL(url)
        guard opened else { throw WorkspaceIntentServerError.transport("Could not open TextText") }
        return .result(value: url)
    }
}

@available(macOS 13.0, *)
public struct AppendTextToDocumentIntent: AppIntent {
    public static var title: LocalizedStringResource = "Append text to document"
    public static var description = IntentDescription("Append text to an item in your signed-in TextText workspace.")

    @Parameter(title: "Document")
    public var document: TextTextDocumentEntity

    @Parameter(title: "Text")
    public var text: String

    public static var parameterSummary: some ParameterSummary {
        Summary("Append \(\.$text) to \(\.$document)")
    }

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextDocumentEntity> {
        let record = try NativeItemActions().append(id: document.id, text: text)
        return .result(value: TextTextDocumentEntity(record: record))
    }
}

@available(macOS 13.0, *)
public struct SearchDocumentsIntent: AppIntent {
    public static var title: LocalizedStringResource = "Search documents"
    public static var description = IntentDescription("Search accessible items by title and body.")

    @Parameter(title: "Query")
    public var query: String

    @Parameter(title: "Limit", default: 10)
    public var limit: Int

    public static var parameterSummary: some ParameterSummary {
        Summary("Search for \(\.$query)") { \.$limit }
    }

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<[TextTextDocumentEntity]> {
        let records = try NativeItemActions().search(query: query, limit: limit)
        return .result(value: records.map(TextTextDocumentEntity.init(record:)))
    }
}

@available(macOS 13.0, *)
public struct CreateFolderIntent: AppIntent {
    public static var title: LocalizedStringResource = "Create folder"
    public static var description = IntentDescription("Create a local folder in the TextText workspace.")

    @Parameter(title: "Name")
    public var name: String

    @Parameter(title: "Parent path", default: "Notes")
    public var parentPath: String

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextFolderEntity> {
        let folder = try WorkspaceIntentActions().createFolder(name: name, parentPath: parentPath)
        return .result(value: TextTextFolderEntity(record: folder))
    }
}

@available(macOS 13.0, *)
public struct MoveDocumentIntent: AppIntent {
    public static var title: LocalizedStringResource = "Move document"
    public static var description = IntentDescription("Move a local workspace document to another folder.")

    @Parameter(title: "Document")
    public var document: TextTextDocumentEntity

    @Parameter(title: "Folder path")
    public var folderPath: String

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextDocumentEntity> {
        let record = try WorkspaceIntentActions().moveDocument(id: document.id, toFolder: folderPath)
        return .result(value: TextTextDocumentEntity(record: record))
    }
}

@available(macOS 13.0, *)
public struct CreateBookmarkFromURLIntent: AppIntent {
    public static var title: LocalizedStringResource = "Create bookmark from URL"
    public static var description = IntentDescription("Create a local markdown bookmark from a URL.")

    @Parameter(title: "URL")
    public var url: URL

    @Parameter(title: "Title")
    public var titleText: String?

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextBookmarkEntity> {
        let record = try WorkspaceIntentActions().createBookmark(from: url, title: titleText)
        return .result(value: TextTextBookmarkEntity(record: record))
    }
}

@available(macOS 13.0, *)
public struct PublishDocumentIntent: AppIntent {
    public static var title: LocalizedStringResource = "Publish document"
    public static var description = IntentDescription("Mark a local workspace document as published.")

    @Parameter(title: "Document")
    public var document: TextTextDocumentEntity

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextPublicationEntity> {
        let publication = try WorkspaceIntentActions().publishDocument(id: document.id)
        return .result(value: TextTextPublicationEntity(record: publication))
    }
}

@available(macOS 13.0, *)
public struct UnpublishDocumentIntent: AppIntent {
    public static var title: LocalizedStringResource = "Unpublish document"
    public static var description = IntentDescription("Mark a local workspace document as draft.")

    @Parameter(title: "Document")
    public var document: TextTextDocumentEntity

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<TextTextDocumentEntity> {
        let record = try WorkspaceIntentActions().unpublishDocument(id: document.id)
        return .result(value: TextTextDocumentEntity(record: record))
    }
}

@available(macOS 13.0, *)
public struct GetRecentDocumentsIntent: AppIntent {
    public static var title: LocalizedStringResource = "Get recent documents"
    public static var description = IntentDescription("Return recently modified local workspace documents.")

    @Parameter(title: "Limit", default: 10)
    public var limit: Int

    public init() {}

    public func perform() async throws -> some IntentResult & ReturnsValue<[TextTextDocumentEntity]> {
        let records = try WorkspaceIntentActions().recentDocuments(limit: limit)
        return .result(value: records.map(TextTextDocumentEntity.init(record:)))
    }
}
