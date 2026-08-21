import Foundation

/// One capture interpretation shared by the app and bundled CLI. A lone URL
/// is a bookmark; all other non-empty text is a note. Keeping this decision in
/// the transport-neutral kit prevents capture behavior from drifting between
/// native shortcuts and agent commands.
public struct TextTextCaptureIntent: Equatable, Sendable {
    public let title: String
    public let body: String
    public let folder: String
    public let kind: String
    public let sourceURL: String?

    public init?(value: String) {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }

        if let source = Self.httpURL(clean) {
            let host = source.host?.replacingOccurrences(
                of: "^www\\.", with: "", options: .regularExpression)
            let label = host?.isEmpty == false ? host! : "Saved link"
            title = label
            body = "[\(label)](\(source.absoluteString))"
            folder = "bookmarks"
            kind = "bookmark"
            sourceURL = source.absoluteString
            return
        }

        let lines = clean.components(separatedBy: .newlines)
        let content = lines.filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard let first = content.first else { return nil }
        title = Self.title(from: lines) ?? Self.cappedTitle(first)
        body = lines.count > 1 ? clean : ""
        folder = "notes"
        kind = "note"
        sourceURL = nil
    }

    private static func httpURL(_ value: String) -> URL? {
        guard !value.contains(where: { $0.isWhitespace }) else { return nil }
        let lower = value.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://")
            && !value.contains(".")
        {
            return nil
        }
        for candidate in [value, "https://\(value)"] {
            guard let url = URL(string: candidate),
                let scheme = url.scheme?.lowercased(),
                scheme == "http" || scheme == "https",
                url.host?.isEmpty == false
            else { continue }
            return url
        }
        return nil
    }

    private static func title(from lines: [String]) -> String? {
        let roles = ["user:", "human:", "prompt:"]
        for (index, raw) in lines.enumerated() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            let lower = line.lowercased()
            guard let role = roles.first(where: { lower.hasPrefix($0) }) else {
                continue
            }
            let inline = String(line.dropFirst(role.count))
                .trimmingCharacters(in: .whitespaces)
            if !inline.isEmpty { return cappedTitle(inline) }
            if let next = lines.dropFirst(index + 1).first(where: {
                !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }) {
                return cappedTitle(next)
            }
        }
        return nil
    }

    private static func cappedTitle(_ value: String) -> String {
        var clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        while clean.first == "#" { clean.removeFirst() }
        clean = clean.trimmingCharacters(in: .whitespaces)
        clean = clean.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard clean.count > 120 else { return clean }
        return String(clean.prefix(117)).trimmingCharacters(in: .whitespaces) + "..."
    }
}
