import Foundation

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
    case notSignedIn
    case emptyTitle
    case emptyText
    case emptyFolderName
    case invalidFolderPath(String)
    case documentNotFound(String)
    case invalidMarkdown(String)
    case unlistedKind(String)

    public var errorDescription: String? {
        switch self {
        case .notSignedIn:
            return "Sign in to Write to use this shortcut"
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

/// App Intents workspace operations, backed by the SERVER (the source of truth),
/// not the File Provider mount or the retired iCloud mirror. Create goes through
/// `postFile`; open/list/search/append/move/publish resolve through
/// `workspace()` + folder manifests + `fileText`/`putFile`/`patchFile`, all keyed
/// by the server post id (the same id the `write-app://item/{id}` deep link and
/// the File Provider item use). Nothing here reads or writes a `.md` file.
public struct WorkspaceIntentActions {
    private let server: WorkspaceIntentServer?
    private let now: @Sendable () -> Date

    /// The default server comes from the startup-registered factory; tests inject
    /// a fake. No filesystem root is involved anymore.
    public init(
        server: WorkspaceIntentServer? = nil,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.server = server ?? WorkspaceIntentServerRegistry.makeServer()
        self.now = now
    }

    private func requireServer() throws -> WorkspaceIntentServer {
        guard let server else { throw WorkspaceIntentError.notSignedIn }
        return server
    }

    // MARK: Create

    public func createDocument(title: String, body: String = "", folderPath: String? = nil) throws -> WorkspaceDocumentRecord {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { throw WorkspaceIntentError.emptyTitle }
        let server = try requireServer()
        let folders = try server.folders()
        let (folder, kind) = targetFolder(for: folderPath, folders: folders, defaultMode: "notes")
        let slug = slugForTitle(trimmedTitle)
        let date = isoString(now())
        let markdown = renderMarkdown(
            title: trimmedTitle, slug: slug, kind: kind, status: "draft",
            createdAt: date, updatedAt: date, extraFrontMatter: [:], body: body)
        let item = try server.createDocument(
            body: markdown, folderId: folder?.id, idempotencyKey: nil)
        return record(from: item, folder: folder, folders: folders)
    }

    public func createBookmark(from url: URL, title: String? = nil) throws -> WorkspaceDocumentRecord {
        let server = try requireServer()
        let folders = try server.folders()
        let folder = folders.first { $0.mode == "bookmarks" }
        let date = now()
        let displayTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? title!.trimmingCharacters(in: .whitespacesAndNewlines)
            : (url.host ?? url.absoluteString)
        let slug = slugForTitle(displayTitle)
        let dateText = isoString(date)
        // The server keeps a bookmark's URL only in the links list; a bare url:
        // scalar is dropped, syncing the bookmark with no link. Emit the links
        // list matching the server's JSON.stringify render (slashes not escaped,
        // so the hashes agree) VERBATIM.
        let linksJSON = "[{\"label\":\(jsonStringNoSlashEscape(displayTitle)),\"href\":\(jsonStringNoSlashEscape(url.absoluteString))}]"
        let markdown = renderMarkdown(
            title: displayTitle, slug: slug, kind: "bookmark", status: "draft",
            createdAt: dateText, updatedAt: dateText,
            extraFrontMatter: ["type": "bookmark", "created_at": dateText],
            rawFrontMatterLines: ["links: \(linksJSON)"],
            body: "[\(displayTitle)](\(url.absoluteString))\n")
        let item = try server.createDocument(
            body: markdown, folderId: folder?.id, idempotencyKey: nil)
        return record(from: item, folder: folder, folders: folders)
    }

    public func createFolder(name: String, parentPath: String? = nil) throws -> WorkspaceFolderRecord {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw WorkspaceIntentError.emptyFolderName }
        let server = try requireServer()
        let folders = try server.folders()
        let parent = resolveParentPath(parentPath, folders: folders)
        let created = try server.createFolder(
            parentPath: parent, name: trimmed, idempotencyKey: nil)
        return folderRecord(from: created)
    }

    // MARK: Read / open

    public func openDocument(id: String) throws -> URL {
        // The deep link is keyed by the server post id; the app's URL handler
        // resolves it through the File Provider. No server round-trip needed.
        guard !id.isEmpty,
              let url = URL(string: "write-app://item/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)") else {
            throw WorkspaceIntentError.documentNotFound(id)
        }
        return url
    }

    public func document(id: String) throws -> WorkspaceDocumentRecord {
        guard let match = try allLocated().first(where: { $0.id == id }) else {
            throw WorkspaceIntentError.documentNotFound(id)
        }
        return match
    }

    public func allDocuments() throws -> [WorkspaceDocumentRecord] {
        try allLocated().sorted(by: documentSort)
    }

    public func recentDocuments(limit: Int = 10) throws -> [WorkspaceDocumentRecord] {
        Array(try allDocuments().prefix(max(0, limit)))
    }

    public func bookmarkDocuments(limit: Int = 20) throws -> [WorkspaceDocumentRecord] {
        Array(try allDocuments()
            .filter { $0.kind == "bookmark" || $0.relativePath.hasPrefix("Bookmarks/") }
            .prefix(max(0, limit)))
    }

    public func searchDocuments(query: String, limit: Int = 10) throws -> [WorkspaceDocumentRecord] {
        let server = try requireServer()
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let all = try allLocated(server)
        let matches: [WorkspaceDocumentRecord]
        if normalizedQuery.isEmpty {
            matches = all
        } else {
            matches = all.filter { record in
                if record.title.lowercased().contains(normalizedQuery) { return true }
                // Only fetch the body for documents whose title did not match.
                guard let (text, _) = try? server.fileText(id: record.id) else { return false }
                return ParsedMarkdown(markdown: text).body.lowercased().contains(normalizedQuery)
            }
        }
        return Array(matches.sorted(by: documentSort).prefix(max(0, limit)))
    }

    public func folders() throws -> [WorkspaceFolderRecord] {
        try requireServer().folders()
            .map(folderRecord(from:))
            .sorted { $0.folderPath < $1.folderPath }
    }

    // MARK: Mutate

    @discardableResult
    public func appendText(_ text: String, toDocument id: String) throws -> WorkspaceDocumentRecord {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw WorkspaceIntentError.emptyText
        }
        let server = try requireServer()
        let (existing, hash) = try fileText(id: id, server: server)
        var markdown = existing
        if !markdown.hasSuffix("\n") { markdown += "\n" }
        markdown += text
        if !markdown.hasSuffix("\n") { markdown += "\n" }
        markdown = setFrontMatterValue(key: "updated_at", value: isoString(now()), in: markdown)
        let item = try server.updateDocument(id: id, body: markdown, ifMatch: hash)
        return record(from: item, folder: nil, folders: try server.folders())
    }

    @discardableResult
    public func moveDocument(id: String, toFolder folderPath: String) throws -> WorkspaceDocumentRecord {
        let server = try requireServer()
        let folders = try server.folders()
        let (destination, _) = targetFolder(for: folderPath, folders: folders, defaultMode: "notes")
        guard let destination else { throw WorkspaceIntentError.invalidFolderPath(folderPath) }
        let (_, hash) = try fileText(id: id, server: server)
        let item = try server.moveDocument(id: id, toFolder: destination.id, ifMatch: hash)
        return record(from: item, folder: destination, folders: folders)
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

    private func setPublicationStatus(_ status: String, forDocument id: String) throws -> WorkspaceDocumentRecord {
        let server = try requireServer()
        let (text, hash) = try fileText(id: id, server: server)
        // Notes and bookmarks are unlisted forever; refuse before any byte
        // changes on the server. Derive the kind from the fetched markdown so no
        // extra round-trip is needed.
        let parsed = ParsedMarkdown(markdown: text)
        let kind = (parsed.frontMatter["kind"] ?? parsed.frontMatter["type"] ?? "document").lowercased()
        if status == "published", kind == "note" || kind == "bookmark" {
            throw WorkspaceIntentError.unlistedKind(kind)
        }
        var markdown = setFrontMatterValue(key: "status", value: status, in: text)
        markdown = setFrontMatterValue(key: "updated_at", value: isoString(now()), in: markdown)
        let item = try server.updateDocument(id: id, body: markdown, ifMatch: hash)
        return record(from: item, folder: nil, folders: try server.folders())
    }

    // MARK: Server helpers

    private func fileText(id: String, server: WorkspaceIntentServer) throws -> (text: String, hash: String) {
        do {
            return try server.fileText(id: id)
        } catch let error as WorkspaceIntentServerError {
            if case .notFound = error { throw WorkspaceIntentError.documentNotFound(id) }
            throw error
        }
    }

    private func allLocated(_ injected: WorkspaceIntentServer? = nil) throws -> [WorkspaceDocumentRecord] {
        let server = try injected ?? requireServer()
        let folders = try server.folders()
        var records: [WorkspaceDocumentRecord] = []
        for folder in folders {
            for item in try server.items(inFolder: folder.id) {
                records.append(record(from: item, folder: folder, folders: folders))
            }
        }
        return records
    }

    private func record(
        from item: WorkspaceServerItem,
        folder: WorkspaceServerFolder?,
        folders: [WorkspaceServerFolder]
    ) -> WorkspaceDocumentRecord {
        let owningFolder = folder
            ?? item.folderId.flatMap { fid in folders.first { $0.id == fid } }
            ?? folders.first { $0.mode == modeForKind(item.kind) }
        let folderPath = owningFolder?.path ?? item.folderPath ?? ""
        let relativePath = folderPath.isEmpty
            ? "\(item.slug).md"
            : "\(displayFolderPath(owningFolder, fallback: folderPath))/\(item.slug).md"
        return WorkspaceDocumentRecord(
            id: item.id,
            title: item.title,
            kind: item.kind,
            folderPath: folderPath,
            relativePath: relativePath,
            modifiedDate: item.modifiedDate,
            status: item.status,
            publishedURL: item.canonicalURL
        )
    }

    /// A capitalized, mirror-style folder label so downstream `hasPrefix`
    /// checks (e.g. bookmarks) keep working even though the server folder path
    /// is lowercase. Bookmarks map to "Bookmarks/{year}".
    private func displayFolderPath(_ folder: WorkspaceServerFolder?, fallback: String) -> String {
        switch folder?.mode {
        case "bookmarks":
            let year = Calendar(identifier: .gregorian).component(.year, from: now())
            return "Bookmarks/\(year)"
        case "notes":
            return "Notes"
        case "blog":
            return folder?.path == "blog" ? "Blogs" : (folder?.name ?? "Blogs")
        default:
            return fallback
        }
    }

    private func folderRecord(from folder: WorkspaceServerFolder) -> WorkspaceFolderRecord {
        WorkspaceFolderRecord(
            id: folder.id,
            title: folder.name,
            kind: folder.mode == "blog" ? "blog" : "folder",
            folderPath: folder.path,
            modifiedDate: nil
        )
    }

    private func targetFolder(
        for folderPath: String?, folders: [WorkspaceServerFolder], defaultMode: String
    ) -> (WorkspaceServerFolder?, String) {
        let raw = folderPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Prefer an exact server path match (so "notes"/"blog" resolve directly);
        // otherwise map the leading component to a system mode.
        if !raw.isEmpty, let exact = folders.first(where: { $0.path.lowercased() == raw.lowercased() }) {
            return (exact, kindForMode(exact.mode))
        }
        let mode = modeForFolderPath(raw, defaultMode: defaultMode)
        let folder = folders.first { $0.mode == mode }
        return (folder, kindForMode(mode))
    }

    private func resolveParentPath(_ raw: String?, folders: [WorkspaceServerFolder]) -> String {
        let path = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if path.isEmpty { return folders.first { $0.mode == "notes" }?.path ?? "notes" }
        if let exact = folders.first(where: { $0.path.lowercased() == path.lowercased() }) {
            return exact.path
        }
        let mode = modeForFolderPath(path, defaultMode: "notes")
        return folders.first { $0.mode == mode }?.path ?? path.lowercased()
    }

    private func modeForFolderPath(_ path: String, defaultMode: String) -> String {
        let first = path.split(separator: "/", omittingEmptySubsequences: true)
            .first.map(String.init)?.lowercased() ?? ""
        switch first {
        case "notes": return "notes"
        case "bookmarks": return "bookmarks"
        case "blogs", "blog", "drafts": return "blog"
        default: return defaultMode
        }
    }

    private func kindForMode(_ mode: String) -> String {
        switch mode {
        case "notes": return "note"
        case "bookmarks": return "bookmark"
        default: return "article"
        }
    }

    private func modeForKind(_ kind: String) -> String {
        switch kind.lowercased() {
        case "note": return "notes"
        case "bookmark": return "bookmarks"
        default: return "blog"
        }
    }

    private func documentSort(_ lhs: WorkspaceDocumentRecord, _ rhs: WorkspaceDocumentRecord) -> Bool {
        let left = lhs.modifiedDate ?? .distantPast
        let right = rhs.modifiedDate ?? .distantPast
        if left != right { return left > right }
        return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
    }

    // MARK: Markdown formatting (pure helpers)

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

struct ParsedMarkdown {
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
