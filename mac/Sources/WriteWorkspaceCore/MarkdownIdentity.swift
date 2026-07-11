import CryptoKit
import Foundation

public struct MarkdownIdentity: Equatable {
    public var itemId: String
    public var folderId: String?
    public var kind: String?

    public init(itemId: String, folderId: String? = nil, kind: String? = nil) {
        self.itemId = itemId
        self.folderId = folderId
        self.kind = kind
    }
}

public enum MarkdownIdentityCodec {
    public static let itemIdKey = "writeId"
    public static let folderIdKey = "writeFolderId"
    public static let kindKey = "writeKind"

    public static func inject(
        into text: String,
        itemId: String,
        folderId: String?,
        kind: String?
    ) -> String {
        let cleaned = strip(from: text)
        let identityLines = renderedIdentityLines(itemId: itemId, folderId: folderId, kind: kind)
        guard let split = splitFrontmatter(cleaned) else {
            return "---\n\(identityLines)---\n\n\(cleaned)"
        }

        let frontmatter = split.frontmatter
        var insertAt = frontmatter.startIndex
        if let firstBreak = frontmatter.firstIndex(of: "\n") {
            insertAt = frontmatter.index(after: firstBreak)
        }
        return String(frontmatter[..<insertAt])
            + identityLines
            + String(frontmatter[insertAt...])
            + split.bodyWithDelimiter
    }

    public static func strip(from text: String) -> String {
        guard let split = splitFrontmatter(text) else { return text }
        let lines = split.frontmatter.split(separator: "\n", omittingEmptySubsequences: false)
        let kept = lines.filter { line in
            guard let key = key(in: String(line)) else { return true }
            return !identityKeys.contains(key)
        }
        return kept.joined(separator: "\n") + split.bodyWithDelimiter
    }

    public static func extract(from text: String) -> MarkdownIdentity? {
        guard let split = splitFrontmatter(text) else { return nil }
        var itemId: String?
        var folderId: String?
        var kind: String?
        for rawLine in split.frontmatter.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            guard let key = key(in: line), identityKeys.contains(key) else { continue }
            let rawValue = line.dropFirst(key.count + 1).trimmingCharacters(in: .whitespaces)
            let value = parseValue(rawValue)
            switch key {
            case itemIdKey: itemId = value
            case folderIdKey: folderId = value
            case kindKey: kind = value
            default: break
            }
        }
        guard let itemId, !itemId.isEmpty else { return nil }
        return MarkdownIdentity(itemId: itemId, folderId: folderId, kind: kind)
    }

    public static func syncHash(for data: Data) -> String {
        let stripped: Data
        if let text = String(data: data, encoding: .utf8) {
            stripped = Data(strip(from: text).utf8)
        } else {
            stripped = data
        }
        return SHA256.hash(data: stripped).map { String(format: "%02x", $0) }.joined()
    }

    public static func syncHash(for text: String) -> String {
        syncHash(for: Data(text.utf8))
    }

    private static let identityKeys: Set<String> = [itemIdKey, folderIdKey, kindKey]

    private static func renderedIdentityLines(itemId: String, folderId: String?, kind: String?) -> String {
        var lines = ["\(itemIdKey): \(jsonString(itemId))"]
        if let folderId, !folderId.isEmpty { lines.append("\(folderIdKey): \(jsonString(folderId))") }
        if let kind, !kind.isEmpty { lines.append("\(kindKey): \(jsonString(kind))") }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func splitFrontmatter(_ text: String) -> (frontmatter: String, bodyWithDelimiter: String)? {
        let normalizedStart = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        guard normalizedStart.hasPrefix("---\n") || normalizedStart.hasPrefix("---\r\n") else { return nil }
        guard let firstBreak = normalizedStart.firstIndex(of: "\n") else { return nil }
        var cursor = normalizedStart.index(after: firstBreak)
        while cursor <= normalizedStart.endIndex {
            guard let nextBreak = normalizedStart[cursor...].firstIndex(of: "\n") else { break }
            let rawLine = normalizedStart[cursor..<nextBreak]
            let line = rawLine.last == "\r" ? rawLine.dropLast() : rawLine[...]
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                let bodyStart = normalizedStart.index(after: nextBreak)
                return (
                    frontmatter: String(normalizedStart[..<cursor]),
                    bodyWithDelimiter: String(normalizedStart[cursor..<bodyStart]) + String(normalizedStart[bodyStart...])
                )
            }
            cursor = normalizedStart.index(after: nextBreak)
        }
        return nil
    }

    private static func key(in line: String) -> String? {
        guard let colon = line.firstIndex(of: ":") else { return nil }
        let key = line[..<colon].trimmingCharacters(in: .whitespaces)
        guard key.range(of: "^[A-Za-z][A-Za-z0-9_-]*$", options: .regularExpression) != nil else {
            return nil
        }
        return key
    }

    private static func parseValue(_ raw: String) -> String {
        if let data = raw.data(using: .utf8),
           let value = try? JSONSerialization.jsonObject(with: data) as? String {
            return value
        }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }

    private static func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }
}
