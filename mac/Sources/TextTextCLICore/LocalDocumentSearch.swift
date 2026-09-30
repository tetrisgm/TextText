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
                           byteLimit: Int = 256 * 1024 * 1024, textpacksOnly: Bool = false) throws -> LocalDocumentSearchPage {
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
            let canonical = file.standardizedFileURL.resolvingSymlinksInPath().path
            guard canonical.hasPrefix(canonicalRoot.path + "/") else { continue }
            let path = String(canonical.dropFirst(canonicalRoot.path.count + 1))
            if path == "Data" { enumerator.skipDescendants(); continue }
            guard ["textpack", "textbundle", "md", "txt"].contains(file.pathExtension.lowercased()) else { continue }
            enumerator.skipDescendants()
            if textpacksOnly && file.pathExtension.lowercased() != "textpack" { continue }
            paths.append(path)
            if paths.count > scanLimit { truncated = true; break }
        }
        paths.sort()
        for path in paths.prefix(scanLimit) {
            let url = root.appendingPathComponent(path)
            let textURL = url.pathExtension.lowercased() == "textbundle" ? url.appendingPathComponent("text.md") : url
            guard textURL.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot.path + "/"), let values = try? textURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
                  values.isRegularFile == true, let size = values.fileSize else { skipped += 1; continue }
            let maximum = url.pathExtension.lowercased() == "textpack" ? 64 * 1024 * 1024 : 2 * 1024 * 1024
            guard size <= maximum else { skipped += 1; continue }
            guard remainingBytes >= size else { truncated = true; break }
            remainingBytes -= size
            scanned += 1
            let markdown: String
            let hash: String
            if url.pathExtension.lowercased() == "textpack" {
                guard let document = try? LocalVaultDocumentStore(root: root).searchText(path: path) else { skipped += 1; continue }
                markdown = document.markdown
                hash = document.hash
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
