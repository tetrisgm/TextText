import AppKit

/// Opening markdown files with Write.app: files inside the sync root map to
/// their post and open in the web editor; anything else is politely refused
/// (this app is a sync client, not a general-purpose editor).
///
/// SKELETON: Info.plist already declares the markdown document types so the
/// Finder offers the app; the mapping implementation lands next.
enum OpenFileHandler {
    /// Handle Finder-opened files. Returns the URLs it could NOT handle.
    @discardableResult
    static func open(urls: [URL], store: StateStore, syncRoot: URL) -> [URL] {
        // Implementation pending: map <syncRoot>/<folder-path>/<slug>.md to
        // the post's edit URL via the local index, open in the browser.
        return urls
    }

    /// Whether Write.app is the system default for markdown files.
    static func isDefaultMarkdownApp() -> Bool {
        // Implementation pending (NSWorkspace default-application check).
        return false
    }

    /// Make (or stop making) Write.app the default app for .md files.
    static func setDefaultMarkdownApp(_ enabled: Bool) {
        // Implementation pending (NSWorkspace.setDefaultApplication).
        _ = enabled
    }
}
