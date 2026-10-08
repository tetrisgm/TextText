import Foundation
import Darwin
import ZIPFoundation
import TextTextWorkspaceCore

/// Reads and saves the actual document files. There is no HTTP or database
/// dependency. Callers retain the read hash and reconcile a rejected save.
public struct LocalVaultDocumentStore: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath() }

    private func canonicalMarkdownEntry(_ archive: Archive) throws -> Entry {
        if let root = archive["text.md"] { return root }
        let candidates = archive.filter { entry in
            let parts = entry.path.split(separator: "/")
            return parts.count == 2 && parts[0].hasSuffix(".textbundle") && parts[1] == "text.md"
        }
        guard candidates.count == 1 else { throw Failure.invalidPath }
        return candidates[0]
    }

    private func publishedAt(_ archive: Archive, prefix: String) -> String? {
        let names = archive.filter { $0.path == "publication.json" || $0.path.hasSuffix("/publication.json") }
        guard names.count == 1, let marker = names.first,
              marker.path == prefix + "publication.json", marker.uncompressedSize <= 4_096 else { return nil }
        var bytes = Data()
        guard (try? archive.extract(marker) { chunk in bytes.append(chunk) }) != nil,
              bytes.count <= 4_096,
              let value = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
              Set(value.keys) == Set(["schemaVersion", "status", "publishedAt", "operationId"]),
              value["schemaVersion"] as? Int == 1, value["status"] as? String == "public",
              let date = value["publishedAt"] as? String,
              let operation = value["operationId"] as? String,
              operation.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil,
              date.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$", options: .regularExpression) != nil else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let parsed = formatter.date(from: date), formatter.string(from: parsed) == date else { return nil }
        return date
    }

    public struct Document: Sendable {
        public let path: String
        public let hash: String
        public let contents: TextTextTextBundleContents
        public let publishedAt: String?
    }

    public enum Failure: Error, LocalizedError {
        case invalidPath, changed, tooLarge, duplicateIdentity
        public var errorDescription: String? {
            switch self {
            case .invalidPath: return "Choose a TextPack inside this workspace folder."
            case .changed: return "This file changed. Your edit is still available to merge or save as a copy."
            case .tooLarge: return "This TextPack is too large to open in the local editor."
            case .duplicateIdentity: return "More than one TextPack has this item identity. Resolve the duplicate before opening a card link."
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

    /// Materialize visible directories. Catalog reconciliation separately removes only empty managed directories.
    public func ensureFolders(_ folders: [String]) throws {
        guard folders.count <= 20_000 else { throw Failure.invalidPath }
        for path in folders {
            let parts = path.split(separator: "/", omittingEmptySubsequences: false)
            guard !parts.isEmpty, path.utf8.count <= 1024,
                  parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") && !$0.contains(":") && !$0.hasSuffix(" ") && !$0.hasSuffix(".") && !$0.lowercased().hasSuffix(".textpack") }) else { throw Failure.invalidPath }
            var current = root
            for part in parts {
                current.appendPathComponent(String(part), isDirectory: true)
                let placeholder = current.deletingLastPathComponent().appendingPathComponent(".\(part).icloud")
                guard !FileManager.default.fileExists(atPath: placeholder.path) else { throw Failure.invalidPath }
                if let attrs = try? FileManager.default.attributesOfItem(atPath: current.path) {
                    guard attrs[.type] as? FileAttributeType == .typeDirectory else { throw Failure.invalidPath }
                } else {
                    try FileManager.default.createDirectory(at: current, withIntermediateDirectories: false)
                }
                guard current.standardizedFileURL.resolvingSymlinksInPath().path == current.standardizedFileURL.path else { throw Failure.invalidPath }
            }
        }
    }

    public func validateFolderCatalog(_ folders: [String]) throws {
        guard folders.count <= 20_000 else { throw Failure.invalidPath }
        for path in folders {
            let parts = path.split(separator: "/", omittingEmptySubsequences: false)
            guard path.utf8.count <= 1024, !parts.isEmpty,
                  parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") && !$0.contains(":") && !$0.hasSuffix(" ") && !$0.hasSuffix(".") && !$0.lowercased().hasSuffix(".textpack") }) else { throw Failure.invalidPath }
        }
    }

    /// Never recursively delete: rmdir is atomic and refuses even a concurrently created entry.
    public func removeEmptyManagedFolder(_ path: String) throws -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard path.utf8.count <= 1024, !parts.isEmpty,
              parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") && !$0.contains(":") && !$0.hasSuffix(" ") && !$0.hasSuffix(".") && !$0.lowercased().hasSuffix(".textpack") }) else { throw Failure.invalidPath }
        var target = root
        for part in parts {
            target.appendPathComponent(String(part), isDirectory: true)
            guard !FileManager.default.fileExists(atPath: target.deletingLastPathComponent().appendingPathComponent(".\(part).icloud").path),
                  target.resolvingSymlinksInPath().path == target.path else { throw Failure.invalidPath }
        }
        if let values = try? target.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
           values.ubiquitousItemDownloadingStatus == .notDownloaded { return false }
        if !FileManager.default.fileExists(atPath: target.path) { return true }
        var removed = false
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forDeleting, error: &coordinationError) { coordinated in
            guard coordinated.standardizedFileURL.path == target.standardizedFileURL.path,
                  coordinated.resolvingSymlinksInPath().path == target.path else { return }
            let result = coordinated.withUnsafeFileSystemRepresentation { pointer in pointer.map { Darwin.rmdir($0) } ?? -1 }
            removed = result == 0 || errno == ENOENT
        }
        if let coordinationError { throw coordinationError }
        return removed
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

    /// Resolve a stable TextPack identity only when a link is opened. The
    /// folder listing stays cheap, and ambiguous copies fail closed.
    public func path(forItemId itemId: String) throws -> String? {
        guard itemId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil else {
            throw Failure.invalidPath
        }
        var match: String?
        for path in try list() {
            guard let document = try? readMetadata(path: path),
                  MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == itemId else { continue }
            if match != nil { throw Failure.duplicateIdentity }
            match = path
        }
        return match
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
    /// Template callers can opt into the small JSON look entries without loading assets.
    public func readMetadata(path: String, includeTemplate: Bool = false) throws -> Document {
        let target = try url(for: path)
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordinationError) { coordinated in
            outcome = Result {
                guard (try coordinated.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                let bytes = try Data(contentsOf: coordinated)
                guard bytes.count <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                let archive = try Archive(data: bytes, accessMode: .read)
                let key = try canonicalMarkdownEntry(archive).path
                let prefix = String(key.dropLast("text.md".count))
                let entries: Set<String> = includeTemplate
                    ? [key, prefix + "document.json", prefix + "template.json", prefix + "template-source.json"]
                    : [key, prefix + "document.json"]
                var selected: [String: Data] = [:], expanded: UInt64 = 0
                for entry in archive where entries.contains(entry.path) {
                    expanded += entry.uncompressedSize
                    guard expanded <= (includeTemplate ? 8 : 4) * 1024 * 1024, selected[entry.path] == nil else { throw Failure.tooLarge }
                    var data = Data()
                    _ = try archive.extract(entry) { data.append($0) }
                    selected[entry.path] = data
                }
                guard let raw = selected[key] else { throw Failure.invalidPath }
                let document = selected[prefix + "document.json"]
                let template = selected[prefix + "template.json"]
                let templateSource = selected[prefix + "template-source.json"]
                let contents = TextTextTextBundleContents(markdown: String(decoding: raw, as: UTF8.self), sourceURL: nil,
                    documentJSON: document.map { String(decoding: $0, as: UTF8.self) },
                    templateJSON: template.map { String(decoding: $0, as: UTF8.self) },
                    templateAuthoringSourceJSON: templateSource.map { String(decoding: $0, as: UTF8.self) },
                    assets: [], logicalSize: Int(expanded))
                return Document(path: path, hash: TextTextStableDigest.sha256Hex(bytes), contents: contents,
                    publishedAt: publishedAt(archive, prefix: prefix))
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileReadUnknown) }
        return try outcome.get()
    }

    /// Read only document.json from bookmark TextPacks. The feed's Read Later
    /// list and saved state share this bounded local metadata scan.
    public func keptFeedEntries() throws -> [[String: String]] {
        var entries: [String: [String: String]] = [:]
        for path in try list() where path.hasPrefix("Bookmarks/") {
            let target = try url(for: path)
            var outcome: Result<[String: String]?, Error>?
            var coordinationError: NSError?
            NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordinationError) { coordinated in
                outcome = Result {
                    guard (try coordinated.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                    let archive = try Archive(url: coordinated, accessMode: .read)
                    let markdown = try canonicalMarkdownEntry(archive)
                    let prefix = String(markdown.path.dropLast("text.md".count))
                    guard let entry = archive[prefix + "document.json"] else { return nil }
                    guard entry.type == .file, entry.uncompressedSize <= 4 * 1024 * 1024 else { throw Failure.tooLarge }
                    var data = Data()
                    _ = try archive.extract(entry) { chunk in
                        guard data.count <= 4 * 1024 * 1024 - chunk.count else { throw Failure.tooLarge }
                        data.append(chunk)
                    }
                    guard let document = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let content = document["content"] as? [String: Any],
                          let fields = content["fields"] as? [String: Any],
                          fields["texttextFeedEntry"] as? String == "v1" else { return nil }
                    guard let hash = fields["feedEntryHash"] as? String,
                          hash.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return nil }
                    let title = String((content["title"] as? String ?? "Saved story").prefix(300))
                    let source = String((fields["feedTitle"] as? String ?? "").prefix(160))
                    let keptAt = String((fields["keptAt"] as? String ?? "").prefix(32))
                    var saved = ["hash": hash, "path": path, "title": title, "source": source, "keptAt": keptAt]
                    if let topic = fields["feedTopic"] as? String, !topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        saved["topic"] = String(topic.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
                    }
                    if let readAt = fields["texttextBookmarkReadAt"] as? String, !readAt.isEmpty {
                        saved["readAt"] = String(readAt.prefix(32))
                    }
                    if let progress = fields["texttextFeedReadingProgress"] as? Int, (0...100).contains(progress) {
                        saved["progress"] = String(progress)
                    }
                    return saved
                }
            }
            if let coordinationError { throw coordinationError }
            guard let outcome else { throw CocoaError(.fileReadUnknown) }
            if let entry = try outcome.get(), let hash = entry["hash"] {
                let previous = entries[hash]
                if previous == nil || (entry["keptAt"] ?? "") > (previous?["keptAt"] ?? "") {
                    entries[hash] = entry
                }
            }
        }
        return entries.values.sorted {
            if $0["keptAt"] != $1["keptAt"] { return ($0["keptAt"] ?? "") > ($1["keptAt"] ?? "") }
            return ($0["path"] ?? "") < ($1["path"] ?? "")
        }
    }

    public func keptFeedEntryHashes() throws -> [String] {
        try keptFeedEntries().compactMap { $0["hash"] }.sorted()
    }

    /// Read only metadata for deliberate, unsaved story reads. These packs are
    /// ordinary articles in Feeds/History, separate from saved Bookmarks.
    public func readFeedEntries() throws -> [[String: String]] {
        let paths = try list().filter { $0.hasPrefix("Feeds/History/") && $0.hasSuffix(".textpack") }
        guard paths.count <= 2048 else { throw Failure.tooLarge }
        var records: [String: [String: String]] = [:], inspected = 0
        for path in paths {
            let file = try readMetadata(path: path)
            inspected += file.contents.logicalSize
            guard inspected <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
            guard let raw = file.contents.documentJSON,
                  let document = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
                  let content = document["content"] as? [String: Any],
                  let fields = content["fields"] as? [String: Any],
                  fields["texttextFeedHistoryEntry"] as? String == "v1",
                  let hash = fields["feedEntryHash"] as? String,
                  hash.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
                  let viewedAt = (fields["viewedAt"] as? String) ?? (fields["readAt"] as? String), !viewedAt.isEmpty else { continue }
            var entry = ["hash": hash, "path": path, "revision": file.hash,
                "title": String((content["title"] as? String ?? "Read story").prefix(300)),
                "source": String((fields["feedTitle"] as? String ?? "").prefix(160)),
                "viewedAt": String(viewedAt.prefix(32))]
            if let readAt = fields["readAt"] as? String, !readAt.isEmpty { entry["readAt"] = String(readAt.prefix(32)) }
            if let progress = fields["texttextFeedReadingProgress"] as? Int, (0...100).contains(progress) { entry["progress"] = String(progress) }
            if let topic = fields["feedTopic"] as? String, !topic.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                entry["topic"] = String(topic.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
            }
            if records[hash] == nil || (entry["viewedAt"] ?? "") > (records[hash]?["viewedAt"] ?? "") {
                records[hash] = entry
            }
        }
        return records.values.sorted {
            if $0["viewedAt"] != $1["viewedAt"] { return ($0["viewedAt"] ?? "") > ($1["viewedAt"] ?? "") }
            return ($0["path"] ?? "") < ($1["path"] ?? "")
        }
    }

    /// Extract only definition metadata; image entries are never inflated.
    public func folderViews(folder: String) throws -> [[String: String]] {
        let sentinel = try url(for: (folder.isEmpty ? "" : folder + "/") + "Folder view.textpack")
        let directory = sentinel.deletingLastPathComponent()
        let children = try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey], options: [.skipsHiddenFiles])
        let candidates = children.filter { $0.pathExtension.lowercased() == "textpack" }
        var returnedBytes = 0, result: [[String: String]] = []
        for child in candidates.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let values = try child.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            guard child.standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent() == directory else { throw Failure.invalidPath }
            guard var file = try LocalVaultFolderMetadataCache.read(child) else { continue }
            file["path"] = (folder.isEmpty ? "" : folder + "/") + child.lastPathComponent
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
                if let itemId = MarkdownIdentityCodec.extract(from: current.contents.markdown)?.itemId {
                    try LocalVaultDeviceState.recordDeletion(root: root, itemId: itemId, path: path, hash: current.hash)
                }
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
    /// Mutation receipts belong to the old identity and must not be inherited.
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
            let entry = try canonicalMarkdownEntry(archive)
            let entryPath = entry.path
            let prefix = String(entryPath.dropLast("text.md".count))
            let inheritedReceipts = archive.filter { $0.path.hasPrefix(prefix + "net.texttext.mutations/") }.map(\.path)
            // Removing an entry shifts archive offsets; resolve each entry anew.
            for path in inheritedReceipts { if let receipt = archive[path] { try archive.remove(receipt) } }
            var original = Data()
            _ = try archive.extract(entry) { original.append($0) }
            guard let markdown = String(data: original, encoding: .utf8) else { throw Failure.invalidPath }
            let identity = MarkdownIdentityCodec.extract(from: markdown)
            let replacement = MarkdownIdentityCodec.inject(into: markdown,
                itemId: UUID().uuidString.lowercased(), folderId: nil, kind: identity?.kind)
            let replacementURL = temporary.appendingPathComponent("text.md")
            try Data(replacement.utf8).write(to: replacementURL)
            guard let currentMarkdown = archive[entryPath] else { throw Failure.invalidPath }
            try archive.remove(currentMarkdown)
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
        let prefix = String(try canonicalMarkdownEntry(archive).path.dropLast("text.md".count))
        return Document(path: path, hash: hash, contents: contents, publishedAt: publishedAt(archive, prefix: prefix))
    }

    public func write(path: String, expectedHash: String, markdown: String,
                      documentJSON: String?, templateJSON: String?,
                      templateAuthoringSourceJSON: String?,
                      addedAssets: [TextTextTextBundleAsset] = [],
                      mutationKey: String? = nil, mutationFingerprint: String? = nil) throws -> Document {
        if let mutationKey {
            guard !mutationKey.isEmpty, mutationKey.utf8.count <= 256,
                  mutationFingerprint?.utf8.count == 64 else {
                throw TextTextTextBundleError.invalidPackage("Invalid mutation identity")
            }
        }
        let target = try url(for: path)
        var outcome: Result<Document, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &coordinationError) { coordinated in
            outcome = Result {
                let current = try readUncoordinated(path: path, url: coordinated)
                let receiptPath = try mutationKey.map {
                    let archive = try Archive(url: coordinated, accessMode: .read)
                    let prefix = String(try canonicalMarkdownEntry(archive).path.dropLast("text.md".count))
                    return prefix + "net.texttext.mutations/" + TextTextStableDigest.sha256Hex(Data($0.utf8)) + ".json"
                }
                if let receiptPath {
                    let existingArchive = try Archive(url: coordinated, accessMode: .read)
                    if let entry = existingArchive[receiptPath] {
                        guard entry.uncompressedSize <= 1024 else { throw Failure.tooLarge }
                        var bytes = Data(); _ = try existingArchive.extract(entry) { bytes.append($0) }
                        let receipt = try JSONSerialization.jsonObject(with: bytes) as? [String: String]
                        guard receipt?["fingerprint"] == mutationFingerprint else {
                            throw TextTextTextBundleError.invalidPackage("Mutation key already used for different content")
                        }
                        return current
                    }
                    let receiptDirectory = (receiptPath as NSString).deletingLastPathComponent + "/"
                    guard existingArchive.filter({ $0.path.hasPrefix(receiptDirectory) }).count < 4096 else {
                        throw TextTextTextBundleError.invalidPackage("Document mutation receipt limit reached")
                    }
                }
                guard current.hash == expectedHash else { throw Failure.changed }
                let before = current.contents
                let occupied = Dictionary(uniqueKeysWithValues: before.assets.map {
                    ($0.filename.precomposedStringWithCanonicalMapping.lowercased(), $0)
                })
                var additions = Set<String>()
                var addedSize = 0
                var newAssets: [TextTextTextBundleAsset] = []
                for asset in addedAssets {
                    let normalized = asset.filename.precomposedStringWithCanonicalMapping.lowercased()
                    guard TextTextTextBundlePackage.isSafeAssetFilename(asset.filename),
                          additions.insert(normalized).inserted else {
                        throw TextTextTextBundleError.invalidPackage("Unsafe or duplicate pasted asset name")
                    }
                    if let existing = occupied[normalized] {
                        guard existing.filename == asset.filename, existing.data == asset.data else {
                            throw TextTextTextBundleError.invalidPackage("Pasted asset already exists with different bytes")
                        }
                    } else {
                        newAssets.append(asset)
                        addedSize += asset.data.count
                    }
                }
                guard before.logicalSize <= 64 * 1024 * 1024 - addedSize else { throw Failure.tooLarge }
                if before.markdown == markdown, before.documentJSON == documentJSON,
                   before.templateJSON == templateJSON,
                   before.templateAuthoringSourceJSON == templateAuthoringSourceJSON,
                   addedAssets.isEmpty, mutationKey == nil { return current }
                let parent = coordinated.deletingLastPathComponent()
                let temporary = parent.appendingPathComponent(".texttext-save-\(UUID().uuidString)")
                try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: temporary) }
                let package = try TextTextTextBundlePackage.materialize(
                    canonicalMarkdown: markdown, documentJSON: documentJSON,
                    templateJSON: templateJSON, templateAuthoringSourceJSON: templateAuthoringSourceJSON,
                    assets: before.assets.map { existing in
                        let addition = addedAssets.first { $0.filename == existing.filename }
                        return .init(filename: existing.filename, data: existing.data,
                              remoteURL: addition?.remoteURL ?? existing.remoteURL ?? "assets/\(existing.filename)",
                              contentType: addition?.contentType ?? existing.contentType)
                    } + newAssets.map {
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
                if let receiptPath, let mutationFingerprint {
                    let receiptURL = temporary.appendingPathComponent("mutation-receipt.json")
                    try JSONSerialization.data(withJSONObject: ["fingerprint": mutationFingerprint], options: [.sortedKeys]).write(to: receiptURL)
                    try archive.addEntry(with: receiptPath, fileURL: receiptURL, compressionMethod: .deflate)
                }
                let markdownEntry = try canonicalMarkdownEntry(archive)
                let prefix = String(markdownEntry.path.dropLast("text.md".count))
                for name in ["text.md", "document.json", "template.json", "template-source.json"] {
                    if let entry = archive[prefix + name] { try archive.remove(entry) }
                    let replacement = package.url.appendingPathComponent(name)
                    if FileManager.default.fileExists(atPath: replacement.path) {
                        try archive.addEntry(with: prefix + name, fileURL: replacement, compressionMethod: .deflate)
                    }
                }
                for asset in newAssets {
                    let entryPath = prefix + "assets/" + asset.filename
                    guard archive[entryPath] == nil else { throw TextTextTextBundleError.invalidPackage("Pasted asset already exists") }
                    try archive.addEntry(with: entryPath,
                        fileURL: package.url.appendingPathComponent("assets/" + asset.filename),
                        compressionMethod: .deflate)
                }
                if !addedAssets.isEmpty {
                    var originalInfo: [String: Any] = [:]
                    let infoPath = prefix + "info.json"
                    if let entry = archive[infoPath] {
                        var bytes = Data(); _ = try archive.extract(entry) { bytes.append($0) }
                        originalInfo = (try JSONSerialization.jsonObject(with: bytes)) as? [String: Any] ?? [:]
                    }
                    let generatedData = try Data(contentsOf: package.url.appendingPathComponent("info.json"))
                    let generatedInfo = try JSONSerialization.jsonObject(with: generatedData) as? [String: Any]
                    let generatedMappings = generatedInfo?["net.texttext.assets"] as? [String: Any] ?? [:]
                    var mappings = originalInfo["net.texttext.assets"] as? [String: Any] ?? [:]
                    for asset in addedAssets where generatedMappings[asset.filename] != nil {
                        mappings[asset.filename] = generatedMappings[asset.filename]
                    }
                    originalInfo["net.texttext.assets"] = mappings
                    let mergedInfo = temporary.appendingPathComponent("merged-info.json")
                    try JSONSerialization.data(withJSONObject: originalInfo, options: [.sortedKeys])
                        .write(to: mergedInfo, options: .atomic)
                    if let entry = archive[infoPath] { try archive.remove(entry) }
                    try archive.addEntry(with: infoPath, fileURL: mergedInfo, compressionMethod: .deflate)
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
