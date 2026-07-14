import AppKit
import UniformTypeIdentifiers
import WriteFileProviderKit
import WriteShareCore
import WriteWorkspaceCore

enum OpenFileKind: Equatable {
    case workspace
    case external
    case unsupported
}

struct WriteItemOpenTarget: Equatable {
    let handle: String
    let itemId: String?
    let slug: String
    let kind: String

    var appPath: String {
        var components = URLComponents()
        components.path = "/t/\(handle)/\(slug)"
        if kind == "note" {
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

/// Classifies files delivered by Launch Services. Write workspace files retain
/// their metadata-aware behavior, while ordinary text files open literally.
enum OpenFileHandler {
    static func kind(for url: URL, syncRoot: URL) -> OpenFileKind {
        guard supportedExtensions.contains(url.pathExtension.lowercased()) else {
            return .unsupported
        }
        if let relativePath = WorkspaceLayout.relativePath(for: url, under: syncRoot) {
            return WorkspaceLayout.isInternal(relativePath: relativePath)
                ? .unsupported
                : .workspace
        }
        return .external
    }

    static func isWriteFileProviderItem(_ rawIdentifier: String?) -> Bool {
        writeFileProviderReference(rawIdentifier) != nil
    }

    static func managedTarget(
        for url: URL,
        fallbackHandle: String?,
        fileProviderIdentifier rawIdentifier: String? = nil
    ) -> WriteItemOpenTarget? {
        guard supportedExtensions.contains(url.pathExtension.lowercased()),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }
        let providerReference = writeFileProviderReference(rawIdentifier)
        let identity = MarkdownIdentityCodec.extract(from: text)
        let parsed = WriteMarkdownPreviewRenderer.parse(text)
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
        return WriteItemOpenTarget(
            handle: handle,
            itemId: itemId,
            slug: slug,
            kind: kind
        )
    }

    static func externalNoteImport(for url: URL) throws -> ExternalNoteImport {
        let text = try String(contentsOf: url, encoding: .utf8)
        let parsed = WriteMarkdownPreviewRenderer.parse(text)
        let title = nonempty(parsed.frontMatter["title"])
            ?? url.deletingPathExtension().lastPathComponent
        let body = parsed.frontMatter.isEmpty ? text : parsed.body
        let fingerprint = MarkdownIdentityCodec.syncHash(
            for: url.standardizedFileURL.path + "\u{0}" + text
        )
        return ExternalNoteImport(
            title: title,
            body: body,
            idempotencyKey: "external-file:\(fingerprint)"
        )
    }

    /// Whether Write.app is the system default for markdown files.
    static func isDefaultMarkdownApp() -> Bool {
        guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: markdownType) else {
            return false
        }
        return sameFile(appURL, Bundle.main.bundleURL)
    }

    /// Make (or stop making) Write.app the default app for .md files.
    static func setDefaultMarkdownApp(_ enabled: Bool) {
        let appURL = enabled
            ? Bundle.main.bundleURL
            : URL(fileURLWithPath: "/System/Applications/TextEdit.app", isDirectory: true)
        NSWorkspace.shared.setDefaultApplication(at: appURL, toOpen: markdownType)
    }

    private static let markdownType = UTType(importedAs: "net.daringfireball.markdown")
    private static let supportedExtensions: Set<String> = ["md", "markdown", "txt"]

    private static func writeFileProviderReference(
        _ rawIdentifier: String?
    ) -> (handle: String, itemId: String)? {
        guard let rawIdentifier,
              let identifier = WriteItemIdentifier(rawValue: rawIdentifier),
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
