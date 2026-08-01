import Foundation

/// Markdown section addressing.
///
/// A human editing a document has a caret; an agent has a region of interest,
/// and the natural unit for that is a heading. Addressing by heading also
/// survives edits above it, which a character offset does not, so two agents
/// working in different sections of one document do not collide.
public struct DocumentSection: Equatable, Sendable {
    /// The heading line itself, e.g. `## Pricing`.
    public let heading: String
    /// Heading depth: 1 for `#`, 2 for `##`.
    public let level: Int
    /// Title without the leading hashes or surrounding whitespace.
    public let title: String
    /// Line index of the heading.
    public let headingLine: Int
    /// Line range of the section body, excluding the heading line itself.
    /// Empty when the section has no body.
    public let bodyLines: Range<Int>

    public init(
        heading: String, level: Int, title: String,
        headingLine: Int, bodyLines: Range<Int>
    ) {
        self.heading = heading
        self.level = level
        self.title = title
        self.headingLine = headingLine
        self.bodyLines = bodyLines
    }
}

public enum DocumentSections {
    /// Parse ATX headings, ignoring anything inside a fenced code block so a
    /// `#` in a shell example is never mistaken for a section.
    public static func parse(_ markdown: String) -> [DocumentSection] {
        let lines = markdown.components(separatedBy: "\n")
        var headings: [(line: Int, level: Int, title: String, raw: String)] = []
        var inFence = false
        var fenceMarker = ""

        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                let marker = String(trimmed.prefix(3))
                if inFence {
                    if marker == fenceMarker { inFence = false }
                } else {
                    inFence = true
                    fenceMarker = marker
                }
                continue
            }
            guard !inFence, trimmed.hasPrefix("#") else { continue }
            let hashes = trimmed.prefix { $0 == "#" }
            let level = hashes.count
            guard level <= 6 else { continue }
            let rest = trimmed.dropFirst(level)
            // An ATX heading requires a space after the hashes, so `#hashtag`
            // is not a heading.
            guard rest.hasPrefix(" ") || rest.isEmpty else { continue }
            let title = rest.trimmingCharacters(in: .whitespaces)
            headings.append((index, level, title, line))
        }

        return headings.enumerated().map { position, heading in
            // A section ends at the next heading of the same or shallower depth,
            // so a `##` section contains its `###` children.
            var end = lines.count
            for next in headings[(position + 1)...] where next.level <= heading.level {
                end = next.line
                break
            }
            let bodyStart = min(heading.line + 1, end)
            return DocumentSection(
                heading: heading.raw,
                level: heading.level,
                title: heading.title,
                headingLine: heading.line,
                bodyLines: bodyStart..<end)
        }
    }

    /// Find one section by name. Accepts `## Pricing`, `Pricing`, or `pricing`.
    /// Matching is case-insensitive on the title, because an agent that read the
    /// document will echo the title's own casing and should not have to.
    public static func find(_ name: String, in markdown: String) -> DocumentSection? {
        let sections = parse(markdown)
        let wanted = name.trimmingCharacters(in: .whitespaces)
        let strippedHashes = wanted.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces)
        let target = strippedHashes.lowercased()

        // Prefer an exact heading match (including level), then title-only.
        if let exact = sections.first(where: {
            $0.heading.trimmingCharacters(in: .whitespaces) == wanted
        }) {
            return exact
        }
        return sections.first { $0.title.lowercased() == target }
    }

    /// Extract a section's body text, excluding its heading.
    public static func body(of section: DocumentSection, in markdown: String) -> String {
        let lines = markdown.components(separatedBy: "\n")
        guard !section.bodyLines.isEmpty else { return "" }
        let slice = lines[section.bodyLines].joined(separator: "\n")
        return slice.trimmingCharacters(in: .newlines)
    }

    /// Replace one section's body, leaving every other byte of the document
    /// untouched. This is what makes a section edit surgical: a human typing
    /// elsewhere, or another agent in another section, is unaffected.
    public static func replaceBody(
        of section: DocumentSection, in markdown: String, with replacement: String
    ) -> String {
        var lines = markdown.components(separatedBy: "\n")
        let body = replacement
            .trimmingCharacters(in: .newlines)
            .components(separatedBy: "\n")

        // Re-emit canonical spacing: one blank line under the heading, and one
        // before whatever follows. Without this an edit silently reflows the
        // document around the section it touched, which is a byte change the
        // author did not ask for.
        var inserted = [""] + body
        if section.bodyLines.upperBound < lines.count {
            inserted.append("")
        }
        lines.replaceSubrange(section.bodyLines, with: inserted)
        return lines.joined(separator: "\n")
    }
}
