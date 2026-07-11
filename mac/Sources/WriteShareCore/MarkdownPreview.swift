import Foundation

public struct MarkdownPreviewDocument: Equatable {
    public var frontMatter: [String: String]
    public var body: String

    public init(frontMatter: [String: String], body: String) {
        self.frontMatter = frontMatter
        self.body = body
    }
}

public enum WriteMarkdownPreviewRenderer {
    public static func parse(_ markdown: String) -> MarkdownPreviewDocument {
        guard let split = splitFrontMatter(markdown) else {
            return MarkdownPreviewDocument(frontMatter: [:], body: markdown)
        }
        return MarkdownPreviewDocument(
            frontMatter: parseFrontMatter(split.frontMatter),
            body: split.body
        )
    }

    public static func renderHTML(markdown: String, workspaceRootURL: URL? = nil) -> String {
        let document = parse(markdown)
        let bodyHTML = renderBlocks(document.body, workspaceRootURL: workspaceRootURL)
        let title = document.frontMatter["title"]
        let byline = previewByline(frontMatter: document.frontMatter)

        var content: [String] = []
        if let title, !title.isEmpty {
            content.append("<h1>\(escapeHTML(title))</h1>")
        }
        if !byline.isEmpty {
            content.append("<p class=\"byline\">\(escapeHTML(byline.joined(separator: " | ")))</p>")
        }
        content.append(bodyHTML)

        return """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline';">
        <style>
        :root { color-scheme: light dark; }
        body {
            margin: 0;
            padding: 32px;
            font: 15px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
            color: CanvasText;
            background: Canvas;
        }
        main { max-width: 760px; margin: 0 auto; }
        h1, h2, h3, h4, h5, h6 {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
            line-height: 1.18;
            margin: 1.2em 0 0.45em;
        }
        h1 { font-size: 2.1em; margin-top: 0; }
        h2 { font-size: 1.55em; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); padding-bottom: 0.2em; }
        p, ul, ol, blockquote, pre { margin: 0 0 1em; }
        .byline { color: color-mix(in srgb, CanvasText 55%, transparent); font-size: 0.9em; margin-top: -0.4em; }
        blockquote { border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent); padding-left: 1em; color: color-mix(in srgb, CanvasText 78%, transparent); }
        code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.92em; background: color-mix(in srgb, CanvasText 8%, transparent); border-radius: 4px; padding: 0.08em 0.3em; }
        pre { overflow-x: auto; padding: 1em; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, transparent); }
        pre code { background: transparent; padding: 0; border-radius: 0; }
        a { color: LinkText; text-decoration: none; }
        a:hover { text-decoration: underline; }
        img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0.6em 0 1em; }
        .image-placeholder { color: color-mix(in srgb, CanvasText 55%, transparent); font-style: italic; }
        </style>
        </head>
        <body><main>
        \(content.joined(separator: "\n"))
        </main></body>
        </html>
        """
    }

    private static func previewByline(frontMatter: [String: String]) -> [String] {
        var parts: [String] = []
        if let status = frontMatter["status"], !status.isEmpty {
            parts.append(status)
        }
        for key in ["date", "created_at", "createdAt", "updated_at", "updatedAt"] {
            if let value = frontMatter[key], !value.isEmpty {
                parts.append(value)
                break
            }
        }
        return parts
    }

    private static func renderBlocks(_ markdown: String, workspaceRootURL: URL?) -> String {
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var output: [String] = []
        var paragraph: [String] = []
        var index = 0

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            let text = paragraph.joined(separator: " ")
            output.append("<p>\(renderInline(text, workspaceRootURL: workspaceRootURL))</p>")
            paragraph.removeAll()
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushParagraph()
                index += 1
                continue
            }

            if trimmed.hasPrefix("```") {
                flushParagraph()
                index += 1
                var code: [String] = []
                while index < lines.count {
                    let candidate = lines[index]
                    if candidate.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                        index += 1
                        break
                    }
                    code.append(candidate)
                    index += 1
                }
                output.append("<pre><code>\(escapeHTML(code.joined(separator: "\n")))</code></pre>")
                continue
            }

            if let heading = parseHeading(line) {
                flushParagraph()
                output.append("<h\(heading.level)>\(renderInline(heading.text, workspaceRootURL: workspaceRootURL))</h\(heading.level)>")
                index += 1
                continue
            }

            if isBlockquoteLine(trimmed) {
                flushParagraph()
                var quoteLines: [String] = []
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    guard isBlockquoteLine(candidate) else { break }
                    quoteLines.append(stripBlockquoteMarker(candidate))
                    index += 1
                }
                output.append("<blockquote>\(renderBlocks(quoteLines.joined(separator: "\n"), workspaceRootURL: workspaceRootURL))</blockquote>")
                continue
            }

            if let firstListItem = parseListItem(trimmed) {
                flushParagraph()
                let ordered = firstListItem.ordered
                var items = [firstListItem.text]
                index += 1
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    guard let item = parseListItem(candidate), item.ordered == ordered else { break }
                    items.append(item.text)
                    index += 1
                }
                let tag = ordered ? "ol" : "ul"
                let children = items
                    .map { "<li>\(renderInline($0, workspaceRootURL: workspaceRootURL))</li>" }
                    .joined(separator: "\n")
                output.append("<\(tag)>\n\(children)\n</\(tag)>")
                continue
            }

            paragraph.append(trimmed)
            index += 1
        }

        flushParagraph()
        return output.joined(separator: "\n")
    }

    private static func parseHeading(_ line: String) -> (level: Int, text: String)? {
        var level = 0
        var index = line.startIndex
        while index < line.endIndex, line[index] == "#", level < 6 {
            level += 1
            index = line.index(after: index)
        }
        guard level > 0, index < line.endIndex, line[index] == " " else { return nil }
        let textStart = line.index(after: index)
        return (level, String(line[textStart...]).trimmingCharacters(in: .whitespaces))
    }

    private static func isBlockquoteLine(_ line: String) -> Bool {
        line.hasPrefix(">")
    }

    private static func stripBlockquoteMarker(_ line: String) -> String {
        var stripped = String(line.dropFirst())
        if stripped.hasPrefix(" ") { stripped.removeFirst() }
        return stripped
    }

    private static func parseListItem(_ line: String) -> (ordered: Bool, text: String)? {
        if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
            return (false, String(line.dropFirst(2)))
        }
        var cursor = line.startIndex
        var sawDigit = false
        while cursor < line.endIndex, line[cursor].isNumber {
            sawDigit = true
            cursor = line.index(after: cursor)
        }
        guard sawDigit, cursor < line.endIndex, line[cursor] == "." else { return nil }
        let next = line.index(after: cursor)
        guard next < line.endIndex, line[next] == " " else { return nil }
        return (true, String(line[line.index(after: next)...]))
    }

    private static func renderInline(_ text: String, workspaceRootURL: URL?) -> String {
        var output = ""
        var cursor = text.startIndex
        while cursor < text.endIndex {
            if text[cursor] == "`",
               let end = text[text.index(after: cursor)...].firstIndex(of: "`") {
                let codeStart = text.index(after: cursor)
                output += "<code>\(escapeHTML(String(text[codeStart..<end])))</code>"
                cursor = text.index(after: end)
                continue
            }

            if text[cursor] == "!" {
                let next = text.index(after: cursor)
                if next < text.endIndex,
                   text[next] == "[",
                   let image = parseBracketedInline(text, opener: next) {
                    output += renderImage(alt: image.label, source: image.destination, workspaceRootURL: workspaceRootURL)
                    cursor = image.endIndex
                    continue
                }
            }

            if text[cursor] == "[",
               let link = parseBracketedInline(text, opener: cursor) {
                output += renderLink(label: link.label, destination: link.destination, workspaceRootURL: workspaceRootURL)
                cursor = link.endIndex
                continue
            }

            let nextSpecial = nextInlineSpecial(in: text, from: cursor) ?? text.endIndex
            output += escapeHTML(String(text[cursor..<nextSpecial]))
            cursor = nextSpecial
        }
        return output
    }

    private static func parseBracketedInline(
        _ text: String,
        opener: String.Index
    ) -> (label: String, destination: String, endIndex: String.Index)? {
        guard let labelEnd = text[text.index(after: opener)...].firstIndex(of: "]") else { return nil }
        let parenStart = text.index(after: labelEnd)
        guard parenStart < text.endIndex, text[parenStart] == "(" else { return nil }
        guard let destinationEnd = text[text.index(after: parenStart)...].firstIndex(of: ")") else { return nil }
        let label = String(text[text.index(after: opener)..<labelEnd])
        let destination = String(text[text.index(after: parenStart)..<destinationEnd])
        return (label, destination, text.index(after: destinationEnd))
    }

    private static func nextInlineSpecial(in text: String, from index: String.Index) -> String.Index? {
        var cursor = text.index(after: index)
        while cursor < text.endIndex {
            if text[cursor] == "`" || text[cursor] == "[" || text[cursor] == "!" {
                return cursor
            }
            cursor = text.index(after: cursor)
        }
        return nil
    }

    private static func renderImage(alt: String, source: String, workspaceRootURL: URL?) -> String {
        // A sandboxed Quick Look preview cannot read sibling Media files, and
        // the preview forbids any external resource load. Never emit an image
        // src (file:// would break and remote would violate the no-network
        // rule); show a labeled placeholder naming the image instead.
        let caption = alt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? imageCaption(from: source)
            : alt
        return "<span class=\"image-placeholder\">\(escapeHTML(caption))</span>"
    }

    private static func imageCaption(from source: String) -> String {
        var name = source.trimmingCharacters(in: .whitespacesAndNewlines)
        if let hash = name.firstIndex(of: "#") { name = String(name[..<hash]) }
        if let query = name.firstIndex(of: "?") { name = String(name[..<query]) }
        if let slash = name.lastIndex(of: "/") {
            name = String(name[name.index(after: slash)...])
        }
        let decoded = name.removingPercentEncoding ?? name
        return decoded.isEmpty ? "Image" : "Image: \(decoded)"
    }

    private static func renderLink(label: String, destination: String, workspaceRootURL: URL?) -> String {
        let labelHTML = renderInline(label, workspaceRootURL: workspaceRootURL)
        guard let href = safeLocalLink(destination) else {
            return "<span>\(labelHTML)</span>"
        }
        return "<a href=\"\(escapeAttribute(href))\">\(labelHTML)</a>"
    }

    private static func safeLocalLink(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("#") { return trimmed }
        guard !trimmed.hasPrefix("/") && !trimmed.hasPrefix("//") else { return nil }
        guard URLComponents(string: trimmed)?.scheme == nil else { return nil }
        let decoded = trimmed.removingPercentEncoding ?? trimmed
        guard !decoded.split(separator: "/").contains("..") else { return nil }
        return trimmed
    }

    private static func splitFrontMatter(_ text: String) -> (frontMatter: String, body: String)? {
        let source = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        guard source.hasPrefix("---\n") || source.hasPrefix("---\r\n") else { return nil }
        guard let firstBreak = source.firstIndex(of: "\n") else { return nil }
        var cursor = source.index(after: firstBreak)
        while cursor <= source.endIndex {
            guard let nextBreak = source[cursor...].firstIndex(of: "\n") else { break }
            let rawLine = source[cursor..<nextBreak]
            let line = rawLine.last == "\r" ? rawLine.dropLast() : rawLine[...]
            if line.trimmingCharacters(in: .whitespaces) == "---" {
                let bodyStart = source.index(after: nextBreak)
                return (String(source[source.index(after: firstBreak)..<cursor]), String(source[bodyStart...]))
            }
            cursor = source.index(after: nextBreak)
        }
        return nil
    }

    private static func parseFrontMatter(_ text: String) -> [String: String] {
        var values: [String: String] = [:]
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            let rawValue = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            values[key] = parseYAMLScalar(rawValue)
        }
        return values
    }

    private static func parseYAMLScalar(_ raw: String) -> String {
        if let data = raw.data(using: .utf8),
           let value = try? JSONSerialization.jsonObject(with: data) as? String {
            return value
        }
        if raw == "true" || raw == "false" { return raw }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }

    private static func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func escapeAttribute(_ text: String) -> String {
        escapeHTML(text)
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}
