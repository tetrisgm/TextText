import AppIntents
import WriteAppIntents

@available(macOS 13.0, *)
struct WriteAppShortcutsProvider: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor = .blue

    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CreateDocumentIntent(),
            phrases: [
                "Create a note in \(.applicationName)",
                "Make a Texttext document in \(.applicationName)",
            ],
            shortTitle: "New Document",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: SearchDocumentsIntent(),
            phrases: [
                "Search \(.applicationName)",
                "Find a Texttext document in \(.applicationName)",
            ],
            shortTitle: "Search",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: CreateBookmarkFromURLIntent(),
            phrases: [
                "Save a bookmark in \(.applicationName)",
                "Bookmark a URL in \(.applicationName)",
            ],
            shortTitle: "Bookmark",
            systemImageName: "bookmark"
        )
        AppShortcut(
            intent: GetRecentDocumentsIntent(),
            phrases: [
                "Show recent Texttext documents in \(.applicationName)",
                "Get recent documents in \(.applicationName)",
            ],
            shortTitle: "Recent",
            systemImageName: "clock"
        )
    }
}
