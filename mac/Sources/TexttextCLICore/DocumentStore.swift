import Foundation
import WriteFileProviderKit

public enum TexttextCLIError: Error, CustomStringConvertible, Equatable {
    case workspaceNotFound
    case documentNotFound(String)
    case ambiguous(String, [String])
    case sectionNotFound(String, available: [String])
    case invalidDocument(String)

    public var description: String {
        switch self {
        case .workspaceNotFound:
            return """
                No Texttext workspace found. Open Texttext and sign in, then try \
                again.
                """
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

    /// The File Provider mount. `WRITE_WORKSPACE_ROOT` overrides it, which is
    /// what the tests use.
    public static func locate(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> DocumentStore {
        if let override = environment["WRITE_WORKSPACE_ROOT"], !override.isEmpty {
            return DocumentStore(root: URL(fileURLWithPath: override))
        }
        let cloud = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/CloudStorage", isDirectory: true)
        let candidates = (try? fileManager.contentsOfDirectory(
            at: cloud, includingPropertiesForKeys: nil)) ?? []
        // The domain is named for the app, historically "Write-Write".
        for candidate in candidates.sorted(by: { $0.path < $1.path })
        where candidate.lastPathComponent.hasPrefix("Write-")
            || candidate.lastPathComponent.hasPrefix("Texttext-")
        {
            return DocumentStore(root: candidate)
        }
        throw TexttextCLIError.workspaceNotFound
    }

    // MARK: - Addressing

    /// Documents are addressed by workspace-relative path, because agents are
    /// good at paths and bad at identifiers. A bare name is accepted when it
    /// matches exactly one document.
    public func resolve(_ name: String) throws -> URL {
        let fileManager = FileManager.default
        let direct = root.appendingPathComponent(name)
        if fileManager.fileExists(atPath: direct.path) { return direct }
        for suffix in [".textpack", ".md"] where !name.hasSuffix(suffix) {
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
        case 0: throw TexttextCLIError.documentNotFound(name)
        case 1: return root.appendingPathComponent(matches[0])
        default: throw TexttextCLIError.ambiguous(name, matches)
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
            let entries = (try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles])) ?? []
            for entry in entries.sorted(by: { $0.path < $1.path }) {
                let isDirectory = (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?
                    .isDirectory ?? false
                let ext = entry.pathExtension.lowercased()
                if ext == "textpack" || ext == "md" {
                    found.append(relativePath(of: entry))
                } else if isDirectory, ext != "textbundle" {
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

    // MARK: - Read

    public func readMarkdown(at url: URL) throws -> String {
        if url.pathExtension.lowercased() == "md" {
            let data = try Data(contentsOf: url)
            guard let text = String(data: data, encoding: .utf8) else {
                throw TexttextCLIError.invalidDocument("\(url.lastPathComponent) is not UTF-8")
            }
            return text
        }
        let temporary = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: temporary) }
        let contents = try WriteTextBundlePackage.read(from: url, in: temporary)
        return contents.markdown
    }

    /// The document's own id, carried in frontmatter as `writeId` (injected
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
            guard key == "writeId" else { continue }
            var value = line[line.index(after: colon)...]
                .trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("\"") && value.hasSuffix("\"") && value.count >= 2 {
                value = String(value.dropFirst().dropLast())
            }
            return value.isEmpty ? nil : value
        }
        return nil
    }

    // MARK: - Write

    /// Replace a document's markdown, preserving everything else in the package
    /// (assets, document.json, info.json metadata) and swapping the result in
    /// atomically.
    public func writeMarkdown(_ markdown: String, to url: URL) throws {
        if url.pathExtension.lowercased() == "md" {
            try atomicallyReplace(url, with: Data(markdown.utf8))
            return
        }

        let temporary = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: temporary) }

        let existing = try WriteTextBundlePackage.read(from: url, in: temporary)
        // Carry every asset through untouched. `materialize` rewrites remote
        // URLs to local references, so feed back the remote URL it recorded.
        let assets = existing.assets.map { asset in
            WriteTextBundlePackage.MaterializedAsset(
                filename: asset.filename,
                data: asset.data,
                remoteURL: asset.remoteURL ?? "assets/\(asset.filename)",
                contentType: asset.contentType)
        }
        let package = try WriteTextBundlePackage.materialize(
            canonicalMarkdown: markdown,
            documentJSON: existing.documentJSON,
            assets: assets,
            sourceURL: nil,
            in: temporary)
        let packed = try WriteTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: temporary)
        try atomicallyReplace(url, with: try Data(contentsOf: packed))
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

    private func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-cli-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
