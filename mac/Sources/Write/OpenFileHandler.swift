import AppKit
import UniformTypeIdentifiers
import WriteWorkspaceCore

/// Opening markdown files with Write.app: files inside the workspace root open
/// in the native editor; anything else is politely refused.
enum OpenFileHandler {
    /// Handle Finder-opened files. Returns the URLs it could NOT handle.
    @discardableResult
    static func open(
        urls: [URL],
        store _: StateStore,
        syncRoot: URL,
        openEditor: (URL) -> Bool
    ) -> [URL] {
        var unhandled: [URL] = []

        for url in urls {
            guard url.pathExtension.lowercased() == "md",
                  let relativePath = WorkspaceLayout.relativePath(for: url, under: syncRoot),
                  !WorkspaceLayout.isInternal(relativePath: relativePath),
                  openEditor(url) else {
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

    private static func sameFile(_ lhs: URL, _ rhs: URL) -> Bool {
        let lhsId = try? lhs.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        let rhsId = try? rhs.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        if let lhsId = lhsId as? NSObject, let rhsId = rhsId as? NSObject, lhsId.isEqual(rhsId) {
            return true
        }
        return lhs.standardizedFileURL.path == rhs.standardizedFileURL.path
    }
}
