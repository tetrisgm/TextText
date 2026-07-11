import Foundation
import WriteShareCore
import WriteWorkspaceCore

enum InboxFilerError: LocalizedError, Equatable {
    case missingURL
    case invalidURL(String)
    case missingAppendTarget
    case documentNotFound(String)
    case invalidMarkdown(String)
    case missingPayload

    var errorDescription: String? {
        switch self {
        case .missingURL:
            return "The shared item did not include a URL"
        case .invalidURL(let value):
            return "The shared URL is invalid: \(value)"
        case .missingAppendTarget:
            return "Append requires a target Write document id"
        case .documentNotFound(let id):
            return "No Write document found for \(id)"
        case .invalidMarkdown(let path):
            return "\(path) is not valid UTF-8 markdown"
        case .missingPayload:
            return "The shared item did not include file data"
        }
    }
}

final class InboxFiler {
    let root: URL
    private let coordinator: WorkspaceFileCoordinator
    private let now: () -> Date

    init(root: URL, now: @escaping () -> Date = { Date() }) {
        self.root = root
        self.coordinator = WorkspaceFileCoordinator(rootURL: root)
        self.now = now
    }

    @discardableResult
    func file(_ record: InboxRecord) throws -> URL {
        try file(record.item, payloadURL: record.payloadURL)
    }

    @discardableResult
    func file(_ item: InboxItem, payloadURL: URL? = nil) throws -> URL {
        try ensureWorkspaceDirectories()
        switch item.kind {
        case .note:
            return try createMarkdownFile(
                title: derivedTitle(for: item, fallback: "Untitled Note"),
                body: normalizedBody(item.text),
                directory: "Notes",
                kind: "note",
                folderId: "notes",
                extraFrontMatter: [:]
            )
        case .bookmark:
            return try createBookmark(item)
        case .draft:
            return try createMarkdownFile(
                title: derivedTitle(for: item, fallback: "Untitled Draft"),
                body: normalizedBody(item.text),
                directory: "Drafts",
                kind: "article",
                folderId: nil,
                extraFrontMatter: [:]
            )
        case .append:
            return try append(item)
        case .file:
            return try savePayload(item, payloadURL: payloadURL)
        }
    }

    private func ensureWorkspaceDirectories() throws {
        for relative in ["Notes", "Bookmarks", "Drafts", "Media", ".write"] {
            try FileManager.default.createDirectory(
                at: root.appendingPathComponent(relative, isDirectory: true),
                withIntermediateDirectories: true
            )
        }
    }

    private func createBookmark(_ item: InboxItem) throws -> URL {
        guard let rawURL = item.urlString?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawURL.isEmpty else {
            throw InboxFilerError.missingURL
        }
        guard URL(string: rawURL) != nil else {
            throw InboxFilerError.invalidURL(rawURL)
        }
        let date = now()
        let year = Calendar(identifier: .gregorian).component(.year, from: date)
        let dateText = isoString(date)
        let title = derivedTitle(for: item, fallback: URL(string: rawURL)?.host ?? rawURL)
        // The server keeps a bookmark's URL only in the `links:` list; a bare
        // `url:` scalar is an unknown key it silently drops, which would sync
        // the bookmark with no link. Emit the links list the server round-trips
        // (flow JSON, matching its own JSON.stringify render, which does not
        // escape forward slashes so the hashes agree).
        let linksJSON = "[{\"label\":\(jsonStringNoSlashEscape(title)),\"href\":\(jsonStringNoSlashEscape(rawURL))}]"
        return try createMarkdownFile(
            title: title,
            body: normalizedBody(item.text),
            directory: "Bookmarks/\(year)",
            kind: "bookmark",
            folderId: "bookmarks",
            extraFrontMatter: [
                "type": "bookmark",
                "created_at": dateText,
            ],
            rawFrontMatterLines: ["links: \(linksJSON)"]
        )
    }

    private func createMarkdownFile(
        title: String,
        body: String,
        directory: String,
        kind: String,
        folderId: String?,
        extraFrontMatter: [String: String],
        rawFrontMatterLines: [String] = []
    ) throws -> URL {
        let slug = slugForTitle(title)
        let target = uniqueMarkdownURL(directory: directory, slug: slug)
        let date = isoString(now())
        let markdown = MarkdownIdentityCodec.inject(
            into: renderMarkdown(
                title: title,
                slug: target.deletingPathExtension().lastPathComponent,
                kind: kind,
                status: "draft",
                createdAt: date,
                updatedAt: date,
                extraFrontMatter: extraFrontMatter,
                rawFrontMatterLines: rawFrontMatterLines,
                body: body
            ),
            itemId: UUID().uuidString,
            folderId: folderId,
            kind: kind
        )
        try coordinator.writeData(Data(markdown.utf8), to: target)
        try saveWorkspaceIndexEntry(for: target, markdown: markdown)
        return target
    }

    private func append(_ item: InboxItem) throws -> URL {
        guard let targetWriteId = item.targetWriteId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !targetWriteId.isEmpty else {
            throw InboxFilerError.missingAppendTarget
        }
        var index = loadWorkspaceIndex()
        guard let entry = index.entries[targetWriteId] else {
            throw InboxFilerError.documentNotFound(targetWriteId)
        }
        let target = root.appendingPathComponent(entry.relativePath, isDirectory: false)
        let data = try coordinator.readData(at: target)
        guard var markdown = String(data: data, encoding: .utf8) else {
            throw InboxFilerError.invalidMarkdown(entry.relativePath)
        }
        let text = normalizedBody(item.text)
        if !markdown.hasSuffix("\n") { markdown += "\n" }
        markdown += text
        if !markdown.hasSuffix("\n") { markdown += "\n" }
        markdown = setFrontMatterValue(key: "updated_at", value: isoString(now()), in: markdown)
        try coordinator.writeData(Data(markdown.utf8), to: target)

        entryFor(target: target, markdown: markdown).map { index.entries[targetWriteId] = $0 }
        try WorkspaceIndexStore.save(index, root: root)
        return target
    }

    private func savePayload(_ item: InboxItem, payloadURL: URL?) throws -> URL {
        guard let payloadURL else { throw InboxFilerError.missingPayload }
        let filename = try InboxWriter.sanitizedPayloadFilename(
            item.payloadFilename ?? payloadURL.lastPathComponent
        )
        let media = root.appendingPathComponent("Media", isDirectory: true)
        try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        let target = uniqueFileURL(directory: media, filename: filename)
        let data = try Data(contentsOf: payloadURL)
        try coordinator.writeData(data, to: target)
        return target
    }

    private func loadWorkspaceIndex() -> SyncIndex {
        if let loaded = WorkspaceIndexStore.load(root: root), !loaded.entries.isEmpty {
            return loaded
        }
        return WorkspaceIndexStore.rebuild(
            root: root,
            includeSkippedDirectories: true,
            readData: { [coordinator] url in try coordinator.readData(at: url) }
        )
    }

    private func saveWorkspaceIndexEntry(for url: URL, markdown: String) throws {
        guard let identity = MarkdownIdentityCodec.extract(from: markdown),
              let entry = entryFor(target: url, markdown: markdown) else { return }
        var index = WorkspaceIndexStore.load(root: root) ?? SyncIndex()
        index.entries[identity.itemId] = entry
        try WorkspaceIndexStore.save(index, root: root)
    }

    private func entryFor(target url: URL, markdown: String) -> IndexEntry? {
        guard let relativePath = WorkspaceLayout.relativePath(for: url, under: root) else {
            return nil
        }
        let identity = MarkdownIdentityCodec.extract(from: markdown)
        return IndexEntry(
            hash: MarkdownIdentityCodec.syncHash(for: Data(markdown.utf8)),
            relativePath: relativePath,
            fileMtime: fileMtime(url),
            folderId: identity?.folderId,
            kind: identity?.kind
        )
    }

    private func uniqueMarkdownURL(directory: String, slug: String) -> URL {
        let directoryURL = root.appendingPathComponent(directory, isDirectory: true)
        return uniqueFileURL(directory: directoryURL, filename: "\(slug).md")
    }

    private func uniqueFileURL(directory: URL, filename: String) -> URL {
        let base = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension
        var candidate = directory.appendingPathComponent(filename, isDirectory: false)
        var counter = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let nextName = ext.isEmpty ? "\(base)-\(counter)" : "\(base)-\(counter).\(ext)"
            candidate = directory.appendingPathComponent(nextName, isDirectory: false)
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

    private func normalizedBody(_ raw: String?) -> String {
        let body = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return body.isEmpty ? "" : body + "\n"
    }

    private func derivedTitle(for item: InboxItem, fallback: String) -> String {
        if let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }
        if let filename = item.payloadFilename?.trimmingCharacters(in: .whitespacesAndNewlines), !filename.isEmpty {
            return (filename as NSString).deletingPathExtension
        }
        if let rawURL = item.urlString, let url = URL(string: rawURL) {
            return url.host ?? rawURL
        }
        return fallback
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
        let cleaned = output.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return cleaned.isEmpty ? "untitled" : String(cleaned.prefix(80))
    }

    private func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
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

    private func fileMtime(_ url: URL) -> Double? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970
    }
}
