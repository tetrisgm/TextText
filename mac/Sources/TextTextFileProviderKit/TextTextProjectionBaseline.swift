import Foundation

/// Projection provenance for one TextPack, mirroring
/// `src/lib/documents/projection-baseline.ts`. The sidecar records the last
/// coherent `document.json` + `text.md` pair a writer produced: the document
/// itself plus the SHA-256 of the exact bytes written beside it. Reconcilers
/// compare the current entries with those digests to learn which
/// representation moved since. It is recovery metadata, never a second
/// authority: a missing or invalid sidecar leaves the pack's ambiguity intact.
///
/// Native writers rewrite asset URLs before writing, so the digests are always
/// computed over the final local bytes here, not copied from a caller.
public enum TextTextProjectionBaseline {
    public static let entryName = "net.texttext.projection.json"
    public static let version = 1

    /// The authored body exactly as vault writers emit it: one separator line
    /// after the frontmatter, then the body byte for byte.
    static func body(ofMarkdown markdown: String) -> String? {
        let text = markdown.hasPrefix("\u{FEFF}") ? String(markdown.dropFirst()) : markdown
        guard let regex = try? NSRegularExpression(pattern: "^---\\r?\\n[\\s\\S]*?\\r?\\n---[ \\t]*\\r?\\n(?:\\r?\\n)?"),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range, in: text) else { return nil }
        return String(text[range.upperBound...])
    }

    /// The frontmatter block without its delimiters, nil without frontmatter.
    static func frontmatter(ofMarkdown markdown: String) -> String? {
        let text = markdown.hasPrefix("\u{FEFF}") ? String(markdown.dropFirst()) : markdown
        guard let regex = try? NSRegularExpression(pattern: "^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:[ \\t]*\\r?\\n|$)"),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    /// Whether the Markdown is a faithful projection of the snapshot: the body
    /// matches byte for byte and overlaying the frontmatter (and a leading
    /// `######` subtitle) the way the shared `mergeMarkdownIntoDocument` does
    /// leaves the document unchanged. Mirrors `coherentProjection` in
    /// `projection-baseline.ts`; a frontmatter line the shared parser would
    /// refuse refuses the stamp here too.
    static func isCoherent(markdown: String, snapshot: [String: Any]) -> Bool {
        guard snapshot["schemaVersion"] as? Int == 1,
              let content = snapshot["content"] as? [String: Any],
              content["title"] is String,
              let documentBody = content["body"] as? String,
              content["fields"] == nil || content["fields"] is [String: Any],
              content["tags"] == nil || content["tags"] is [String],
              content["assets"] == nil || content["assets"] is [[String: Any]],
              let presentation = snapshot["presentation"] as? [String: Any],
              presentation["template"] is [String: Any],
              presentation["theme"] == nil || presentation["theme"] is [String: Any],
              let markdownBody = body(ofMarkdown: markdown),
              markdownBody == documentBody,
              let header = frontmatter(ofMarkdown: markdown),
              let parsed = try? MarkdownProjection.parse(frontmatter: header, body: markdownBody) else { return false }
        let normalized = MarkdownProjection.normalized(snapshot)
        guard let overlaid = try? MarkdownProjection.overlay(parsed, onto: normalized) else { return false }
        return MarkdownProjection.jsonEqual(overlaid, normalized)
    }

    /// Sidecar bytes for a pair the caller asserts coherent. The assertion is
    /// checked the way the app checks it: the document must be a schema-1
    /// snapshot that the Markdown projects faithfully. Nil otherwise, so an
    /// incoherent pair is never stamped.
    public static func stamp(itemId: String, markdown: Data, documentJSON: Data) -> Data? {
        guard !itemId.isEmpty, itemId.utf8.count <= 128,
              let markdownText = String(data: markdown, encoding: .utf8),
              let snapshot = try? JSONSerialization.jsonObject(with: documentJSON) as? [String: Any],
              isCoherent(markdown: markdownText, snapshot: snapshot) else { return nil }
        let baseline: [String: Any] = [
            "version": version, "itemId": itemId,
            "markdownSha256": TextTextStableDigest.sha256Hex(markdown),
            "documentSha256": TextTextStableDigest.sha256Hex(documentJSON),
            "document": snapshot,
        ]
        guard var data = try? JSONSerialization.data(withJSONObject: baseline, options: [.sortedKeys, .withoutEscapingSlashes]) else { return nil }
        data.append(0x0A)
        return data
    }
}

/// The frontmatter grammar and overlay of `src/lib/markdown-files.ts`
/// (`parsePostMarkdownFile`) and `src/lib/documents/sync.ts`
/// (`mergeMarkdownIntoDocument`), ported key for key. Only what the overlay
/// maps onto a snapshot is kept; keys the parser validates but the overlay
/// ignores (slug, kind, status, date, pinned) are still validated so that a
/// line the app would refuse refuses the stamp as well.
enum MarkdownProjection {
    struct Unsupported: Error {}

    private static let lineRegex = try! NSRegularExpression(pattern: "^([A-Za-z][A-Za-z0-9_-]*):\\s?(.*)$")
    private static let postTypes: Set<String> = ["article", "project", "talk", "note", "bookmark", "media_post", "video_post"]
    private static let maxTags = 24
    private static let maxTagLength = 48

    /// `parseScalar`: a JSON value when the line holds one, else the raw text.
    private static func scalar(_ raw: String) -> Any {
        guard let data = raw.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return raw }
        return value
    }

    private static func isBool(_ value: Any) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    /// `fieldText`: text, trimmed; anything else is refused.
    private static func text(_ value: Any) throws -> String {
        guard let string = value as? String else { throw Unsupported() }
        return string.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `fieldOptionalText`: nil for a missing or null value, nil again for
    /// empty text, refused for a non-string.
    private static func optionalText(_ value: Any?) throws -> String? {
        guard let value, !(value is NSNull) else { return nil }
        let string = try text(value)
        return string.isEmpty ? nil : string
    }

    /// `isSafeLinkHref` in `src/lib/content.ts`.
    static func isSafeLinkHref(_ value: String) -> Bool {
        if value.unicodeScalars.contains(where: { $0.value <= 31 || $0.value == 127 }) { return false }
        let href = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if href.isEmpty { return false }
        if href.hasPrefix("/") || href.hasPrefix("#") { return true }
        guard let match = href.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*:", options: .regularExpression) else { return true }
        let scheme = String(href[match]).dropLast().lowercased()
        return ["http", "https", "mailto"].contains(scheme)
    }

    /// `normalizeTags` in `src/lib/tags.ts`.
    static func normalizeTags(_ raw: Any) -> [String] {
        let values: [Any] = (raw as? [Any]) ?? ((raw as? String)?.components(separatedBy: ",") ?? [])
        var tags: [String] = [], seen = Set<String>()
        for value in values {
            guard let string = value as? String else { continue }
            var tag = string.trimmingCharacters(in: .whitespacesAndNewlines)
            tag = tag.replacingOccurrences(of: "^#+", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .lowercased()
            // `slice(0, MAX_TAG_LENGTH)` counts UTF-16 units, as JavaScript does.
            tag = String(decoding: Array(tag.utf16.prefix(maxTagLength)), as: UTF16.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if tag.isEmpty || seen.contains(tag) { continue }
            seen.insert(tag); tags.append(tag)
            if tags.count >= maxTags { break }
        }
        return tags
    }

    /// `markdownSubtitle` in `src/lib/markdown-subtitle.ts`: the first
    /// non-blank line when it is an H6, as plain text.
    static func subtitle(ofBody body: String) -> String {
        for rawLine in body.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : String(rawLine)
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            guard let regex = try? NSRegularExpression(pattern: "^ {0,3}######(?:[ \\t]+(.*?))?[ \\t]*$"),
                  let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else { return "" }
            var heading = Range(match.range(at: 1), in: line).map { String(line[$0]) } ?? ""
            heading = heading.replacingOccurrences(of: "[ \\t]+#+[ \\t]*$", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return inlineText(heading)
        }
        return ""
    }

    private static func inlineText(_ markdown: String) -> String {
        let steps: [(String, String)] = [
            ("!\\[([^\\]]*)\\]\\([^)]*\\)", "$1"),
            ("\\[([^\\]]+)\\]\\([^)]*\\)", "$1"),
            ("`([^`]+)`", "$1"),
            ("\\\\([\\\\`*{}\\[\\]()#+\\-.!_>~])", "$1"),
            ("[*_~]", ""),
            ("<[^>]+>", ""),
            ("\\s+", " "),
        ]
        var text = markdown
        for (pattern, template) in steps {
            text = text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `parsePostMarkdownFile` for the keys the overlay maps. Presence in the
    /// result means "the file says so", exactly as `hasOwn(parsed, key)` does.
    static func parse(frontmatter: String, body: String) throws -> [String: Any] {
        var fields: [String: Any] = [:]
        for rawLine in frontmatter.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : String(rawLine)
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            guard let match = lineRegex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
                  let keyRange = Range(match.range(at: 1), in: line),
                  let rawRange = Range(match.range(at: 2), in: line) else { throw Unsupported() }
            let key = String(line[keyRange])
            let raw = line[rawRange].trimmingCharacters(in: .whitespacesAndNewlines)
            if raw.isEmpty { continue }
            let value = scalar(raw)
            switch key {
            case "title", "excerpt", "cover", "coverCaption", "videoUrl", "venue", "duration":
                let string = try text(value)
                if !string.isEmpty { fields[key] = string }
            case "slug":
                _ = try text(value)
            case "kind", "type":
                guard let string = value as? String, postTypes.contains(string.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw Unsupported() }
            case "status":
                guard let string = value as? String, string == "draft" || string == "published" else { throw Unsupported() }
            case "date":
                let string = try text(value)
                let iso = ISO8601DateFormatter(), fractional = ISO8601DateFormatter()
                fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let dayOnly = string.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil
                guard dayOnly || iso.date(from: string) != nil || fractional.date(from: string) != nil else { throw Unsupported() }
            case "accent":
                let string = try text(value)
                guard string.isEmpty || string.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { throw Unsupported() }
                fields["accent"] = string
            case "coverHeight":
                guard let number = value as? NSNumber, !isBool(value), number.doubleValue.isFinite else { throw Unsupported() }
                // JavaScript Math.round: halves round toward positive infinity.
                let floor = number.doubleValue.rounded(.down)
                fields["coverHeight"] = floor + (number.doubleValue - floor >= 0.5 ? 1 : 0)
            case "pinned", "starred":
                guard isBool(value) else { throw Unsupported() }
            case "gallery":
                guard let list = value as? [Any] else { throw Unsupported() }
                fields["gallery"] = try list.map { entry -> [String: String] in
                    guard let values = entry as? [String: Any] else { throw Unsupported() }
                    guard let src = try optionalText(values["src"]) else { throw Unsupported() }
                    var item = ["src": src]
                    if let caption = try optionalText(values["caption"]) { item["caption"] = caption }
                    if let poster = try optionalText(values["poster"]) { item["poster"] = poster }
                    return item
                }
            case "links":
                guard let list = value as? [Any] else { throw Unsupported() }
                fields["links"] = try list.map { entry -> [String: String] in
                    guard let values = entry as? [String: Any] else { throw Unsupported() }
                    guard let href = try optionalText(values["href"]), isSafeLinkHref(href) else { throw Unsupported() }
                    let label = try optionalText(values["label"])
                    return ["href": href, "label": label ?? href]
                }
            case "tags":
                guard value is String || value is [Any] else { throw Unsupported() }
                fields["tags"] = normalizeTags(value)
            default:
                continue
            }
        }
        let subtitle = subtitle(ofBody: body)
        if !subtitle.isEmpty { fields["excerpt"] = subtitle }
        return fields
    }

    /// The schema defaults `validateDocumentSnapshot` applies, so a snapshot
    /// written without an empty list compares equal to its validated form.
    static func normalized(_ snapshot: [String: Any]) -> [String: Any] {
        var result = snapshot
        var content = snapshot["content"] as? [String: Any] ?? [:]
        if content["fields"] == nil { content["fields"] = [String: Any]() }
        if content["tags"] == nil { content["tags"] = [String]() }
        if content["assets"] == nil { content["assets"] = [[String: Any]]() }
        result["content"] = content
        var presentation = snapshot["presentation"] as? [String: Any] ?? [:]
        if presentation["theme"] == nil { presentation["theme"] = [String: Any]() }
        result["presentation"] = presentation
        return result
    }

    /// `mergeMarkdownIntoDocument`, minus the body (already compared).
    static func overlay(_ parsed: [String: Any], onto snapshot: [String: Any]) throws -> [String: Any] {
        var document = snapshot
        var content = snapshot["content"] as? [String: Any] ?? [:]
        var fields = content["fields"] as? [String: Any] ?? [:]
        var presentation = snapshot["presentation"] as? [String: Any] ?? [:]
        var theme = presentation["theme"] as? [String: Any] ?? [:]

        for key in ["cover", "coverCaption", "coverHeight", "videoUrl", "venue", "duration"] where parsed[key] != nil {
            fields[key] = parsed[key]
        }
        if let links = parsed["links"] as? [[String: String]] {
            // setSourceFields: the first link's parts, then the whole list.
            if let href = links.first?["href"] { fields["sourceUrl"] = href } else { fields.removeValue(forKey: "sourceUrl") }
            if let label = links.first?["label"] { fields["sourceLabel"] = label } else { fields.removeValue(forKey: "sourceLabel") }
            if links.isEmpty { fields.removeValue(forKey: "links") } else { fields["links"] = links }
        }
        if let accent = parsed["accent"] as? String {
            if accent.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil { theme["accent"] = accent } else { theme.removeValue(forKey: "accent") }
        }
        if let title = parsed["title"] as? String { content["title"] = title }
        if let excerpt = parsed["excerpt"] as? String {
            if excerpt.isEmpty { content.removeValue(forKey: "subtitle") } else { content["subtitle"] = excerpt }
        }
        if let tags = parsed["tags"] as? [String] { content["tags"] = tags }
        if let gallery = parsed["gallery"] as? [[String: String]] {
            content["assets"] = assets(fromGallery: gallery, existing: content["assets"] as? [[String: Any]] ?? [])
        }
        content["fields"] = fields
        presentation["theme"] = theme
        document["content"] = content
        document["presentation"] = presentation
        return document
    }

    /// `assetsFromGallery`: the file's list merged onto the assets the
    /// document already holds, matched by address first, then by position.
    static func assets(fromGallery gallery: [[String: String]], existing: [[String: Any]]) -> [[String: Any]] {
        var bySrc: [String: [String: Any]] = [:]
        for asset in existing { if let src = asset["src"] as? String { bySrc[src] = asset } }
        return gallery.enumerated().map { index, item in
            let src = item["src"] ?? ""
            let positional = index < existing.count && existing[index]["src"] as? String == src ? existing[index] : nil
            let kept = bySrc[src] ?? positional
            var asset = kept ?? [:]
            asset["id"] = kept?["id"] ?? "gallery-\(index + 1)"
            let isVideo = src.range(of: "\\.(?:mp4|webm|mov|m4v|ogv|ogg)(?:[?#].*)?$", options: [.regularExpression, .caseInsensitive]) != nil
            asset["kind"] = kept?["kind"] ?? (isVideo ? "video" : "image")
            asset["src"] = src
            if let caption = item["caption"] { asset["caption"] = caption } else { asset.removeValue(forKey: "caption") }
            if let poster = item["poster"] ?? kept?["poster"] { asset["poster"] = poster } else { asset.removeValue(forKey: "poster") }
            return asset
        }
    }

    /// Structural JSON equality, mirroring the canonical comparison in
    /// `coherentProjection`: numbers compare by value, booleans only to
    /// booleans.
    static func jsonEqual(_ lhs: Any, _ rhs: Any) -> Bool {
        switch (lhs, rhs) {
        case let (l as [String: Any], r as [String: Any]):
            return l.count == r.count && l.allSatisfy { key, value in r[key].map { jsonEqual(value, $0) } ?? false }
        case let (l as [Any], r as [Any]):
            return l.count == r.count && zip(l, r).allSatisfy { jsonEqual($0, $1) }
        case let (l as String, r as String):
            return l == r
        case (is NSNull, is NSNull):
            return true
        case let (l as NSNumber, r as NSNumber):
            guard isBool(l) == isBool(r) else { return false }
            return l == r
        default:
            return false
        }
    }
}
