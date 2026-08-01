import Foundation
import TextTextFileProviderKit
import TextTextShareCore

enum InboxFilerError: LocalizedError, Equatable {
    case missingURL
    case invalidURL(String)
    case missingAppendTarget

    var errorDescription: String? {
        switch self {
        case .missingURL:
            return "The shared item did not include a URL"
        case .invalidURL(let value):
            return "The shared URL is invalid: \(value)"
        case .missingAppendTarget:
            return "Append requires a target TextText document id"
        }
    }
}

/// What a shared inbox record becomes once prepared for server-side filing. The
/// File Provider extension is the sole writer now, so InboxFiler never touches
/// the mirror: it renders the markdown/append text and the caller (AppDelegate)
/// creates the item through the sync API, letting the server assign the id and
/// slug and the File Provider materialize the result.
enum PreparedInboxItem: Equatable {
    /// Create a new document in the folder whose server mode is `folderMode`.
    /// `body` is the full markdown to POST, with NO injected identity (the
    /// server assigns the id). `idempotencyKey` makes a retried POST return the
    /// original item instead of duplicating.
    case create(
        folderMode: String, body: String,
        representation: TextTextFileRepresentation, idempotencyKey: String)
    /// Append `text` to the existing server document `targetTextTextId`.
    case append(targetTextTextId: String, text: String)
    /// Nothing to file (kind has no server home post-cutover); drain quietly.
    case unsupported(reason: String)
}

final class InboxFiler {
    private let now: () -> Date

    init(now: @escaping () -> Date = { Date() }) {
        self.now = now
    }

    /// Turn a shared record into a server-side action. Reuses the render/format
    /// helpers but writes nothing to disk and injects no identity.
    func prepare(_ record: InboxRecord) throws -> PreparedInboxItem {
        let item = record.item
        let idempotencyKey = "share-inbox:\(record.id)"
        switch item.kind {
        case .note:
            return .create(
                folderMode: "notes",
                body: renderCreateMarkdown(
                    title: derivedTitle(for: item, fallback: "Untitled Note"),
                    body: normalizedBody(item.text),
                    kind: "note",
                    extraFrontMatter: [:],
                    rawFrontMatterLines: []),
                representation: .textpack,
                idempotencyKey: idempotencyKey)
        case .bookmark:
            return try prepareBookmark(item, idempotencyKey: idempotencyKey)
        case .draft:
            return .create(
                folderMode: "blog",
                body: renderCreateMarkdown(
                    title: derivedTitle(for: item, fallback: "Untitled Draft"),
                    body: normalizedBody(item.text),
                    kind: "article",
                    extraFrontMatter: [:],
                    rawFrontMatterLines: []),
                representation: .textpack,
                idempotencyKey: idempotencyKey)
        case .append:
            guard let targetTextTextId = item.targetTextTextId?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                  !targetTextTextId.isEmpty else {
                throw InboxFilerError.missingAppendTarget
            }
            return .append(
                targetTextTextId: targetTextTextId, text: normalizedBody(item.text))
        case .file:
            // .file shares had no server home even in the legacy path
            // (savePayload never synced them); drain them with a clear note.
            return .unsupported(reason: "Shared files are not synced")
        }
    }

    private func prepareBookmark(
        _ item: InboxItem, idempotencyKey: String
    ) throws -> PreparedInboxItem {
        guard let rawURL = item.urlString?
            .trimmingCharacters(in: .whitespacesAndNewlines), !rawURL.isEmpty else {
            throw InboxFilerError.missingURL
        }
        guard URL(string: rawURL) != nil else {
            throw InboxFilerError.invalidURL(rawURL)
        }
        let date = now()
        let dateText = isoString(date)
        let title = derivedTitle(for: item, fallback: URL(string: rawURL)?.host ?? rawURL)
        // The server keeps a bookmark's URL only in the `links:` list; a bare
        // `url:` scalar is an unknown key it silently drops, which would sync the
        // bookmark with no link. Emit the links list the server round-trips
        // (flow JSON, matching its own JSON.stringify render, which does not
        // escape forward slashes so the hashes agree). Rendered VERBATIM.
        let linksJSON = "[{\"label\":\(jsonStringNoSlashEscape(title)),\"href\":\(jsonStringNoSlashEscape(rawURL))}]"
        return .create(
            folderMode: "bookmarks",
            body: renderCreateMarkdown(
                title: title,
                body: normalizedBody(item.text),
                kind: "bookmark",
                extraFrontMatter: [
                    "type": "bookmark",
                    "created_at": dateText,
                ],
                rawFrontMatterLines: ["links: \(linksJSON)"]),
            representation: .textpack,
            idempotencyKey: idempotencyKey)
    }

    /// Render a full markdown file for a server create: the same shape as the
    /// legacy mirror write, but WITHOUT MarkdownIdentityCodec.inject (no id) and
    /// WITHOUT a local slug reservation (the server owns the slug).
    private func renderCreateMarkdown(
        title: String,
        body: String,
        kind: String,
        extraFrontMatter: [String: String],
        rawFrontMatterLines: [String]
    ) -> String {
        let date = isoString(now())
        return renderMarkdown(
            title: title,
            slug: slugForTitle(title),
            kind: kind,
            status: "draft",
            createdAt: date,
            updatedAt: date,
            extraFrontMatter: extraFrontMatter,
            rawFrontMatterLines: rawFrontMatterLines,
            body: body)
    }

    private func renderMarkdown(
        title: String,
        slug: String,
        kind: String,
        status: String,
        createdAt: String,
        updatedAt: String,
        extraFrontMatter: [String: String],
        rawFrontMatterLines: [String] = [],
        body: String
    ) -> String {
        var lines = [
            "---",
            "title: \(jsonString(title))",
            "slug: \(jsonString(slug))",
            "kind: \(jsonString(kind))",
            "status: \(jsonString(status))",
            "created_at: \(jsonString(createdAt))",
            "updated_at: \(jsonString(updatedAt))",
        ]
        for key in extraFrontMatter.keys.sorted() {
            if let value = extraFrontMatter[key] {
                lines.append("\(key): \(jsonString(value))")
            }
        }
        lines.append(contentsOf: rawFrontMatterLines)
        lines.append("---")
        lines.append("")
        lines.append(body)
        if !body.hasSuffix("\n") { lines.append("") }
        return lines.joined(separator: "\n")
    }

    private func normalizedBody(_ raw: String?) -> String {
        let body = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return body.isEmpty ? "" : body + "\n"
    }

    private func derivedTitle(for item: InboxItem, fallback: String) -> String {
        if let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }
        if let filename = item.payloadFilename?.trimmingCharacters(in: .whitespacesAndNewlines), !filename.isEmpty {
            return (filename as NSString).deletingPathExtension
        }
        if let rawURL = item.urlString, let url = URL(string: rawURL) {
            return url.host ?? rawURL
        }
        return fallback
    }

    private func slugForTitle(_ title: String) -> String {
        let folded = title.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        var output = ""
        var previousDash = false
        for scalar in folded.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                output.append(Character(scalar).lowercased())
                previousDash = false
            } else if !previousDash {
                output.append("-")
                previousDash = true
            }
        }
        let cleaned = output.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return cleaned.isEmpty ? "untitled" : String(cleaned.prefix(80))
    }

    private func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }

    private func jsonStringNoSlashEscape(_ value: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return jsonString(value)
        }
        return text
    }
}
