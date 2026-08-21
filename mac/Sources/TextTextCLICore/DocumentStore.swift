import Foundation
import TextTextFileProviderKit

public enum TextTextCLIError: Error, CustomStringConvertible, Equatable {
    case workspaceNotFound
    case workspaceUnavailable(String)
    case folderNotFound(String)
    case documentNotFound(String)
    case ambiguous(String, [String])
    case sectionNotFound(String, available: [String])
    case invalidDocument(String)
    case documentChanged(String)

    public var description: String {
        switch self {
        case .workspaceNotFound:
            return """
                No TextText workspace found. Open TextText and sign in, then try \
                again.
                """
        case .workspaceUnavailable(let reason):
            return """
                The TextText workspace is unavailable: \(reason)
                Open TextText, confirm you are signed in, then try again.
                """
        case .folderNotFound(let name):
            return "No folder matching \(name)."
        case .documentNotFound(let name):
            return "No document matching \(name)."
        case .ambiguous(let name, let matches):
            let list = matches.prefix(5).joined(separator: "\n  ")
            return "\(name) matches several documents:\n  \(list)"
        case .sectionNotFound(let name, let available):
            if available.isEmpty {
                return "No section \(name). This document has no headings."
            }
            let list = available.prefix(10).joined(separator: "\n  ")
            return "No section \(name). Available:\n  \(list)"
        case .invalidDocument(let reason):
            return "Invalid document: \(reason)"
        case .documentChanged(let name):
            return "\(name) changed while this command was running. Read it again, then retry."
        }
    }
}

/// Locates the workspace and reads and writes documents in it.
///
/// Every write is atomic: the replacement is built in full in a temporary
/// directory, then swapped in with a single rename. A crash mid-write leaves the
/// previous document intact, and the File Provider sees one complete
/// replacement rather than a partial file.
public struct DocumentStore: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// The File Provider mount. `TEXTTEXT_WORKSPACE_ROOT` overrides it, which is
    /// what the tests use.
    public static func locate(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> DocumentStore {
        if let override = environment["TEXTTEXT_WORKSPACE_ROOT"], !override.isEmpty {
            return DocumentStore(root: URL(fileURLWithPath: override))
        }
        let cloud = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/CloudStorage", isDirectory: true)
        let candidates =
            (try? fileManager.contentsOfDirectory(
                at: cloud, includingPropertiesForKeys: nil)) ?? []
        // The domain is named for the app, historically "TextText-TextText".
        for candidate in candidates.sorted(by: { $0.path < $1.path })
        where candidate.lastPathComponent.hasPrefix("TextText-") {
            return DocumentStore(root: candidate)
        }
        throw TextTextCLIError.workspaceNotFound
    }

    // MARK: - Addressing

    /// Documents are addressed by workspace-relative path, because agents are
    /// good at paths and bad at identifiers. A bare name is accepted when it
    /// matches exactly one document.
    public func resolve(_ name: String) throws -> URL {
        let fileManager = FileManager.default
        if name.hasPrefix("/") {
            let absolute = URL(fileURLWithPath: name)
            guard contains(absolute) else {
                throw TextTextCLIError.invalidDocument(
                    "the document is outside TEXTTEXT_WORKSPACE_ROOT")
            }
            if fileManager.fileExists(atPath: absolute.path) { return absolute }
            throw TextTextCLIError.documentNotFound(name)
        }
        let direct = root.appendingPathComponent(name)
        guard contains(direct) else {
            throw TextTextCLIError.invalidDocument(
                "the document is outside TEXTTEXT_WORKSPACE_ROOT")
        }
        if fileManager.fileExists(atPath: direct.path) { return direct }
        for suffix in [".textpack", ".textbundle", ".md", ".txt"]
        where !name.hasSuffix(suffix) {
            let candidate = root.appendingPathComponent(name + suffix)
            if fileManager.fileExists(atPath: candidate.path) { return candidate }
        }

        let needle = (name as NSString).deletingPathExtension.lowercased()
        let matches = try list().filter { relative in
            let base = ((relative as NSString).lastPathComponent as NSString)
                .deletingPathExtension
                .lowercased()
            return base == needle
        }
        switch matches.count {
        case 0: throw TextTextCLIError.documentNotFound(name)
        case 1: return root.appendingPathComponent(matches[0])
        default: throw TextTextCLIError.ambiguous(name, matches)
        }
    }

    /// Workspace-relative paths of every document, depth-first and sorted.
    /// Bounded so a huge or stalled mount cannot hang the caller.
    public func list(under folder: String? = nil, limit: Int = 5_000) throws -> [String] {
        let fileManager = FileManager.default
        let base = folder.map { root.appendingPathComponent($0) } ?? root
        var found: [String] = []
        var queue = [base]

        while let directory = queue.first, found.count < limit {
            queue.removeFirst()
            let entries: [URL]
            do {
                entries = try fileManager.contentsOfDirectory(
                    at: directory,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles])
            } catch {
                throw TextTextCLIError.workspaceUnavailable(error.localizedDescription)
            }
            for entry in entries.sorted(by: { $0.path < $1.path }) {
                let isDirectory =
                    (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?
                    .isDirectory ?? false
                let ext = entry.pathExtension.lowercased()
                let relative = relativePath(of: entry)
                // Data contains TextText-owned attachment copies, not documents.
                // It is visible in Finder for export and backup, but agents must
                // not mistake one of its files for an editable workspace item.
                if relative == "Data" || relative.hasPrefix("Data/") {
                    continue
                }
                if ["textpack", "textbundle", "md", "txt"].contains(ext) {
                    found.append(relativePath(of: entry))
                } else if isDirectory {
                    queue.append(entry)
                }
            }
        }
        return found
    }

    public func relativePath(of url: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(rootPath) else { return path }
        return String(path.dropFirst(rootPath.count).drop { $0 == "/" })
    }

    private func contains(_ candidate: URL) -> Bool {
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
        let candidatePath = candidate.standardizedFileURL
            .resolvingSymlinksInPath().path
        return candidatePath == rootPath || candidatePath.hasPrefix(rootPath + "/")
    }

    // MARK: - Read

    public func readMarkdown(at url: URL) throws -> String {
        if ["md", "txt"].contains(url.pathExtension.lowercased()) {
            let data = try Data(contentsOf: url)
            guard let text = String(data: data, encoding: .utf8) else {
                throw TextTextCLIError.invalidDocument("\(url.lastPathComponent) is not UTF-8")
            }
            return text
        }
        let temporary = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: temporary) }
        let contents = try TextTextTextBundlePackage.read(from: url, in: temporary)
        return contents.markdown
    }

    /// The document's own id, carried in frontmatter as `textTextId` (injected
    /// locally by the sync client, stripped before upload). Presence uses it so
    /// the server addresses the exact item without resolving a file path.
    public func itemId(at url: URL) -> String? {
        guard let markdown = try? readMarkdown(at: url) else { return nil }
        guard markdown.hasPrefix("---") else { return nil }
        let lines = markdown.components(separatedBy: "\n")
        for line in lines.dropFirst() {
            if line.trimmingCharacters(in: .whitespaces) == "---" { break }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces)
            guard key == "textTextId" else { continue }
            var value = line[line.index(after: colon)...]
                .trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("\"") && value.hasSuffix("\"") && value.count >= 2 {
                value = String(value.dropFirst().dropLast())
            }
            return value.isEmpty ? nil : value
        }
        return nil
    }

    // MARK: - TextText

    /// Replace a document's markdown, preserving everything else in the package
    /// (assets, document.json, info.json metadata) and swapping the result in
    /// atomically.
    public func writeMarkdown(_ markdown: String, to url: URL) throws {
        if ["md", "txt"].contains(url.pathExtension.lowercased()) {
            try atomicallyReplace(url, with: Data(markdown.utf8))
            return
        }

        let temporary = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: temporary) }

        let existing = try TextTextTextBundlePackage.read(from: url, in: temporary)
        // Carry every asset through untouched. `materialize` rewrites remote
        // URLs to local references, so feed back the remote URL it recorded.
        let assets = existing.assets.map { asset in
            TextTextTextBundlePackage.MaterializedAsset(
                filename: asset.filename,
                data: asset.data,
                remoteURL: asset.remoteURL ?? "assets/\(asset.filename)",
                contentType: asset.contentType)
        }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: markdown,
            documentJSON: existing.documentJSON,
            assets: assets,
            sourceURL: nil,
            in: temporary)
        if url.pathExtension.lowercased() == "textbundle" {
            try atomicallyReplaceDirectory(url, with: package.url)
            return
        }
        let packed = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: temporary)
        try atomicallyReplace(url, with: try Data(contentsOf: packed))
    }

    /// Create a document. Writes only the frontmatter the sync layer needs and
    /// lets the server own identity, slug, and canonical URL, which it assigns
    /// when it ingests the file.
    @discardableResult
    public func create(
        title: String, body: String = "", folder: String? = nil, kind: String = "note",
        sourceURL: String? = nil
    ) throws -> URL {
        let fileManager = FileManager.default
        var destination = root
        if let folder, !folder.isEmpty {
            destination = destination.appendingPathComponent(folder, isDirectory: true)
            guard fileManager.fileExists(atPath: destination.path) else {
                throw TextTextCLIError.documentNotFound(folder)
            }
        }
        let name = DocumentCreation.filename(for: title)
        let url = destination.appendingPathComponent("\(name).textpack")
        guard !fileManager.fileExists(atPath: url.path) else {
            throw TextTextCLIError.invalidDocument(
                "\(name) already exists. Edit it, or choose another title.")
        }

        let markdown =
            DocumentCreation.frontmatter(
                title: title, kind: kind, sourceURL: sourceURL)
            + (body.isEmpty ? "" : body.trimmingCharacters(in: .newlines) + "\n")

        let temporary = try makeTemporaryDirectory()
        defer { try? fileManager.removeItem(at: temporary) }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: markdown, documentJSON: nil,
            assets: [], sourceURL: sourceURL, in: temporary)
        let packed = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: temporary)
        try atomicallyReplace(url, with: try Data(contentsOf: packed))
        return url
    }

    /// Build the replacement beside the target, then swap it in with one
    /// rename. `replaceItemAt` performs the exchange atomically on the same
    /// volume, so a reader sees either the old file or the new one.
    private func atomicallyReplace(_ url: URL, with data: Data) throws {
        let fileManager = FileManager.default
        let staging = url.deletingLastPathComponent()
            .appendingPathComponent(".texttext-\(UUID().uuidString).tmp")
        try data.write(to: staging, options: [.atomic])
        defer { try? fileManager.removeItem(at: staging) }
        _ = try fileManager.replaceItemAt(url, withItemAt: staging)
    }

    /// A `.textbundle` is a directory package, not a zip with a different
    /// suffix. Copy the replacement beside the target so the final exchange is
    /// on one volume and preserves the representation expected by File Provider.
    private func atomicallyReplaceDirectory(_ url: URL, with directory: URL) throws {
        let fileManager = FileManager.default
        let staging = url.deletingLastPathComponent()
            .appendingPathComponent(".texttext-\(UUID().uuidString).tmp", isDirectory: true)
        try fileManager.copyItem(at: directory, to: staging)
        defer { try? fileManager.removeItem(at: staging) }
        _ = try fileManager.replaceItemAt(url, withItemAt: staging)
    }

    private func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-cli-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
