import AppIntents
import TextTextAppIntents

@available(macOS 13.0, *)
struct TextTextAppShortcutsProvider: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor = .blue

    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CreateDocumentIntent(),
            phrases: [
                "Create a note in \(.applicationName)",
                "Make a TextText document in \(.applicationName)",
            ],
            shortTitle: "New Document",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: SearchDocumentsIntent(),
            phrases: [
                "Search \(.applicationName)",
                "Find a TextText document in \(.applicationName)",
            ],
            shortTitle: "Search",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: AppendTextToDocumentIntent(),
            phrases: [
                "Append text in \(.applicationName)",
            ],
            shortTitle: "Append text",
            systemImageName: "text.append"
        )
        AppShortcut(
            intent: OpenDocumentIntent(),
            phrases: [
                "Open an item in \(.applicationName)",
            ],
            shortTitle: "Open item",
            systemImageName: "doc"
        )
    }
}
