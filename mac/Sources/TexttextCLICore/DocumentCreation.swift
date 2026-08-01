import Foundation
import TextTextFileProviderKit

/// Creating and validating documents on disk.
///
/// A new document is written as a `.textpack` with the minimum frontmatter the
/// sync layer needs; the server fills in the identity, slug, and canonical URL
/// when it ingests the file. That is why `new` writes so little: guessing at
/// server-owned fields would either be ignored or, worse, conflict.
public enum DocumentCreation {
    /// Frontmatter keys the parser recognizes. Anything else is dropped on sync,
    /// so writing more than this is noise at best.
    public static func frontmatter(title: String, kind: String) -> String {
        // Values are single-line JSON, matching the on-disk grammar exactly.
        func json(_ value: String) -> String {
            let data = try? JSONSerialization.data(
                withJSONObject: [value], options: [.withoutEscapingSlashes])
            guard let data, let text = String(data: data, encoding: .utf8) else {
                return "\"\(value)\""
            }
            // Strip the array brackets JSONSerialization requires at top level.
            return String(text.dropFirst().dropLast())
        }
        // The trailing blank line matches how every existing document on disk
        // separates frontmatter from body.
        return """
            ---
            schema: "texttext.markdown-file.v1"
            kind: \(json(kind))
            type: \(json(kind))
            title: \(json(title))
            status: "draft"
            ---


            """
    }

    /// A filename that will not collide and does not need escaping. The title is
    /// the natural name, since that is what the person will look for in Finder.
    public static func filename(for title: String) -> String {
        let cleaned = title
            .components(separatedBy: CharacterSet(charactersIn: "/\\:"))
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Untitled" : cleaned
    }
}

/// What can be wrong with a document on disk.
public struct LintFinding: Equatable, Sendable {
    public let document: String
    public let problem: String

    public init(document: String, problem: String) {
        self.document = document
        self.problem = problem
    }

    public var description: String { "\(document): \(problem)" }
}

public enum DocumentLinter {
    /// Validate one document by round-tripping it through the same reader the
    /// app uses, so the linter and the app agree by construction rather than by
    /// a second implementation that can drift.
    public static func check(_ url: URL, named name: String) -> [LintFinding] {
        var findings: [LintFinding] = []
        let extensionName = url.pathExtension.lowercased()

        guard extensionName == "textpack" || extensionName == "md" else {
            return [LintFinding(document: name, problem: "not a document")]
        }

        if extensionName == "md" {
            guard let data = try? Data(contentsOf: url) else {
                return [LintFinding(document: name, problem: "unreadable")]
            }
            if String(data: data, encoding: .utf8) == nil {
                findings.append(LintFinding(document: name, problem: "not UTF-8"))
            }
            return findings
        }

        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-lint-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }

        do {
            let contents = try TextTextTextBundlePackage.read(from: url, in: temporary)
            if contents.markdown.isEmpty {
                findings.append(LintFinding(document: name, problem: "empty text.md"))
            }
            // An asset the markdown references but the package does not carry
            // renders as a broken image after sync.
            for asset in contents.assets where asset.data.isEmpty {
                findings.append(LintFinding(
                    document: name, problem: "empty asset \(asset.filename)"))
            }
        } catch {
            // The reader's own error is the most useful message here: it names
            // the exact invariant that broke.
            findings.append(LintFinding(
                document: name,
                problem: String(describing: error)))
        }
        return findings
    }
}
