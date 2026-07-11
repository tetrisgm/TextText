import CoreSpotlight
import Foundation
import UniformTypeIdentifiers
import WriteWorkspaceCore

public struct WorkspaceSpotlightDocument: Equatable {
    public var writeId: String
    public var entry: IndexEntry
    public var relativePath: String
    public var fileURL: URL
    public var markdown: String

    public init(writeId: String, entry: IndexEntry, relativePath: String, fileURL: URL, markdown: String) {
        self.writeId = writeId
        self.entry = entry
        self.relativePath = relativePath
        self.fileURL = fileURL
        self.markdown = markdown
    }
}

public final class WorkspaceSpotlightIndexer {
    public static let domainIdentifier = "write-workspace"

    public let root: URL
    private let index: CSSearchableIndex
    private let coordinator: WorkspaceFileCoordinator

    public init(root: URL, index: CSSearchableIndex = .default()) {
        self.root = root
        self.index = index
        self.coordinator = WorkspaceFileCoordinator(rootURL: root)
    }

    public func reindex(entries: [String: IndexEntry], completion: ((Error?) -> Void)? = nil) {
        guard CSSearchableIndex.isIndexingAvailable() else {
            completion?(nil)
            return
        }
        let items = entries.compactMap { writeId, entry -> CSSearchableItem? in
            makeSearchableItem(writeId: writeId, entry: entry)
        }
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

    /// Drops every item Write ever indexed (used when the sync root changes).
    public func removeAll(completion: ((Error?) -> Void)? = nil) {
        guard CSSearchableIndex.isIndexingAvailable() else {
            completion?(nil)
            return
        }
        index.deleteSearchableItems(withDomainIdentifiers: [Self.domainIdentifier]) { error in
            completion?(error)
        }
    }

    public func makeSearchableItem(writeId: String, entry: IndexEntry) -> CSSearchableItem? {
        guard !WorkspaceLayout.isInternal(relativePath: entry.relativePath) else { return nil }
        let url = root.appendingPathComponent(entry.relativePath)
        // Indexing must never force-download an evicted iCloud file, and an
        // unreadable or evicted file is still a real item: fall back to a
        // metadata-only entry instead of dropping it.
        let markdown: String
        switch coordinator.materializationState(for: url) {
        case .local, .current, .downloaded, .unknown:
            if let data = try? coordinator.readData(at: url),
               let text = String(data: data, encoding: .utf8) {
                markdown = text
            } else {
                markdown = ""
            }
        case .notDownloaded, .downloading, .failed:
            markdown = ""
        }
        let document = WorkspaceSpotlightDocument(
            writeId: writeId,
            entry: entry,
            relativePath: entry.relativePath,
            fileURL: url,
            markdown: markdown
        )
        return Self.searchableItem(for: document)
    }

    public static func searchableItem(for document: WorkspaceSpotlightDocument) -> CSSearchableItem? {
        guard !WorkspaceLayout.isInternal(relativePath: document.relativePath) else { return nil }
        let attributes = attributeSet(for: document)
        let item = CSSearchableItem(
            uniqueIdentifier: document.writeId,
            domainIdentifier: domainIdentifier,
            attributeSet: attributes
        )
        item.expirationDate = Date.distantFuture
        return item
    }

    public static func attributeSet(for document: WorkspaceSpotlightDocument) -> CSSearchableItemAttributeSet {
        let parsed = SpotlightParsedMarkdown(markdown: document.markdown)
        let title = parsed.frontMatter["title"] ?? document.fileURL.deletingPathExtension().lastPathComponent
        let kind = document.entry.kind ?? parsed.frontMatter["kind"] ?? parsed.frontMatter["type"] ?? "document"
        let folderPath = deletingLastPathComponent(document.relativePath)
        let blogHandle = blogHandle(for: document.relativePath)
        let status = parsed.frontMatter["status"] ?? "draft"
        let publishedURL = parsed.frontMatter["published_url"]
            ?? parsed.frontMatter["canonical_url"]
            ?? parsed.frontMatter["url"]
        let modifiedDate = document.entry.fileMtime.map(Date.init(timeIntervalSince1970:))

        let attributes = CSSearchableItemAttributeSet(contentType: .plainText)
        attributes.title = title
        attributes.displayName = title
        attributes.subject = title
        attributes.contentDescription = parsed.body
        attributes.textContent = parsed.body
        attributes.contentType = UTType.plainText.identifier
        attributes.contentURL = document.fileURL
        attributes.path = document.fileURL.path
        attributes.relatedUniqueIdentifier = document.writeId
        attributes.metadataModificationDate = modifiedDate
        attributes.contentModificationDate = modifiedDate
        attributes.kind = kind
        attributes.creator = "Write"
        attributes.containerIdentifier = folderPath
        attributes.containerTitle = folderPath
        attributes.url = URL(string: "write-app://item/\(document.writeId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? document.writeId)")

        var keywords = Set<String>()
        keywords.insert(kind)
        keywords.insert(status)
        if !folderPath.isEmpty { keywords.insert(folderPath) }
        if let blogHandle { keywords.insert(blogHandle) }
        for tag in parsed.tags {
            keywords.insert(tag)
        }
        attributes.keywords = Array(keywords).sorted()

        setCustomValue(blogHandle, key: CustomKeys.blogHandle, attributes: attributes)
        setCustomValue(folderPath, key: CustomKeys.folderPath, attributes: attributes)
        setCustomValue(status, key: CustomKeys.publicationState, attributes: attributes)
        setCustomValue(publishedURL, key: CustomKeys.publishedURL, attributes: attributes)
        return attributes
    }

    private enum CustomKeys {
        static let blogHandle = CSCustomAttributeKey(keyName: "com_writeapp_blog_handle")!
        static let folderPath = CSCustomAttributeKey(keyName: "com_writeapp_folder_path")!
        static let publicationState = CSCustomAttributeKey(keyName: "com_writeapp_publication_state")!
        static let publishedURL = CSCustomAttributeKey(keyName: "com_writeapp_published_url")!
    }

    private static func setCustomValue(_ value: String?, key: CSCustomAttributeKey, attributes: CSSearchableItemAttributeSet) {
        guard let value, !value.isEmpty else { return }
        attributes.setValue(value as NSString, forCustomKey: key)
    }

    private static func blogHandle(for relativePath: String) -> String? {
        let parts = relativePath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 2, parts[0] == "Blogs" else { return nil }
        return parts[1]
    }

    private static func deletingLastPathComponent(_ path: String) -> String {
        let value = (path as NSString).deletingLastPathComponent
        return value == "." ? "" : value
    }
}

private struct SpotlightParsedMarkdown {
    var frontMatter: [String: String]
    var body: String
    var tags: [String]

    init(markdown: String) {
        guard markdown.hasPrefix("---\n") || markdown.hasPrefix("---\r\n"),
              let firstBreak = markdown.firstIndex(of: "\n") else {
            self.frontMatter = [:]
            self.body = markdown
            self.tags = []
            return
        }
        var cursor = markdown.index(after: firstBreak)
        var values: [String: String] = [:]
        while cursor < markdown.endIndex {
            let lineStart = cursor
            let nextBreak = markdown[cursor...].firstIndex(of: "\n") ?? markdown.endIndex
            let rawLine = markdown[lineStart..<nextBreak]
            let line = rawLine.last == "\r" ? rawLine.dropLast() : rawLine[...]
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                let bodyStart = nextBreak == markdown.endIndex ? markdown.endIndex : markdown.index(after: nextBreak)
                self.frontMatter = values
                self.body = String(markdown[bodyStart...]).trimmingCharacters(in: .newlines)
                self.tags = Self.parseTags(values["tags"] ?? values["keywords"])
                return
            }
            if let colon = line.firstIndex(of: ":") {
                let key = line[..<colon].trimmingCharacters(in: .whitespaces)
                let rawValue = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                if !key.isEmpty { values[key] = Self.parseValue(rawValue) }
            }
            cursor = nextBreak == markdown.endIndex ? markdown.endIndex : markdown.index(after: nextBreak)
        }
        self.frontMatter = values
        self.body = markdown
        self.tags = Self.parseTags(values["tags"] ?? values["keywords"])
    }

    private static func parseValue(_ raw: String) -> String {
        if let data = raw.data(using: .utf8),
           let string = try? JSONSerialization.jsonObject(with: data) as? String {
            return string
        }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }

    private static func parseTags(_ raw: String?) -> [String] {
        guard let raw else { return [] }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("["),
           trimmed.hasSuffix("]"),
           let data = trimmed.data(using: .utf8),
           let tags = try? JSONSerialization.jsonObject(with: data) as? [String] {
            return tags
        }
        return trimmed
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
