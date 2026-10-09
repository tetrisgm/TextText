import Foundation
import Darwin
import TextTextWorkspaceCore
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
                No TextText workspace found. Select a folder with texttext vault <path>.
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
/// previous document intact, and file observers see one complete replacement.
public struct DocumentStore: Sendable {
    public let root: URL
    let accountCommands: LocalWorkspaceCommands?

    public init(root: URL) {
        self.root = root
        self.accountCommands = nil
    }

    init(root: URL, accountCommands: LocalWorkspaceCommands) {
        self.root = root
        self.accountCommands = accountCommands
    }

    /// Open the explicitly selected vault without contacting a server.
    public static func locate(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> DocumentStore {
        if let override = environment["TEXTTEXT_WORKSPACE_ROOT"], !override.isEmpty {
            return DocumentStore(root: URL(fileURLWithPath: override))
        }
        if let configuration = try LocalVaultConfiguration.load(
            environment: environment, fileManager: fileManager,
            allowUnscopedRootFallback: true) {
            return DocumentStore(root: try configuration.resolvingRoot())
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
            if contains(candidate), fileManager.fileExists(atPath: candidate.path) { return candidate }
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
        guard contains(base) else {
            throw TextTextCLIError.invalidDocument("the folder is outside the workspace")
        }
        var found: [String] = []
        var queue = [base]
        var visited = Set<String>()

        while let directory = queue.first, found.count < limit {
            queue.removeFirst()
            guard visited.insert(directory.resolvingSymlinksInPath().path).inserted else { continue }
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
                guard contains(entry) else { continue }
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
                    guard found.count < limit else { break }
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
        guard path == rootPath || path.hasPrefix(rootPath + "/") else { return path }
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

    /// Stable identity lives in the file and survives a folder move or rename.
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
    public func writeMarkdown(_ markdown: String, to url: URL, ifMatchHash: String? = nil) throws {
        if url.pathExtension.lowercased() == "textpack" {
            let vault = LocalVaultDocumentStore(root: root)
            let path = relativePath(of: url)
            let current = try vault.read(path: path)
            let before = current.contents
            let identity = MarkdownIdentityCodec.extract(from: before.markdown)
            let preserved = identity.map {
                MarkdownIdentityCodec.inject(into: markdown, itemId: $0.itemId,
                                             folderId: $0.folderId, kind: $0.kind)
            } ?? markdown
            do {
                _ = try vault.write(path: path, expectedHash: ifMatchHash ?? current.hash,
                                    markdown: preserved, documentJSON: before.documentJSON,
                                    templateJSON: before.templateJSON,
                                    templateAuthoringSourceJSON: before.templateAuthoringSourceJSON)
            } catch LocalVaultDocumentStore.Failure.changed {
                throw TextTextCLIError.documentChanged(url.lastPathComponent)
            }
            return
        }
        if ifMatchHash != nil {
            throw TextTextCLIError.invalidDocument("version checks require a TextPack")
        }
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
        let identity = MarkdownIdentityCodec.extract(from: existing.markdown)
        let preservedMarkdown = identity.map {
            MarkdownIdentityCodec.inject(into: markdown, itemId: $0.itemId,
                                         folderId: $0.folderId, kind: $0.kind)
        } ?? markdown
        // `read` canonicalizes document.json; a Markdown-only write must keep
        // the exact bytes on disk so the carried projection stamp still
        // attributes the change to text.md alone.
        let rawDocumentJSON: String? = url.pathExtension.lowercased() == "textbundle"
            ? (try? Data(contentsOf: url.appendingPathComponent("document.json"))).flatMap { String(data: $0, encoding: .utf8) }
            : nil
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: preservedMarkdown,
            documentJSON: rawDocumentJSON ?? existing.documentJSON,
            // Carried, not regenerated. Editing the prose must not silently
            // strip the look off the file, which is what dropping this here
            // would have done on every single write.
            templateJSON: existing.templateJSON,
            templateAuthoringSourceJSON: existing.templateAuthoringSourceJSON,
            // A Markdown-only write keeps the earlier projection stamp so the
            // app can tell text.md moved and document.json did not.
            carriedProjectionJSON: existing.projectionJSON,
            assets: assets,
            sourceURL: existing.sourceURL,
            in: temporary)
        if url.pathExtension.lowercased() == "textbundle" {
            try atomicallyReplaceDirectory(url, with: package.url)
            return
        }
        let packed = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: temporary)
        try atomicallyReplace(url, with: try Data(contentsOf: packed))
    }

    /// Create a self-identifying document offline. Moving or renaming the pack
    /// keeps its identity because the ID is stored inside the file.
    @discardableResult
    public func create(
        title: String, body: String? = nil, folder: String? = nil, kind: String? = nil,
        sourceURL: String? = nil
    ) throws -> URL {
        try prepareCreation(title: title, body: body, folder: folder, kind: kind,
                            sourceURL: sourceURL, itemId: UUID().uuidString.lowercased())
    }

    /// Prepare a complete package at an unpublished location when a durable
    /// creation transaction supplies one. Folder defaults still come from the
    /// real destination, never the journal directory.
    func prepareCreation(
        title: String, body: String? = nil, folder: String? = nil, kind: String? = nil,
        sourceURL: String? = nil, itemId: String, preparedOutput: URL? = nil,
        customDocumentJSON: String? = nil, customTemplateJSON: String? = nil,
        assets: [TextTextTextBundlePackage.MaterializedAsset] = []
    ) throws -> URL {
        let fileManager = FileManager.default
        var destination = root
        if let folder, !folder.isEmpty {
            destination = destination.appendingPathComponent(folder, isDirectory: true)
            guard contains(destination) else {
                throw TextTextCLIError.invalidDocument("the folder is outside the workspace")
            }
            guard fileManager.fileExists(atPath: destination.path) else {
                throw TextTextCLIError.documentNotFound(folder)
            }
        }
        guard (customDocumentJSON == nil) == (customTemplateJSON == nil) else {
            throw TextTextCLIError.invalidDocument("custom creation requires matching snapshot and template metadata")
        }
        guard assets.isEmpty || customDocumentJSON == nil else {
            throw TextTextCLIError.invalidDocument("custom creation does not import attachments")
        }
        guard assets.count <= 2_000,
              assets.reduce(UInt64(0), { $0 + UInt64($1.data.count) }) <= 64 * 1_024 * 1_024,
              assets.allSatisfy({ TextTextTextBundlePackage.isSafeAssetFilename($0.filename) &&
                  $0.remoteURL == "assets/\($0.filename)" && ($0.contentType?.utf8.count ?? 0) <= 200 &&
                  ($0.title?.utf16.count ?? 0) <= 240 }) else {
            throw TextTextCLIError.invalidDocument("invalid or oversized creation attachments")
        }
        let folderDefault = kind == nil && customDocumentJSON == nil ? try LocalVaultFolderDefault.read(root: root, folder: destination) : nil
        let effectiveKind = kind ?? "note"
        // Gallery names the presentation template; the shared file schema calls
        // this content type media_post. Never write a template name as a kind.
        let contentKind = effectiveKind == "gallery" ? "media_post" : effectiveKind
        let body = body ?? folderDefault?.body ?? ""
        if let customDocumentJSON {
            try BuiltinTextPackDocument.validateMetadata(snapshot: customDocumentJSON, template: customTemplateJSON)
            let snapshot = try JSONSerialization.jsonObject(with: Data(customDocumentJSON.utf8)) as! [String: Any]
            let content = snapshot["content"] as! [String: Any]
            guard content["title"] as? String == title, content["body"] as? String == body,
                  (content["assets"] as? [[String: Any]])?.isEmpty == true else {
                throw TextTextCLIError.invalidDocument("custom creation must match title/body and contain no unimported assets")
            }
        }
        let name = DocumentCreation.filename(for: title)
        let url = destination.appendingPathComponent("\(name).textpack")
        guard !fileManager.fileExists(atPath: url.path) else {
            throw TextTextCLIError.invalidDocument(
                "\(name) already exists. Edit it, or choose another title.")
        }

        let markdown = MarkdownIdentityCodec.inject(
            into: DocumentCreation.frontmatter(
                title: title, kind: contentKind, sourceURL: sourceURL)
            + (body.isEmpty ? "" : body.trimmingCharacters(in: .newlines) + "\n"),
            itemId: itemId, folderId: nil, kind: contentKind)

        let temporary = try makeTemporaryDirectory()
        defer { try? fileManager.removeItem(at: temporary) }
        // The snapshot body is the Markdown body byte for byte (including the
        // newline that closes a non-empty body), so both representations
        // express one document and the pack can be stamped as coherent.
        let builtin = try BuiltinTextPackDocument.create(
            title: title, body: body.isEmpty ? "" : body.trimmingCharacters(in: .newlines) + "\n",
            kind: effectiveKind, sourceURL: sourceURL, assets: assets)
        var documentJSON = builtin.documentJSON
        if let folderDefault {
            var document = try JSONSerialization.jsonObject(with: Data(documentJSON.utf8)) as! [String: Any]
            var content = document["content"] as! [String: Any]
            content["fields"] = folderDefault.fields
            document["content"] = content
            document["presentation"] = ["template": ["id": folderDefault.templateId, "version": folderDefault.templateVersion], "theme": [:]] as [String: Any]
            documentJSON = String(decoding: try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys]), as: UTF8.self)
        }
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: markdown, documentJSON: customDocumentJSON ?? documentJSON,
            templateJSON: customTemplateJSON ?? folderDefault?.templateJSON ?? builtin.templateJSON,
            templateAuthoringSourceJSON: folderDefault?.authoringSourceJSON,
            // A fresh pack is one document in both representations; the stamp is
            // computed from the bytes written and refused if they disagree
            // (a custom document.json, a bookmark's links line).
            projectionJSON: "",
            assets: assets, sourceURL: sourceURL, in: temporary)
        let packed = try TextTextTextBundlePackage.zipToTextPack(
            packageURL: package.url, in: temporary)
        // moveItem fails if another writer created this name while we built it.
        let staging = destination.appendingPathComponent(".texttext-\(UUID().uuidString).tmp")
        try fileManager.copyItem(at: packed, to: staging)
        defer { try? fileManager.removeItem(at: staging) }
        // Flush the complete package before publishing it. A create-only rename
        // and file coordination give file observers one complete TextPack.
        let handle = try FileHandle(forWritingTo: staging)
        try handle.synchronize(); try handle.close()
        if let preparedOutput {
            guard contains(preparedOutput), preparedOutput != url else {
                throw TextTextCLIError.invalidDocument("invalid creation staging location")
            }
            try fileManager.moveItem(at: staging, to: preparedOutput)
            try synchronizeCreationDirectory(preparedOutput.deletingLastPathComponent())
            return url
        }
        var coordinationError: NSError?
        var published: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordinationError) { target in
            published = Result {
                guard contains(target), target.standardizedFileURL == url.standardizedFileURL else {
                    throw TextTextCLIError.invalidDocument("the creation target changed outside the workspace")
                }
                if let folderDefault {
                    let latest = try LocalVaultFolderDefault.read(root: root, folder: destination)
                    guard latest?.sourceHash == folderDefault.sourceHash, latest?.sourcePath == folderDefault.sourcePath else {
                        throw TextTextCLIError.documentChanged(folderDefault.sourcePath)
                    }
                }
                try fileManager.moveItem(at: staging, to: target)
                try synchronizeCreationDirectory(target.deletingLastPathComponent())
            }
        }
        if let coordinationError { throw coordinationError }
        guard let published else { throw CocoaError(.fileWriteUnknown) }
        try published.get()
        return url
    }

    func synchronizeCreationDirectory(_ directory: URL) throws {
        let descriptor = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { Darwin.close(descriptor) }
        guard Darwin.fsync(descriptor) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
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
        if fileManager.fileExists(atPath: url.path) {
            _ = try fileManager.replaceItemAt(url, withItemAt: staging)
        } else {
            try fileManager.moveItem(at: staging, to: url)
        }
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
