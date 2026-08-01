import AppKit
import UniformTypeIdentifiers
import TextTextFileProviderKit
import TextTextShareCore
import TextTextWorkspaceCore

struct TextTextItemOpenTarget: Equatable {
    let handle: String
    let itemId: String?
    let slug: String
    let kind: String

    var appPath: String {
        appPath(mode: nil)
    }

    func appPath(mode: TextTextItemOpenMode?) -> String {
        var components = URLComponents()
        components.path = "/t/\(handle)/\(slug)"
        if mode == .edit || (mode == nil && kind == "note") {
            components.queryItems = [URLQueryItem(name: "edit", value: "1")]
            if let itemId, !itemId.isEmpty {
                components.queryItems?.append(URLQueryItem(name: "id", value: itemId))
            }
        }
        return components.string ?? "/t/\(handle)/\(slug)"
    }
}

struct ExternalNoteImport: Equatable {
    let title: String
    let body: String
    let representation: TextTextFileRepresentation
    let idempotencyKey: String

    var markdown: String {
        let encodedTitle: String
        if let data = try? JSONEncoder().encode(title),
           let text = String(data: data, encoding: .utf8) {
            encodedTitle = text
        } else {
            encodedTitle = "\"Untitled\""
        }
        return """
        ---
        title: \(encodedTitle)
        kind: note
        status: draft
        ---

        \(body)
        """
    }
}

/// Classifies files delivered by Launch Services. TextText workspace files retain
/// their metadata-aware behavior, while ordinary text files open literally.
enum OpenFileHandler {
    static func isTextTextFileProviderItem(_ rawIdentifier: String?) -> Bool {
        textTextFileProviderReference(rawIdentifier) != nil
    }

    /// Whether a file's extension is one TextText can open at all. File Provider
    /// decides whether a supported file is managed or an external import.
    static func isSupported(_ url: URL) -> Bool {
        supportedExtensions.contains(url.pathExtension.lowercased())
    }

    static func managedTarget(
        for url: URL,
        fallbackHandle: String?,
        fileProviderIdentifier rawIdentifier: String? = nil
    ) -> TextTextItemOpenTarget? {
        guard supportedExtensions.contains(url.pathExtension.lowercased()),
              let text = try? text(at: url) else {
            return nil
        }
        let providerReference = textTextFileProviderReference(rawIdentifier)
        let identity = MarkdownIdentityCodec.extract(from: text)
        let parsed = TextTextMarkdownPreviewRenderer.parse(text)
        guard let handle = nonempty(providerReference?.handle ?? fallbackHandle),
              let slug = nonempty(parsed.frontMatter["slug"]) else {
            return nil
        }
        let itemId = nonempty(providerReference?.itemId ?? identity?.itemId)
        let kind = nonempty(
            identity?.kind
                ?? parsed.frontMatter["kind"]
                ?? parsed.frontMatter["type"]
        ) ?? "article"
        return TextTextItemOpenTarget(
            handle: handle,
            itemId: itemId,
            slug: slug,
            kind: kind
        )
    }

    static func externalNoteImport(for url: URL) throws -> ExternalNoteImport {
        let text = try text(at: url)
        let parsed = TextTextMarkdownPreviewRenderer.parse(text)
        let title = nonempty(parsed.frontMatter["title"])
            ?? url.deletingPathExtension().lastPathComponent
        let body = parsed.frontMatter.isEmpty ? text : parsed.body
        let fingerprint = MarkdownIdentityCodec.syncHash(
            for: url.standardizedFileURL.path + "\u{0}" + text
        )
        return ExternalNoteImport(
            title: title,
            body: body,
            representation: TextTextFileRepresentation.inferred(
                fromFilename: url.lastPathComponent) ?? .markdown,
            idempotencyKey: "external-file:\(fingerprint)"
        )
    }

    /// Whether TextText.app is the system default for markdown files.
    static func isDefaultMarkdownApp() -> Bool {
        guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: markdownType) else {
            return false
        }
        return sameFile(appURL, Bundle.main.bundleURL)
    }

    /// Make (or stop making) TextText.app the default app for .md files.
    static func setDefaultMarkdownApp(_ enabled: Bool) {
        let appURL = enabled
            ? Bundle.main.bundleURL
            : URL(fileURLWithPath: "/System/Applications/TextEdit.app", isDirectory: true)
        NSWorkspace.shared.setDefaultApplication(at: appURL, toOpen: markdownType)
    }

    private static let markdownType = UTType(importedAs: "net.daringfireball.markdown")
    private static let supportedExtensions: Set<String> = [
        "md", "markdown", "txt", "textbundle", "textpack",
    ]

    private static func text(at url: URL) throws -> String {
        // `.textpack` is a zipped textbundle and `.textbundle` an open directory;
        // both carry the markdown in text.md, so route them through the package
        // reader (it auto-detects the archive vs the directory). Everything else
        // is a plain text file read literally.
        let ext = url.pathExtension.lowercased()
        guard ext == "textbundle" || ext == "textpack" else {
            return try String(contentsOf: url, encoding: .utf8)
        }
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("TextTextOpenFile", isDirectory: true)
        try FileManager.default.createDirectory(
            at: temporaryDirectory, withIntermediateDirectories: true)
        return try TextTextTextBundlePackage.read(
            from: url, in: temporaryDirectory).markdown
    }

    private static func textTextFileProviderReference(
        _ rawIdentifier: String?
    ) -> (handle: String, itemId: String)? {
        guard let rawIdentifier,
              let identifier = TextTextItemIdentifier(rawValue: rawIdentifier),
              case .file(let handle, let itemId) = identifier else { return nil }
        return (handle, itemId)
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func sameFile(_ lhs: URL, _ rhs: URL) -> Bool {
        let lhsId = try? lhs.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        let rhsId = try? rhs.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        if let lhsId = lhsId as? NSObject, let rhsId = rhsId as? NSObject, lhsId.isEqual(rhsId) {
            return true
        }
        return lhs.standardizedFileURL.path == rhs.standardizedFileURL.path
    }
}
