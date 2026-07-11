import Foundation
import WriteWorkspaceCore

public struct WorkspaceDocumentRecord: Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var relativePath: String
    public var modifiedDate: Date?
    public var status: String?
    public var publishedURL: URL?

    public init(
        id: String,
        title: String,
        kind: String,
        folderPath: String,
        relativePath: String,
        modifiedDate: Date?,
        status: String?,
        publishedURL: URL?
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.folderPath = folderPath
        self.relativePath = relativePath
        self.modifiedDate = modifiedDate
        self.status = status
        self.publishedURL = publishedURL
    }

    public var deepLink: URL {
        URL(string: "write-app://item/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")!
    }
}

public struct WorkspaceFolderRecord: Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?

    public init(id: String, title: String, kind: String, folderPath: String, modifiedDate: Date?) {
        self.id = id
        self.title = title
        self.kind = kind
        self.folderPath = folderPath
        self.modifiedDate = modifiedDate
    }
}

public struct WorkspacePublicationRecord: Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var kind: String
    public var folderPath: String
    public var modifiedDate: Date?
    public var status: String
    public var publishedURL: URL?

    public init(document: WorkspaceDocumentRecord, status: String) {
        self.id = document.id
        self.title = document.title
        self.kind = document.kind
        self.folderPath = document.folderPath
        self.modifiedDate = document.modifiedDate
        self.status = status
        self.publishedURL = document.publishedURL
    }
}

public enum WorkspaceIntentError: Error, LocalizedError, Equatable {
    case emptyTitle
    case emptyText
    case emptyFolderName
    case invalidFolderPath(String)
    case documentNotFound(String)
    case invalidMarkdown(String)
    case unlistedKind(String)

    public var errorDescription: String? {
        switch self {
        case .emptyTitle:
            return "A title is required"
        case .emptyText:
            return "Text is required"
        case .emptyFolderName:
            return "A folder name is required"
        case .invalidFolderPath(let path):
            return "Invalid workspace folder path \(path)"
        case .documentNotFound(let id):
            return "No workspace document found for \(id)"
        case .invalidMarkdown(let path):
            return "\(path) is not valid UTF-8 markdown"
        case .unlistedKind(let kind):
            return "A \(kind) is always private and cannot be published"
        }
    }
}

public struct WorkspaceIntentActions {
    public let root: URL
    private let coordinator: WorkspaceFileCoordinator
    private let now: @Sendable () -> Date

    public init(root: URL = WorkspaceRootResolver().resolve().url, now: @escaping @Sendable () -> Date = { Date() }) {
        self.root = root
        self.coordinator = WorkspaceFileCoordinator(rootURL: root)
        self.now = now
    }

    public func createDocument(title: String, body: String = "", folderPath: String? = nil) throws -> WorkspaceDocumentRecord {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { throw WorkspaceIntentError.emptyTitle }
        let directory = try normalizedDirectory(folderPath, defaultPath: "Notes")
        let kind = kindForDirectory(directory)
        let id = UUID().uuidString
        let date = isoString(now())
        let slug = slugForTitle(trimmedTitle)
        let url = uniqueMarkdownURL(directory: directory, slug: slug)
        let markdown = MarkdownIdentityCodec.inject(
            into: renderMarkdown(
                title: trimmedTitle,
                slug: slug,
                kind: kind,
                status: "draft",
                createdAt: date,
                updatedAt: date,
                extraFrontMatter: [:],
                body: body
            ),
            itemId: id,
            folderId: nil,
            kind: kind
        )
        try coordinator.writeData(Data(markdown.utf8), to: url)
        return try saveAndRecord(url: url, itemId: id)
    }

    public func openDocument(id: String) throws -> URL {
        try document(id: id).deepLink
    }

    @discardableResult
    public func appendText(_ text: String, toDocument id: String) throws -> WorkspaceDocumentRecord {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw WorkspaceIntentError.emptyText
        }
        let located = try locateDocument(id: id)
        var markdown = located.markdown
        if !markdown.hasSuffix("\n") { markdown += "\n" }
        markdown += text
        if !markdown.hasSuffix("\n") { markdown += "\n" }
        markdown = setFrontMatterValue(key: "updated_at", value: isoString(now()), in: markdown)
        try coordinator.writeData(Data(markdown.utf8), to: located.url)
        return try saveAndRecord(url: located.url, itemId: id)
    }

    public func searchDocuments(query: String, limit: Int = 10) throws -> [WorkspaceDocumentRecord] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let records = try allLocatedDocuments()
        let matches: [LocatedDocument]
        if normalizedQuery.isEmpty {
            matches = records
        } else {
            matches = records.filter { located in
                let parsed = ParsedMarkdown(markdown: located.markdown)
                return located.record.title.lowercased().contains(normalizedQuery)
                    || parsed.body.lowercased().contains(normalizedQuery)
            }
        }
        return Array(matches
            .map(\.record)
            .sorted(by: documentSort)
            .prefix(max(0, limit)))
    }

    public func createFolder(name: String, parentPath: String? = nil) throws -> WorkspaceFolderRecord {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw WorkspaceIntentError.emptyFolderName }
        let parent = try normalizedDirectory(parentPath, defaultPath: "Notes")
        let child = safePathComponent(trimmed)
        let path = join(parent, child)
        guard !WorkspaceLayout.isInternal(relativePath: path) else {
            throw WorkspaceIntentError.invalidFolderPath(path)
        }
        let url = root.appendingPathComponent(path, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return folderRecord(path: path, url: url)
    }

    @discardableResult
    public func moveDocument(id: String, toFolder folderPath: String) throws -> WorkspaceDocumentRecord {
        let located = try locateDocument(id: id)
        let directory = try normalizedDirectory(folderPath, defaultPath: "Notes")
        let destination = uniqueMarkdownURL(
            directory: directory,
            slug: located.url.deletingPathExtension().lastPathComponent
        )
        try coordinator.moveItem(at: located.url, to: destination)
        var markdown = try readMarkdown(destination)
        let slug = destination.deletingPathExtension().lastPathComponent
        markdown = setFrontMatterValue(key: "slug", value: slug, in: markdown)
        markdown = setFrontMatterValue(key: "updated_at", value: isoString(now()), in: markdown)
        try coordinator.writeData(Data(markdown.utf8), to: destination)
        return try saveAndRecord(url: destination, itemId: id)
    }

    public func createBookmark(from url: URL, title: String? = nil) throws -> WorkspaceDocumentRecord {
        let date = now()
        let year = Calendar(identifier: .gregorian).component(.year, from: date)
        let directory = "Bookmarks/\(year)"
        let displayTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? title!.trimmingCharacters(in: .whitespacesAndNewlines)
            : (url.host ?? url.absoluteString)
        let id = UUID().uuidString
        let slug = slugForTitle(displayTitle)
        let target = uniqueMarkdownURL(directory: directory, slug: slug)
        let dateText = isoString(date)
        // The server keeps a bookmark's URL only in the links list; a bare
        // url: scalar is dropped, syncing the bookmark with no link. Emit the
        // links list matching the server's JSON.stringify render (slashes not
        // escaped, so the hashes agree).
        let linksJSON = "[{\"label\":\(jsonStringNoSlashEscape(displayTitle)),\"href\":\(jsonStringNoSlashEscape(url.absoluteString))}]"
        let markdown = MarkdownIdentityCodec.inject(
            into: renderMarkdown(
                title: displayTitle,
                slug: slug,
                kind: "bookmark",
                status: "draft",
                createdAt: dateText,
                updatedAt: dateText,
                extraFrontMatter: [
                    "type": "bookmark",
                    "created_at": dateText,
                ],
                rawFrontMatterLines: ["links: \(linksJSON)"],
                body: "[\(displayTitle)](\(url.absoluteString))\n"
            ),
            itemId: id,
            folderId: "bookmarks",
            kind: "bookmark"
        )
        try coordinator.writeData(Data(markdown.utf8), to: target)
        return try saveAndRecord(url: target, itemId: id)
    }

    @discardableResult
    public func publishDocument(id: String) throws -> WorkspacePublicationRecord {
        let document = try setPublicationStatus("published", forDocument: id)
        return WorkspacePublicationRecord(document: document, status: "published")
    }

    @discardableResult
    public func unpublishDocument(id: String) throws -> WorkspaceDocumentRecord {
        try setPublicationStatus("draft", forDocument: id)
    }

    public func recentDocuments(limit: Int = 10) throws -> [WorkspaceDocumentRecord] {
        Array(try allLocatedDocuments()
            .map(\.record)
            .sorted(by: documentSort)
            .prefix(max(0, limit)))
    }

    public func document(id: String) throws -> WorkspaceDocumentRecord {
        try locateDocument(id: id).record
    }

    public func allDocuments() throws -> [WorkspaceDocumentRecord] {
        try allLocatedDocuments().map(\.record).sorted(by: documentSort)
    }

    public func bookmarkDocuments(limit: Int = 20) throws -> [WorkspaceDocumentRecord] {
        Array(try allLocatedDocuments()
            .map(\.record)
            .filter { $0.kind == "bookmark" || $0.relativePath.hasPrefix("Bookmarks/") }
            .sorted(by: documentSort)
            .prefix(max(0, limit)))
    }

    public func folders() throws -> [WorkspaceFolderRecord] {
        let roots = ["Notes", "Drafts", "Bookmarks", "Blogs"]
        var records: [WorkspaceFolderRecord] = []
        for rootName in roots {
            let url = root.appendingPathComponent(rootName, isDirectory: true)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            records.append(folderRecord(path: rootName, url: url))
            guard let enumerator = FileManager.default.enumerator(
                at: url,
                includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ) else { continue }
            for case let child as URL in enumerator {
                var isDirectory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: child.path, isDirectory: &isDirectory),
                      isDirectory.boolValue,
                      let path = WorkspaceLayout.relativePath(for: child, under: root),
                      !WorkspaceLayout.isInternal(relativePath: path) else { continue }
                records.append(folderRecord(path: path, url: child))
            }
        }
        return records.sorted { $0.folderPath < $1.folderPath }
    }

    private func setPublicationStatus(_ status: String, forDocument id: String) throws -> WorkspaceDocumentRecord {
        let located = try locateDocument(id: id)
        // Notes and bookmarks are unlisted forever; the invariant holds at
        // every layer, not just server-side, so publishing them is refused
        // here before any byte changes.
        if status == "published" {
            let kind = located.record.kind.lowercased()
            if kind == "note" || kind == "bookmark" {
                throw WorkspaceIntentError.unlistedKind(kind)
            }
        }
        var markdown = setFrontMatterValue(key: "status", value: status, in: located.markdown)
        markdown = setFrontMatterValue(key: "updated_at", value: isoString(now()), in: markdown)
        try coordinator.writeData(Data(markdown.utf8), to: located.url)
        return try saveAndRecord(url: located.url, itemId: id)
    }

    private func locateDocument(id: String) throws -> LocatedDocument {
        if let located = try allLocatedDocuments().first(where: { $0.record.id == id }) {
            return located
        }
        throw WorkspaceIntentError.documentNotFound(id)
    }

    private func allLocatedDocuments() throws -> [LocatedDocument] {
        let index = WorkspaceIndexStore.rebuild(
            root: root,
            readData: { url in try coordinator.readData(at: url) }
        )
        return try index.entries.compactMap { itemId, entry in
            guard !WorkspaceLayout.isInternal(relativePath: entry.relativePath) else { return nil }
            let url = root.appendingPathComponent(entry.relativePath)
            let markdown = try readMarkdown(url)
            guard let identity = MarkdownIdentityCodec.extract(from: markdown) else {
                return nil
            }
            return LocatedDocument(
                url: url,
                markdown: markdown,
                record: record(
                    itemId: itemId,
                    identity: identity,
                    relativePath: entry.relativePath,
                    url: url,
                    markdown: markdown
                )
            )
        }
    }

    private func saveAndRecord(url: URL, itemId: String) throws -> WorkspaceDocumentRecord {
        let markdown = try readMarkdown(url)
        guard let relativePath = WorkspaceLayout.relativePath(for: url, under: root) else {
            throw WorkspaceIntentError.invalidFolderPath(url.path)
        }
        let identity = MarkdownIdentityCodec.extract(from: markdown)
        let data = Data(markdown.utf8)
        var index = WorkspaceIndexStore.load(root: root) ?? SyncIndex()
        index.entries[itemId] = IndexEntry(
            hash: MarkdownIdentityCodec.syncHash(for: data),
            relativePath: relativePath,
            fileMtime: fileMtime(url),
            folderId: identity?.folderId,
            kind: identity?.kind
        )
        try WorkspaceIndexStore.save(index, root: root)
        return record(
            itemId: itemId,
            identity: identity,
            relativePath: relativePath,
            url: url,
            markdown: markdown
        )
    }

    private func record(
        itemId: String,
        identity: MarkdownIdentity?,
        relativePath: String,
        url: URL,
        markdown: String
    ) -> WorkspaceDocumentRecord {
        let parsed = ParsedMarkdown(markdown: markdown)
        let title = parsed.frontMatter["title"] ?? url.deletingPathExtension().lastPathComponent
        let kind = identity?.kind ?? parsed.frontMatter["kind"] ?? parsed.frontMatter["type"] ?? "document"
        let folderPath = deletingLastPathComponent(relativePath)
        let publishedURL = (parsed.frontMatter["published_url"] ?? parsed.frontMatter["url"]).flatMap(URL.init(string:))
        return WorkspaceDocumentRecord(
            id: itemId,
            title: title,
            kind: kind,
            folderPath: folderPath,
            relativePath: relativePath,
            modifiedDate: fileMtime(url).map(Date.init(timeIntervalSince1970:)),
            status: parsed.frontMatter["status"],
            publishedURL: publishedURL
        )
    }

    private func readMarkdown(_ url: URL) throws -> String {
        let data = try coordinator.readData(at: url)
        guard let markdown = String(data: data, encoding: .utf8) else {
            let relative = WorkspaceLayout.relativePath(for: url, under: root) ?? url.path
            throw WorkspaceIntentError.invalidMarkdown(relative)
        }
        return markdown
    }

    private func normalizedDirectory(_ raw: String?, defaultPath: String) throws -> String {
        let source = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = source?.isEmpty == false ? source! : defaultPath
        let normalized = value
            .replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)
        guard !normalized.isEmpty,
              !normalized.contains("."),
              !normalized.contains("..") else {
            throw WorkspaceIntentError.invalidFolderPath(value)
        }
        var parts = normalized
        switch parts[0].lowercased() {
        case "notes": parts[0] = "Notes"
        case "drafts": parts[0] = "Drafts"
        case "bookmarks": parts[0] = "Bookmarks"
        case "blogs": parts[0] = "Blogs"
        default: break
        }
        let result = parts.map(safePathComponent).joined(separator: "/")
        guard !WorkspaceLayout.isInternal(relativePath: result) else {
            throw WorkspaceIntentError.invalidFolderPath(value)
        }
        return result
    }

    private func uniqueMarkdownURL(directory: String, slug: String) -> URL {
        let directoryURL = root.appendingPathComponent(directory, isDirectory: true)
        var candidate = directoryURL.appendingPathComponent("\(slug).md")
        var counter = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = directoryURL.appendingPathComponent("\(slug)-\(counter).md")
            counter += 1
        }
        return candidate
    }

    private func renderMarkdown(
        title: String,
        slug: String,
        kind: String,
        status: String,
        createdAt: String,
        updatedAt: String,
        extraFrontMatter: [String: String],
        rawFrontMatterLines: [String] = [],
        body: String
    ) -> String {
        var lines = [
            "---",
            "title: \(jsonString(title))",
            "slug: \(jsonString(slug))",
            "kind: \(jsonString(kind))",
            "status: \(jsonString(status))",
            "created_at: \(jsonString(createdAt))",
            "updated_at: \(jsonString(updatedAt))",
        ]
        for key in extraFrontMatter.keys.sorted() {
            if let value = extraFrontMatter[key] {
                lines.append("\(key): \(jsonString(value))")
            }
        }
        lines.append(contentsOf: rawFrontMatterLines)
        lines.append("---")
        lines.append("")
        lines.append(body)
        if !body.hasSuffix("\n") { lines.append("") }
        return lines.joined(separator: "\n")
    }

    private func setFrontMatterValue(key: String, value: String, in markdown: String) -> String {
        guard markdown.hasPrefix("---\n") || markdown.hasPrefix("---\r\n"),
              let firstBreak = markdown.firstIndex(of: "\n") else {
            return "---\n\(key): \(jsonString(value))\n---\n\n\(markdown)"
        }
        var text = markdown
        var cursor = text.index(after: firstBreak)
        while cursor < text.endIndex {
            let lineStart = cursor
            let nextBreak = text[cursor...].firstIndex(of: "\n") ?? text.endIndex
            let rawLine = text[lineStart..<nextBreak]
            let line = rawLine.last == "\r" ? rawLine.dropLast() : rawLine[...]
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                text.insert(contentsOf: "\(key): \(jsonString(value))\n", at: lineStart)
                return text
            }
            if line.hasPrefix("\(key):") {
                text.replaceSubrange(lineStart..<nextBreak, with: "\(key): \(jsonString(value))")
                return text
            }
            cursor = nextBreak == text.endIndex ? text.endIndex : text.index(after: nextBreak)
        }
        return text
    }

    private func folderRecord(path: String, url: URL) -> WorkspaceFolderRecord {
        WorkspaceFolderRecord(
            id: path,
            title: url.lastPathComponent,
            kind: path.hasPrefix("Blogs/") ? "blog" : "folder",
            folderPath: path,
            modifiedDate: fileMtime(url).map(Date.init(timeIntervalSince1970:))
        )
    }

    private func documentSort(_ lhs: WorkspaceDocumentRecord, _ rhs: WorkspaceDocumentRecord) -> Bool {
        let left = lhs.modifiedDate ?? .distantPast
        let right = rhs.modifiedDate ?? .distantPast
        if left != right { return left > right }
        return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
    }

    private func kindForDirectory(_ directory: String) -> String {
        if directory.hasPrefix("Bookmarks") { return "bookmark" }
        if directory.hasPrefix("Blogs") || directory.hasPrefix("Drafts") { return "article" }
        return "note"
    }

    private func slugForTitle(_ title: String) -> String {
        let folded = title.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        var output = ""
        var previousDash = false
        for scalar in folded.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                output.append(Character(scalar).lowercased())
                previousDash = false
            } else if !previousDash {
                output.append("-")
                previousDash = true
            }
        }
        let trimmed = output.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? "untitled" : trimmed
    }

    private func safePathComponent(_ value: String) -> String {
        value.replacingOccurrences(of: "/", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func deletingLastPathComponent(_ path: String) -> String {
        let value = (path as NSString).deletingLastPathComponent
        return value == "." ? "" : value
    }

    private func join(_ parts: String...) -> String {
        parts.flatMap { $0.split(separator: "/", omittingEmptySubsequences: true).map(String.init) }
            .joined(separator: "/")
    }

    private func fileMtime(_ url: URL) -> Double? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970
    }

    private func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }

    private func jsonStringNoSlashEscape(_ value: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return jsonString(value)
        }
        return text
    }
}

private struct LocatedDocument {
    var url: URL
    var markdown: String
    var record: WorkspaceDocumentRecord
}

private struct ParsedMarkdown {
    var frontMatter: [String: String]
    var body: String

    init(markdown: String) {
        guard markdown.hasPrefix("---\n") || markdown.hasPrefix("---\r\n"),
              let firstBreak = markdown.firstIndex(of: "\n") else {
            self.frontMatter = [:]
            self.body = markdown
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
                self.body = String(markdown[bodyStart...])
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
    }

    private static func parseValue(_ raw: String) -> String {
        if let data = raw.data(using: .utf8),
           let value = try? JSONSerialization.jsonObject(with: data) as? String {
            return value
        }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }
}
