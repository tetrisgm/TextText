import Foundation
import ZIPFoundation
import TextTextWorkspaceCore

extension LocalVaultDocumentStore {
    public struct RecoveryEntry: Sendable {
        public let id: String
        public let path: String
        public let kind: String
        public let savedAt: String
        public let hash: String
    }
    public struct RecoveryPage: Sendable {
        public let entries: [RecoveryEntry]
        public let truncated: Bool
    }
    private struct RecoveryID: Codable {
        let location: String
        let path: String
        let hash: String
    }

    private func recoveryURL(_ location: String) throws -> URL {
        let parts = location.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count >= 3, parts[0] == ".texttext",
              ["history", "trash", "conflicts"].contains(parts[1]),
              parts.dropFirst().allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") }),
              (location as NSString).pathExtension == "textpack",
              (parts[1] == "conflicts" ? parts.count == 4 : parts.count == 3) else { throw Failure.invalidPath }
        let result = root.resolvingSymlinksInPath().appendingPathComponent(location)
        guard result.standardizedFileURL.path == result.path,
              result.resolvingSymlinksInPath().path == result.path else { throw Failure.invalidPath }
        return result
    }

    private func recoveryBytes(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else { throw Failure.invalidPath }
        guard (values.fileSize ?? 0) <= 32 * 1024 * 1024 else { throw Failure.tooLarge }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let bytes = try handle.read(upToCount: 32 * 1024 * 1024 + 1) ?? Data()
        guard bytes.count <= 32 * 1024 * 1024 else { throw Failure.tooLarge }
        return bytes
    }

    private func recoveryMetadata(_ bytes: Data) throws -> (markdown: String, title: String?) {
        let archive = try Archive(data: bytes, accessMode: .read)
        var candidates: [Entry] = [], count = 0
        for entry in archive {
            count += 1
            guard count <= TextTextTextBundlePackage.maximumEntryCount, entry.type != .symlink,
                  !entry.path.hasPrefix("/"), !entry.path.contains("\\"),
                  !entry.path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else { throw Failure.invalidPath }
            if entry.path == "text.md" || entry.path.hasSuffix("/text.md") { candidates.append(entry) }
        }
        guard candidates.count == 1, let entry = candidates.first, entry.type == .file,
              entry.uncompressedSize <= 2 * 1024 * 1024 else { throw Failure.tooLarge }
        var text = Data()
        _ = try archive.extract(entry) { chunk in
            guard text.count + chunk.count <= 2 * 1024 * 1024 else { throw Failure.tooLarge }
            text.append(chunk)
        }
        let markdown = String(decoding: text, as: UTF8.self)
        var body = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
        var title: String?
        // Match the app's import frontmatter grammar; quoted titles are JSON strings.
        if body.hasPrefix("---\n"), let end = body.range(of: "\n---", range: body.index(body.startIndex, offsetBy: 4)..<body.endIndex) {
            let header = body[body.index(body.startIndex, offsetBy: 4)..<end.lowerBound]
            for line in header.split(separator: "\n") where line.hasPrefix("title:") {
                let value = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                title = (try? JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed)) as? String ?? value
            }
            body = String(body[end.upperBound...])
        }
        if title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            title = body.split(separator: "\n").first(where: { $0.hasPrefix("# ") }).map { String($0.dropFirst(2)) }
        }
        if title == nil {
            let documentPath = String(entry.path.dropLast("text.md".count)) + "document.json"
            if let document = archive[documentPath], document.type == .file, document.uncompressedSize <= 2 * 1024 * 1024 {
                var data = Data()
                _ = try archive.extract(document) { chunk in
                    guard data.count + chunk.count <= 2 * 1024 * 1024 else { throw Failure.tooLarge }
                    data.append(chunk)
                }
                if let snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   snapshot["schemaVersion"] as? Int == 1,
                   let content = snapshot["content"] as? [String: Any] { title = content["title"] as? String }
            }
        }
        return (markdown, title)
    }

    /// Retained bytes remain untouched. Legacy trash has no original-path metadata;
    /// use the embedded title as a recoverable copy name in that case.
    public func recoveryList(path: String? = nil) throws -> RecoveryPage {
        var identity: String?
        if let path {
            _ = try url(for: path)
            identity = MarkdownIdentityCodec.extract(from: try readMetadata(path: path).contents.markdown)?.itemId
        }
        let kinds = path == nil ? ["trash", "conflicts"] : ["history"]
        var entries: [RecoveryEntry] = [], scanned = 0, totalBytes = 0, truncated = false
        let formatter = ISO8601DateFormatter()
        outer: for kind in kinds {
            let directory = root.resolvingSymlinksInPath().appendingPathComponent(".texttext/\(kind)")
            guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalidPath }
            guard FileManager.default.fileExists(atPath: directory.path) else { continue }
            guard let enumerator = FileManager.default.enumerator(at: directory,
                includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey]) else { continue }
            for case let file as URL in enumerator {
                scanned += 1
                if scanned > 2048 || entries.count >= 200 { truncated = true; break outer }
                let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
                if values.isSymbolicLink == true { enumerator.skipDescendants(); continue }
                if values.isDirectory == true {
                    if kind != "conflicts" || file.deletingLastPathComponent().resolvingSymlinksInPath().path != directory.resolvingSymlinksInPath().path { enumerator.skipDescendants() }
                    continue
                }
                guard file.pathExtension == "textpack" else { continue }
                totalBytes += values.fileSize ?? 0
                if totalBytes > 256 * 1024 * 1024 { truncated = true; break outer }
                let canonical = file.standardizedFileURL.resolvingSymlinksInPath()
                let base = directory.standardizedFileURL.resolvingSymlinksInPath()
                guard canonical.path.hasPrefix(base.path + "/") else { continue }
                let location = ".texttext/\(kind)/" + String(canonical.path.dropFirst(base.path.count + 1))
                do {
                    let bytes = try recoveryBytes(recoveryURL(location))
                    let hash = TextTextStableDigest.sha256Hex(bytes)
                    if kind == "history", file.deletingPathExtension().lastPathComponent != hash { truncated = true; continue }
                    let metadata = try recoveryMetadata(bytes)
                    let markdown = metadata.markdown
                    if kind == "history" {
                        guard let identity, MarkdownIdentityCodec.extract(from: markdown)?.itemId == identity else { continue }
                    }
                    let title = String(decoding: (metadata.title ?? "Recovered item").utf8.prefix(512), as: UTF8.self)
                    let clean = title.components(separatedBy: .controlCharacters).joined(separator: " ")
                        .replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
                        .replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
                    let name = clean.isEmpty || clean.hasPrefix(".") ? "Recovered item" : String(decoding: clean.utf8.prefix(160), as: UTF8.self)
                    let displayPath = path ?? (kind == "trash" ? "\(name).textpack" : file.lastPathComponent)
                    _ = try url(for: displayPath)
                    let id = try JSONEncoder().encode(RecoveryID(location: location, path: displayPath, hash: hash)).base64EncodedString()
                    entries.append(RecoveryEntry(id: id, path: displayPath, kind: kind == "trash" ? "deleted" : kind == "history" ? "revision" : "conflict",
                        savedAt: formatter.string(from: values.contentModificationDate ?? .distantPast), hash: hash))
                } catch { truncated = true }
            }
        }
        return RecoveryPage(entries: entries.sorted { $0.savedAt > $1.savedAt }, truncated: truncated)
    }

    public func recoveryRead(id: String) throws -> (document: Document, data: Data) {
        guard id.utf8.count <= 8192, let encoded = Data(base64Encoded: id),
              let token = try? JSONDecoder().decode(RecoveryID.self, from: encoded),
              token.hash.count == 64, token.hash.allSatisfy({ "0123456789abcdef".contains($0) }) else { throw Failure.invalidPath }
        _ = try url(for: token.path)
        let target = try recoveryURL(token.location)
        var outcome: Result<(Document, Data), Error>?, coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &coordinationError) { coordinated in
            outcome = Result {
                guard coordinated.resolvingSymlinksInPath().path == target.path else { throw Failure.invalidPath }
                let bytes = try recoveryBytes(coordinated)
                guard TextTextStableDigest.sha256Hex(bytes) == token.hash else { throw Failure.changed }
                return (try parseDocument(path: token.path, bytes: bytes, preserveHistory: false), bytes)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw Failure.invalidPath }
        return try outcome.get()
    }
}
