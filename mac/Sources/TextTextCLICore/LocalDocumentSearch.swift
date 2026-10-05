import Foundation
import TextTextFileProviderKit

public struct LocalDocumentSearchPage: Sendable {
    public let items: [TextTextAgentSearchResult]
    public let truncated: Bool
    public let skippedCount: Int
    public let scannedCount: Int
}

extension DocumentStore {
    /// Search on demand, reading one pack at a time. There is no background
    /// index or network request. Bounds keep a search from loading a whole vault.
    public func search(_ query: String) throws -> [TextTextAgentSearchResult] {
        try searchPage(query).items
    }

    public func searchPage(_ query: String, limit: Int = 100, scanLimit: Int = 5_000,
                           byteLimit: Int = 256 * 1024 * 1024, textpacksOnly: Bool = false,
                           folderPrefix: String? = nil) throws -> LocalDocumentSearchPage {
        let terms = query.prefix(1024).split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return .init(items: [], truncated: false, skippedCount: 0, scannedCount: 0) }
        let limit = min(100, max(1, limit))
        let scanLimit = min(5_000, max(1, scanLimit))
        var skipped = 0
        var scanned = 0
        var truncated = query.count > 1024
        var results: [TextTextAgentSearchResult] = []
        var remainingBytes = min(256 * 1024 * 1024, max(0, byteLimit))
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let searchCache = LocalDocumentSearchCache.shared
        guard let enumerator = FileManager.default.enumerator(at: canonicalRoot,
            includingPropertiesForKeys: [.isSymbolicLinkKey], options: [.skipsHiddenFiles]) else {
            throw TextTextCLIError.workspaceNotFound
        }
        var paths: [String] = []
        var visited = 0
        for case let file as URL in enumerator {
            visited += 1
            if visited > 20_000 { truncated = true; break }
            if (try? file.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
                enumerator.skipDescendants(); continue
            }
            let standardizedPath = file.standardizedFileURL.path
            guard standardizedPath.hasPrefix(canonicalRoot.path + "/") else { continue }
            let path = String(standardizedPath.dropFirst(canonicalRoot.path.count + 1))
            if path == "Data" { enumerator.skipDescendants(); continue }
            if let folderPrefix, !path.hasPrefix(folderPrefix) { continue }
            guard ["textpack", "textbundle", "md", "txt"].contains(file.pathExtension.lowercased()) else { continue }
            // A TextBundle is a directory package. The other supported
            // formats are regular files; calling skipDescendants for one can
            // skip a following sibling directory on Foundation's enumerator.
            if file.pathExtension.lowercased() == "textbundle" {
                enumerator.skipDescendants()
            }
            if textpacksOnly && file.pathExtension.lowercased() != "textpack" { continue }
            paths.append(path)
            if paths.count > scanLimit { truncated = true; break }
        }
        paths.sort()
        var validatedParent: String?
        var validatedParentIsSafe = false
        for path in paths.prefix(scanLimit) {
            let url = root.appendingPathComponent(path)
            let fileExtension = url.pathExtension.lowercased()
            let isTextPack = fileExtension == "textpack"
            let textURL = fileExtension == "textbundle" ? url.appendingPathComponent("text.md") : url
            let cacheURL = canonicalRoot.appendingPathComponent(path)
            let fingerprint: LocalDocumentSearchCache.Fingerprint?
            let size: Int
            if isTextPack {
                let parentPath = (path as NSString).deletingLastPathComponent
                if validatedParent != parentPath {
                    validatedParent = parentPath
                    let parentURL = parentPath.isEmpty ? canonicalRoot : canonicalRoot.appendingPathComponent(parentPath, isDirectory: true)
                    let standardizedParent = parentURL.standardizedFileURL.path
                    let resolvedParent = parentURL.standardizedFileURL.resolvingSymlinksInPath().path
                    validatedParentIsSafe = resolvedParent == standardizedParent
                        && (resolvedParent == canonicalRoot.path || resolvedParent.hasPrefix(canonicalRoot.path + "/"))
                }
                guard validatedParentIsSafe else { skipped += 1; continue }
                guard let current = LocalDocumentSearchCache.Fingerprint.read(from: cacheURL),
                      current.size >= 0, current.size <= Int64(Int.max) else { skipped += 1; continue }
                fingerprint = current
                size = Int(current.size)
            } else {
                guard textURL.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot.path + "/") else { skipped += 1; continue }
                guard let values = try? textURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
                      values.isRegularFile == true, let currentSize = values.fileSize else { skipped += 1; continue }
                fingerprint = nil
                size = currentSize
            }
            let maximum = isTextPack ? 64 * 1024 * 1024 : 2 * 1024 * 1024
            guard size <= maximum else { skipped += 1; continue }
            guard remainingBytes >= size else { truncated = true; break }
            remainingBytes -= size
            scanned += 1
            let markdown: String
            let hash: String
            if isTextPack {
                guard let fingerprint else { skipped += 1; continue }
                let cacheKey = LocalDocumentSearchCache.Key(root: canonicalRoot.path, path: path)
                if let cached = searchCache.content(for: cacheKey, matching: fingerprint) {
                    markdown = cached.markdown
                    hash = cached.hash
                } else {
                    guard let document = try? LocalVaultDocumentStore(root: root).searchText(path: path) else { skipped += 1; continue }
                    markdown = document.markdown
                    hash = document.hash
                    if LocalDocumentSearchCache.Fingerprint.read(from: cacheURL) == fingerprint {
                        searchCache.insert(.init(markdown: markdown, hash: hash), for: cacheKey, fingerprint: fingerprint)
                    }
                }
            } else {
                guard let handle = try? FileHandle(forReadingFrom: textURL) else { skipped += 1; continue }
                defer { try? handle.close() }
                guard let bytes = try? handle.read(upToCount: 2 * 1024 * 1024 + 1), bytes.count <= 2 * 1024 * 1024,
                      let content = String(data: bytes, encoding: .utf8) else { skipped += 1; continue }
                markdown = content
                hash = TextTextStableDigest.sha256Hex(Data(content.utf8))
            }
            let searchable = path + "\n" + markdown
            guard terms.allSatisfy({ searchable.localizedStandardContains($0) }) else { continue }
            var fields: [String: String] = [:]
            var body = markdown
            if markdown.hasPrefix("---\n"), let end = markdown.range(of: "\n---", range: markdown.index(markdown.startIndex, offsetBy: 4)..<markdown.endIndex) {
                for line in markdown[..<end.lowerBound].split(separator: "\n").dropFirst() {
                    guard let colon = line.firstIndex(of: ":") else { continue }
                    let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
                    let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
                    fields[key] = (try? JSONDecoder().decode(String.self, from: Data(value.utf8))) ?? value
                }
                body = String(markdown[end.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let lines = body.split(separator: "\n").map(String.init)
            let snippet = lines.first { line in terms.contains { line.localizedStandardContains($0) } } ?? lines.first ?? ""
            let folder = (path as NSString).deletingLastPathComponent
            results.append(.init(
                id: path, slug: path,
                title: String((fields["title"] ?? url.deletingPathExtension().lastPathComponent).prefix(300)),
                kind: String((fields["kind"] ?? "note").prefix(50)), status: String((fields["status"] ?? "draft").prefix(50)),
                hash: hash, snippet: String(snippet.prefix(240)),
                folderPath: folder.isEmpty ? nil : folder))
            if results.count > limit { truncated = true; break }
        }
        return .init(items: Array(results.prefix(limit)), truncated: truncated,
                     skippedCount: skipped, scannedCount: scanned)
    }
}
