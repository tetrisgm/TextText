import Foundation
import TextTextFileProviderKit

extension DocumentStore {
    /// Search on demand, reading one pack at a time. There is no background
    /// index or network request. Bounds keep a search from loading a whole vault.
    public func search(_ query: String) throws -> [TextTextAgentSearchResult] {
        let terms = query.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return [] }
        var results: [TextTextAgentSearchResult] = []
        var remainingBytes = 256 * 1024 * 1024
        for path in try list(limit: 5_000) {
            let url = root.appendingPathComponent(path)
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= 64 * 1024 * 1024 else { continue }
            guard remainingBytes >= size else { break }
            remainingBytes -= size
            let markdown: String
            let hash: String
            if url.pathExtension.lowercased() == "textpack" {
                guard let document = try? LocalVaultDocumentStore(root: root).read(path: path) else { continue }
                markdown = document.contents.markdown
                hash = document.hash
            } else {
                guard let content = try? readMarkdown(at: url) else { continue }
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
                title: fields["title"] ?? url.deletingPathExtension().lastPathComponent,
                kind: fields["kind"] ?? "note", status: fields["status"] ?? "draft",
                hash: hash, snippet: String(snippet.prefix(240)),
                folderPath: folder.isEmpty ? nil : folder))
            if results.count >= 100 { break }
        }
        return results
    }
}
