import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

public struct WorkspaceSpotlightDocument: Equatable {
    public var textTextId: String
    public var workspaceHandle: String
    public var title: String
    public var kind: String
    public var status: String
    public var canonicalURL: String?
    public var relativePath: String
    public var fileURL: URL
    public var textContent: String
    public var keywords: [String]
    public var modifiedAt: Date?

    public init(
        textTextId: String,
        workspaceHandle: String,
        title: String,
        kind: String,
        status: String,
        canonicalURL: String? = nil,
        relativePath: String,
        fileURL: URL,
        textContent: String = "",
        keywords: [String] = [],
        modifiedAt: Date? = nil
    ) {
        self.textTextId = textTextId
        self.workspaceHandle = workspaceHandle
        self.title = title
        self.kind = kind
        self.status = status
        self.canonicalURL = canonicalURL
        self.relativePath = relativePath
        self.fileURL = fileURL
        self.textContent = textContent
        self.keywords = keywords
        self.modifiedAt = modifiedAt
    }
}

public final class WorkspaceSpotlightIndexer {
    public static let domainIdentifier = "texttext-workspace"

    private let index: CSSearchableIndex

    public init(index: CSSearchableIndex = .default()) {
        self.index = index
    }

    /// Index pre-built documents whose metadata comes from the server manifest
    /// (the authoritative source of a post's id + title). The File Provider mount
    /// is the sole writer now, and its `.textpack` bodies are zipped and carry no
    /// textTextId, so they cannot be scanned into an index - the manifest is.
    public func indexDocuments(
        _ documents: [WorkspaceSpotlightDocument],
        completion: ((Error?) -> Void)? = nil
    ) {
        guard CSSearchableIndex.isIndexingAvailable() else {
            completion?(nil)
            return
        }
        let items = documents.compactMap { Self.searchableItem(for: $0) }
        guard !items.isEmpty else {
            completion?(nil)
            return
        }
        index.indexSearchableItems(items) { error in completion?(error) }
    }

    public func remove(ids: [String], completion: ((Error?) -> Void)? = nil) {
        guard CSSearchableIndex.isIndexingAvailable(), !ids.isEmpty else {
            completion?(nil)
            return
        }
        index.deleteSearchableItems(withIdentifiers: ids) { error in completion?(error) }
    }

    /// Drops every item TextText ever indexed (used when the sync root changes).
    public func removeAll(completion: ((Error?) -> Void)? = nil) {
        guard CSSearchableIndex.isIndexingAvailable() else {
            completion?(nil)
            return
        }
        index.deleteSearchableItems(withDomainIdentifiers: [Self.domainIdentifier]) { error in
            completion?(error)
        }
    }

    public static func searchableItem(for document: WorkspaceSpotlightDocument) -> CSSearchableItem? {
        guard !isInternal(relativePath: document.relativePath) else { return nil }
        let attributes = attributeSet(for: document)
        let item = CSSearchableItem(
            uniqueIdentifier: document.textTextId,
            domainIdentifier: domainIdentifier,
            attributeSet: attributes
        )
        item.expirationDate = Date.distantFuture
        return item
    }

    public static func attributeSet(for document: WorkspaceSpotlightDocument) -> CSSearchableItemAttributeSet {
        let folderPath = deletingLastPathComponent(document.relativePath)

        let attributes = CSSearchableItemAttributeSet(contentType: .plainText)
        attributes.title = document.title
        attributes.displayName = document.title
        attributes.subject = document.title
        attributes.contentDescription = document.textContent
        attributes.textContent = document.textContent
        attributes.contentType = UTType.plainText.identifier
        attributes.contentURL = document.fileURL
        attributes.path = document.fileURL.path
        attributes.relatedUniqueIdentifier = document.textTextId
        attributes.metadataModificationDate = document.modifiedAt
        attributes.contentModificationDate = document.modifiedAt
        attributes.kind = document.kind
        attributes.creator = "TextText"
        attributes.containerIdentifier = folderPath
        attributes.containerTitle = folderPath
        attributes.url = URL(string: "texttext-app://item/\(document.textTextId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? document.textTextId)")

        var keywords = Set<String>()
        keywords.insert(document.kind)
        keywords.insert(document.status)
        if !folderPath.isEmpty { keywords.insert(folderPath) }
        if !document.workspaceHandle.isEmpty { keywords.insert(document.workspaceHandle) }
        for keyword in document.keywords where !keyword.isEmpty {
            keywords.insert(keyword)
        }
        attributes.keywords = Array(keywords).sorted()

        setCustomValue(document.workspaceHandle, key: CustomKeys.blogHandle, attributes: attributes)
        setCustomValue(folderPath, key: CustomKeys.folderPath, attributes: attributes)
        setCustomValue(document.status, key: CustomKeys.publicationState, attributes: attributes)
        setCustomValue(document.canonicalURL, key: CustomKeys.publishedURL, attributes: attributes)
        return attributes
    }

    private enum CustomKeys {
        static let blogHandle = CSCustomAttributeKey(keyName: "com_texttext_blog_handle")!
        static let folderPath = CSCustomAttributeKey(keyName: "com_texttext_folder_path")!
        static let publicationState = CSCustomAttributeKey(keyName: "com_texttext_publication_state")!
        static let publishedURL = CSCustomAttributeKey(keyName: "com_texttext_published_url")!
    }

    private static func setCustomValue(_ value: String?, key: CSCustomAttributeKey, attributes: CSSearchableItemAttributeSet) {
        guard let value, !value.isEmpty else { return }
        attributes.setValue(value as NSString, forCustomKey: key)
    }

    private static func isInternal(relativePath: String) -> Bool {
        let first = relativePath.split(separator: "/", omittingEmptySubsequences: true).first
        return first == ".texttext" || first == ".texttext-local.nosync"
    }

    private static func deletingLastPathComponent(_ path: String) -> String {
        let value = (path as NSString).deletingLastPathComponent
        return value == "." ? "" : value
    }
}
