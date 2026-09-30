import Foundation
import ZIPFoundation
import TextTextWorkspaceCore

/// Reads and saves the actual document files. There is no HTTP or database
/// dependency. Callers retain the read hash and reconcile a rejected save.
public struct LocalVaultDocumentStore: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath() }

    public struct Document: Sendable {
        public let path: String
        public let hash: String
        public let contents: TextTextTextBundleContents
    }

    public enum Failure: Error, LocalizedError {
        case invalidPath, changed, tooLarge
        public var errorDescription: String? {
            switch self {
            case .invalidPath: return "Choose a TextPack inside this workspace folder."
            case .changed: return "This file changed. Your edit is still available to merge or save as a copy."
            case .tooLarge: return "This TextPack is too large to open in the local editor."
            }
        }
    }

    public func url(for path: String) throws -> URL {
        guard !path.isEmpty, !path.hasPrefix("/"),
              !path.split(separator: "/").contains(where: { $0 == ".." || $0.hasPrefix(".") }),
              (path as NSString).pathExtension.lowercased() == "textpack"
        else { throw Failure.invalidPath }
        let target = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard target.path.hasPrefix(root.path + "/") else { throw Failure.invalidPath }
        return target
    }

    public func list() throws -> [String] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey]
        guard let enumerator = FileManager.default.enumerator(at: root,
            includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants])
        else { throw CocoaError(.fileReadNoSuchFile) }
        var result: [String] = []
        for case let file as URL in enumerator {
            let values = try file.resourceValues(forKeys: Set(keys))
            if values.isSymbolicLink == true { enumerator.skipDescendants(); continue }
            guard values.isRegularFile == true, file.pathExtension.lowercased() == "textpack" else { continue }
            let canonical = file.standardizedFileURL.resolvingSymlinksInPath().path
            guard canonical.hasPrefix(root.path + "/") else { continue }
            result.append(String(canonical.dropFirst(root.path.count + 1)))
            if result.count >= 20_000 { break }
        }
        return result.sorted()
    }

    public func read(path: String) throws -> Document {
        let target = try url(for: path)
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordinationError) { coordinated in
            outcome = Result { try readUncoordinated(path: path, url: coordinated) }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileReadUnknown) }
        return try outcome.get()
    }

    /// Collection sorting reads text metadata without expanding image entries.
    public func readMetadata(path: String) throws -> Document {
        let target = try url(for: path)
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordinationError) { coordinated in
            outcome = Result {
                guard (try coordinated.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                let bytes = try Data(contentsOf: coordinated)
                guard bytes.count <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                let archive = try Archive(data: bytes, accessMode: .read)
                var selected: [String: Data] = [:], expanded: UInt64 = 0
                for entry in archive where ["document.json", "text.md"].contains((entry.path as NSString).lastPathComponent) {
                    expanded += entry.uncompressedSize
                    guard expanded <= 4 * 1024 * 1024, selected[entry.path] == nil else { throw Failure.tooLarge }
                    var data = Data()
                    _ = try archive.extract(entry) { data.append($0) }
                    selected[entry.path] = data
                }
                let markdowns = selected.keys.filter { ($0 as NSString).lastPathComponent == "text.md" }
                guard markdowns.count == 1, let key = markdowns.first, let raw = selected[key] else { throw Failure.invalidPath }
                let document = selected[String(key.dropLast("text.md".count)) + "document.json"]
                let contents = TextTextTextBundleContents(markdown: String(decoding: raw, as: UTF8.self), sourceURL: nil,
                    documentJSON: document.map { String(decoding: $0, as: UTF8.self) }, templateJSON: nil,
                    templateAuthoringSourceJSON: nil, assets: [], logicalSize: Int(expanded))
                return Document(path: path, hash: TextTextStableDigest.sha256Hex(bytes), contents: contents)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileReadUnknown) }
        return try outcome.get()
    }

    /// Extract only definition metadata; image entries are never inflated.
    public func folderViews(folder: String) throws -> [[String: String]] {
        let sentinel = try url(for: (folder.isEmpty ? "" : folder + "/") + "Folder view.textpack")
        let directory = sentinel.deletingLastPathComponent()
        let children = try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey], options: [.skipsHiddenFiles])
        let candidates = children.filter { $0.pathExtension.lowercased() == "textpack" }
        guard candidates.count <= 2048 else { throw Failure.tooLarge }
        var total = 0, returnedBytes = 0, result: [[String: String]] = []
        for child in candidates.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let values = try child.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            total += values.fileSize ?? 0
            guard total <= 256 * 1024 * 1024, (values.fileSize ?? 0) <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
            guard child.standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent() == directory else { throw Failure.invalidPath }
            let bytes = try Data(contentsOf: child)
            guard bytes.count <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
            let archive = try Archive(data: bytes, accessMode: .read)
            var selected: [String: Data] = [:], expanded: UInt64 = 0
            for entry in archive where ["document.json", "template.json"].contains((entry.path as NSString).lastPathComponent) {
                expanded += entry.uncompressedSize
                guard expanded <= 4 * 1024 * 1024, selected[entry.path] == nil else { throw Failure.tooLarge }
                var data = Data()
                _ = try archive.extract(entry) { data.append($0) }
                selected[entry.path] = data
            }
            let documents = selected.keys.filter { ($0 as NSString).lastPathComponent == "document.json" }
            guard documents.count == 1, let key = documents.first, let raw = selected[key],
                let document = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any],
                let content = document["content"] as? [String: Any], let fields = content["fields"] as? [String: Any],
                fields["texttextFolderView"] != nil else { continue }
            let path = (folder.isEmpty ? "" : folder + "/") + child.lastPathComponent
            let templateKey = String(key.dropLast("document.json".count)) + "template.json"
            var file = ["path": path, "hash": TextTextStableDigest.sha256Hex(bytes), "documentJSON": String(decoding: raw, as: UTF8.self)]
            if let template = selected[templateKey] { file["templateJSON"] = String(decoding: template, as: UTF8.self) }
            returnedBytes += file.values.reduce(0) { $0 + $1.utf8.count }
            guard returnedBytes <= 4 * 1024 * 1024 else { throw Failure.tooLarge }
            result.append(file)
            guard result.count <= 16 else { throw Failure.tooLarge }
        }
        return result
    }

    public func rename(path: String, expectedHash: String, newPath: String) throws -> Document {
        let source = try url(for: path), destination = try url(for: newPath)
        if source == destination { return try read(path: path) }
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: source, options: .forMoving,
            writingItemAt: destination, options: [], error: &coordinationError) { from, to in
            outcome = Result {
                let current = try readUncoordinated(path: path, url: from)
                guard current.hash == expectedHash else { throw Failure.changed }
                try FileManager.default.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
                // moveItem refuses an occupied destination, including a race.
                try FileManager.default.moveItem(at: from, to: to)
                return try readUncoordinated(path: newPath, url: to)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileWriteUnknown) }
        return try outcome.get()
    }

    public func delete(path: String, expectedHash: String) throws {
        let source = try url(for: path)
        let trash = root.appendingPathComponent(".texttext/trash", isDirectory: true)
        guard trash.resolvingSymlinksInPath().path == trash.path else { throw Failure.invalidPath }
        var outcome: Result<Void, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: source, options: .forDeleting, error: &coordinationError) { source in
            outcome = Result {
                let current = try readUncoordinated(path: path, url: source)
                guard current.hash == expectedHash else { throw Failure.changed }
                try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: source, to: trash.appendingPathComponent(UUID().uuidString + ".textpack"))
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileWriteUnknown) }
        try outcome.get()
    }

    public func readRevision(path: String, hash: String) throws -> Document {
        _ = try url(for: path)
        guard hash.count == 64, hash.allSatisfy({ $0.isHexDigit }) else { throw Failure.invalidPath }
        let saved = root.appendingPathComponent(".texttext/history/\(hash).textpack")
        guard saved.resolvingSymlinksInPath().path == saved.path else { throw Failure.invalidPath }
        let document = try readUncoordinated(path: path, url: saved)
        guard document.hash == hash else { throw Failure.changed }
        return document
    }

    /// Clone the exact observed archive, changing only its embedded identity.
    /// Opaque entries and metadata survive because this never rematerializes
    /// the package from the subset of fields understood by the current app.
    public func clone(path: String, sourceHash: String? = nil, newPath: String) throws -> Document {
        let source = try sourceHash.map { try readRevision(path: path, hash: $0) } ?? read(path: path)
        let destination = try url(for: newPath)
        let saved = root.appendingPathComponent(".texttext/history/\(source.hash).textpack")
        guard saved.resolvingSymlinksInPath().path == saved.path else { throw Failure.invalidPath }
        let bytes = try Data(contentsOf: saved)
        guard TextTextStableDigest.sha256Hex(bytes) == source.hash else { throw Failure.changed }
        let parent = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        let temporary = parent.appendingPathComponent(".texttext-clone-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let packed = temporary.appendingPathComponent("clone.textpack")
        try bytes.write(to: packed)
        do {
            let archive = try Archive(url: packed, accessMode: .update)
            guard let entry = archive.first(where: { $0.path == "text.md" || $0.path.hasSuffix("/text.md") }) else {
                throw Failure.invalidPath
            }
            let entryPath = entry.path
            var original = Data()
            _ = try archive.extract(entry) { original.append($0) }
            guard let markdown = String(data: original, encoding: .utf8) else { throw Failure.invalidPath }
            let identity = MarkdownIdentityCodec.extract(from: markdown)
            let replacement = MarkdownIdentityCodec.inject(into: markdown,
                itemId: UUID().uuidString.lowercased(), folderId: nil, kind: identity?.kind)
            let replacementURL = temporary.appendingPathComponent("text.md")
            try Data(replacement.utf8).write(to: replacementURL)
            try archive.remove(entry)
            try archive.addEntry(with: entryPath, fileURL: replacementURL, compressionMethod: .deflate)
        }
        let handle = try FileHandle(forWritingTo: packed)
        try handle.synchronize(); try handle.close()
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: destination, options: [], error: &coordinationError) { target in
            outcome = Result {
                // The final rename refuses existing targets, including races.
                // The new identity is already present before the file appears.
                try FileManager.default.moveItem(at: packed, to: target)
                return try readUncoordinated(path: newPath, url: target)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileWriteUnknown) }
        return try outcome.get()
    }

    private func preserve(_ bytes: Data, hash: String) throws {
        let recovery = root.appendingPathComponent(".texttext/history", isDirectory: true)
        guard recovery.resolvingSymlinksInPath().path == recovery.path else { throw Failure.invalidPath }
        try FileManager.default.createDirectory(at: recovery, withIntermediateDirectories: true)
        let saved = recovery.appendingPathComponent(hash + ".textpack")
        if !FileManager.default.fileExists(atPath: saved.path) {
            try bytes.write(to: saved, options: .atomic)
        }
    }

    private func readUncoordinated(path: String, url: URL) throws -> Document {
        // Bound bridge memory before ZIP parsing; the package reader also
        // validates expanded entry sizes and rejects traversal/symlink entries.
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
        let bytes = try Data(contentsOf: url)
        return try parseDocument(path: path, bytes: bytes, preserveHistory: true)
    }

    func parseDocument(path: String, bytes: Data, preserveHistory: Bool) throws -> Document {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        // Parse the exact bytes hashed, even if an uncoordinated external
        // writer replaces the original while this read is running.
        let copy = temporary.appendingPathComponent("read.textpack")
        try bytes.write(to: copy)
        let archive = try Archive(url: copy, accessMode: .read)
        var expanded: UInt64 = 0
        for entry in archive {
            guard entry.uncompressedSize <= 64 * 1024 * 1024 - expanded else { throw Failure.tooLarge }
            expanded += entry.uncompressedSize
        }
        let contents = try TextTextTextBundlePackage.read(from: copy, in: temporary)
        let hash = TextTextStableDigest.sha256Hex(bytes)
        // Keep the exact version observed by the editor so an external
        // asset replacement can still produce a complete conflict copy.
        if preserveHistory { try preserve(bytes, hash: hash) }
        return Document(path: path, hash: hash, contents: contents)
    }

    public func write(path: String, expectedHash: String, markdown: String,
                      documentJSON: String?, templateJSON: String?,
                      templateAuthoringSourceJSON: String?) throws -> Document {
        let target = try url(for: path)
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordinationError) { coordinated in
            outcome = Result {
                let current = try readUncoordinated(path: path, url: coordinated)
                guard current.hash == expectedHash else { throw Failure.changed }
                let before = current.contents
                if before.markdown == markdown, before.documentJSON == documentJSON,
                   before.templateJSON == templateJSON,
                   before.templateAuthoringSourceJSON == templateAuthoringSourceJSON { return current }
                let parent = coordinated.deletingLastPathComponent()
                let temporary = parent.appendingPathComponent(".texttext-save-\(UUID().uuidString)")
                try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: temporary) }
                let package = try TextTextTextBundlePackage.materialize(
                    canonicalMarkdown: markdown, documentJSON: documentJSON,
                    templateJSON: templateJSON, templateAuthoringSourceJSON: templateAuthoringSourceJSON,
                    assets: before.assets.map {
                        .init(filename: $0.filename, data: $0.data,
                              remoteURL: $0.remoteURL ?? "assets/\($0.filename)", contentType: $0.contentType)
                    }, sourceURL: before.sourceURL, in: temporary)
                // Update only owned content entries. Keep opaque metadata and
                // unknown asset entries exactly as supplied by other tools.
                let packed = temporary.appendingPathComponent("updated.textpack")
                let originalBytes = try Data(contentsOf: coordinated)
                guard TextTextStableDigest.sha256Hex(originalBytes) == expectedHash else { throw Failure.changed }
                try originalBytes.write(to: packed)
                let archive = try Archive(url: packed, accessMode: .update)
                guard let markdownEntry = archive.first(where: { $0.path == "text.md" || $0.path.hasSuffix("/text.md") }) else {
                    throw Failure.invalidPath
                }
                let prefix = String(markdownEntry.path.dropLast("text.md".count))
                for name in ["text.md", "document.json", "template.json", "template-source.json"] {
                    if let entry = archive[prefix + name] { try archive.remove(entry) }
                    let replacement = package.url.appendingPathComponent(name)
                    if FileManager.default.fileExists(atPath: replacement.path) {
                        try archive.addEntry(with: prefix + name, fileURL: replacement, compressionMethod: .deflate)
                    }
                }
                let handle = try FileHandle(forWritingTo: packed)
                try handle.synchronize(); try handle.close()
                let latestBytes = try Data(contentsOf: coordinated)
                guard TextTextStableDigest.sha256Hex(latestBytes) == expectedHash else { throw Failure.changed }
                try preserve(latestBytes, hash: expectedHash)
                _ = try FileManager.default.replaceItemAt(coordinated, withItemAt: packed)
                return try readUncoordinated(path: path, url: coordinated)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileWriteUnknown) }
        return try outcome.get()
    }
}
