import AppKit
import UniformTypeIdentifiers

/// Opening markdown files with Write.app: files inside the sync root map to
/// their post and open in the web editor; anything else is politely refused
/// (this app is a sync client, not a general-purpose editor).
enum OpenFileHandler {
    /// Handle Finder-opened files. Returns the URLs it could NOT handle.
    @discardableResult
    static func open(urls: [URL], store: StateStore, syncRoot: URL) -> [URL] {
        guard let credentials = store.loadCredentials(),
              let workspace = store.cachedWorkspace() else {
            return urls
        }

        let origin = resolveServerOrigin(credentials: credentials)
        let handle = workspace.blog.handle
        let index = store.loadIndex()
        var unhandled: [URL] = []

        for url in urls {
            guard url.pathExtension.lowercased() == "md",
                  let relativePath = relativePath(for: url, under: syncRoot),
                  let postId = postId(for: relativePath, in: index),
                  let editorURL = editorURL(origin: origin, handle: handle, postId: postId, fileURL: url),
                  NSWorkspace.shared.open(editorURL) else {
                unhandled.append(url)
                continue
            }
        }

        return unhandled
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

    private static func relativePath(for fileURL: URL, under rootURL: URL) -> String? {
        let rootPath = rootURL.standardizedFileURL.path
        let filePath = fileURL.standardizedFileURL.path
        guard filePath.hasPrefix(rootPath + "/") else { return nil }
        let start = filePath.index(filePath.startIndex, offsetBy: rootPath.count + 1)
        return String(filePath[start...])
    }

    private static func postId(for relativePath: String, in index: SyncIndex) -> String? {
        for (postId, entry) in index.entries where entry.relativePath == relativePath {
            return postId
        }
        return nil
    }

    private static func editorURL(origin: URL, handle: String, postId: String, fileURL: URL) -> URL? {
        let slug = fileURL.deletingPathExtension().lastPathComponent
        let base = origin
            .appendingPathComponent("t")
            .appendingPathComponent(handle)
            .appendingPathComponent(slug)
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [
            URLQueryItem(name: "edit", value: "1"),
            URLQueryItem(name: "id", value: postId),
        ]
        return components.url
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
