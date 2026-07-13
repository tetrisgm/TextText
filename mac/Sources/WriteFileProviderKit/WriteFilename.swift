import Foundation

/// Derives the Finder-facing filename for a post from its TITLE (not its slug),
/// and the reverse (a Finder rename -> a new title). Slugs like "untitled-abc123"
/// are the URL identity, not something a person should ever see in Finder, so the
/// leaf shown is the human title with a ".md" extension.
///
/// Framework-free so the kit stays testable. Two layers of uniqueness: a
/// per-item name that reads the server's own "<slug>-N" de-dup suffix (so two
/// posts titled "Foo" show "Foo.md" and "Foo (2).md" with no sibling context),
/// and a sibling-aware pass in the enumerator (`disambiguate`) as a safety net
/// for the rare case of two same-title posts whose slugs were set by hand.
public enum WriteFilename {
    /// Mirror of the server slugify (src/lib/markdown-files.ts): lowercase, every
    /// run of non-`[a-z0-9]` to a single "-", trim leading/trailing "-", cap 80,
    /// trim trailing "-" again. Used only to recognize the server's de-dup suffix
    /// so the displayed name can carry " (N)".
    public static func slugify(_ value: String) -> String {
        let lowered = value.lowercased()
        var out = ""
        var lastDash = false
        for scalar in lowered.unicodeScalars {
            // Only ASCII a-z and 0-9 survive, exactly like the server regex.
            if (scalar.value >= 97 && scalar.value <= 122)
                || (scalar.value >= 48 && scalar.value <= 57) {
                out.unicodeScalars.append(scalar); lastDash = false
            } else if !lastDash {
                out.append("-"); lastDash = true
            }
        }
        let dash = CharacterSet(charactersIn: "-")
        out = out.trimmingCharacters(in: dash)
        out = String(out.prefix(80))
        return out.trimmingCharacters(in: dash)
    }

    /// Make a title safe as a single Finder path component: "/" is illegal in a
    /// leaf (it would split the item and materialize zero bytes) and ":" is shown
    /// as "/" by Finder, so both become "-". Control characters are stripped,
    /// whitespace runs collapse to a single space, and the result is capped so
    /// leaf + suffix + ".md" stays well under the 255-byte filesystem limit.
    public static func sanitize(_ value: String) -> String {
        var out = ""
        var lastSpace = false
        for scalar in value.unicodeScalars {
            if scalar == "/" || scalar == ":" {
                out.append("-"); lastSpace = false
            } else if CharacterSet.controlCharacters.contains(scalar) {
                continue
            } else if CharacterSet.whitespaces.contains(scalar) {
                if !lastSpace { out.append(" "); lastSpace = true }
            } else {
                out.unicodeScalars.append(scalar); lastSpace = false
            }
        }
        out = out.trimmingCharacters(in: .whitespaces)
        // Leading dots make a hidden file; drop them.
        while out.hasPrefix(".") { out.removeFirst() }
        while out.utf8.count > 240, !out.isEmpty { out.removeLast() }
        return out.trimmingCharacters(in: .whitespaces)
    }

    /// The base leaf (no extension) for a post: its sanitized title, falling back
    /// to the slug, then "untitled". When the slug is the server's de-dup form
    /// `slugify(title)-N`, the leaf carries a matching " (N)" so two same-title
    /// posts read distinctly without needing their siblings.
    public static func displayLeaf(title: String, slug: String) -> String {
        let clean = sanitize(title)
        let base = !clean.isEmpty ? clean : (!slug.isEmpty ? slug : "untitled")
        guard !clean.isEmpty else { return base }
        let stem = slugify(title)
        if !stem.isEmpty, slug != stem, slug.hasPrefix(stem + "-") {
            let tail = slug.dropFirst(stem.count + 1)
            if !tail.isEmpty, tail.allSatisfy({ $0.isNumber }) {
                return base + " (\(tail))"
            }
        }
        return base
    }

    /// The Finder filename for a post: its display leaf plus ".md".
    public static func filename(title: String, slug: String) -> String {
        displayLeaf(title: title, slug: slug) + ".md"
    }

    /// The title implied by a Finder filename (the reverse of `filename`): strip a
    /// trailing all-letter extension (".md") and trim. Taken verbatim as the new
    /// title, so a rename to "My Great Note.md" retitles the post to
    /// "My Great Note" (the slug/URL is left to the server).
    public static func titleFromFilename(_ filename: String) -> String {
        var base = filename
        if let dot = base.lastIndex(of: "."),
           base[base.index(after: dot)...].allSatisfy({ $0.isLetter }),
           dot != base.startIndex {
            base = String(base[..<dot])
        }
        return base.trimmingCharacters(in: .whitespaces)
    }

    /// Break residual same-name collisions WITHIN a parent folder (the rare case
    /// of two posts whose titles match but whose slugs were set by hand, so the
    /// per-item " (N)" layer cannot separate them). Compares case-insensitively
    /// (the default macOS filesystem is case-insensitive) and appends a short,
    /// stable id suffix to EVERY member of a collision group, so the result does
    /// not depend on enumeration order.
    public static func disambiguate(_ items: [WriteItem]) -> [WriteItem] {
        var counts: [String: Int] = [:]
        for item in items where !item.isFolder {
            counts[key(item), default: 0] += 1
        }
        guard counts.values.contains(where: { $0 > 1 }) else { return items }
        return items.map { item in
            guard !item.isFolder, (counts[key(item)] ?? 0) > 1,
                  let id = item.serverId else { return item }
            return item.withFilename(insert("-" + String(id.prefix(6)), into: item.filename))
        }
    }

    private static func key(_ item: WriteItem) -> String {
        item.parentIdentifier.rawValue + "\n" + item.filename.lowercased()
    }

    /// Insert a disambiguating suffix before the ".md" extension (or at the end
    /// when there is none).
    private static func insert(_ suffix: String, into name: String) -> String {
        if name.hasSuffix(".md") {
            return String(name.dropLast(3)) + suffix + ".md"
        }
        return name + suffix
    }
}
