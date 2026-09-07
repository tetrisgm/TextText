import AppKit

struct NativeMenuCommand {
    let id: String
    let title: String
    let menu: String
    let key: String
    let modifiers: NSEvent.ModifierFlags
    let enabled: Bool
    let checked: Bool

    init?(_ value: [String: Any]) {
        guard let id = value["id"] as? String, !id.isEmpty, id.count < 100,
              let title = value["title"] as? String, title.count < 150,
              let menu = value["menu"] as? String,
              ["TextText", "File", "Edit", "View", "Window", "Help"].contains(menu),
              let enabled = value["enabled"] as? Bool else { return nil }
        self.id = id; self.title = title; self.menu = menu; self.enabled = enabled
        self.checked = value["checked"] as? Bool ?? false
        let rawKey = value["key"] as? String ?? ""
        self.key = ["Backspace": "\u{8}", "Enter": "\r", "Tab": "\t",
                    "ArrowUp": "\u{f700}", "ArrowDown": "\u{f701}" ][rawKey]
            ?? (rawKey.count == 1 ? rawKey.lowercased() : "")
        var flags: NSEvent.ModifierFlags = []
        for flag in value["modifiers"] as? [String] ?? [] {
            switch flag {
            case "command": flags.insert(.command)
            case "control": flags.insert(.control)
            case "option": flags.insert(.option)
            case "shift": flags.insert(.shift)
            default: break
            }
        }
        modifiers = flags
    }
}

/// Menus use the web command registry, including its live availability checks.
final class NativeWorkspaceMenu: NSObject, NSMenuDelegate, NSMenuItemValidation {
    var requestState: (() -> Void)?
    var invoke: ((String) -> Void)?
    var isWorkspaceKey: (() -> Bool)?
    private var commands: [String: NativeMenuCommand] = [:]
    private var items: [String: NSMenuItem] = [:]

    func install(on main: NSMenu) {
        for title in ["File", "Edit", "View", "Window", "Help"] {
            if main.items.first(where: { $0.title == title }) == nil {
                let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                item.submenu = NSMenu(title: title)
                main.addItem(item)
            }
        }
        for item in main.items { item.submenu?.delegate = self }
        NSApp.helpMenu = main.items.first(where: { $0.title == "Help" })?.submenu
    }

    func update(_ values: [[String: Any]], main: NSMenu) {
        let parsed = values.prefix(150).compactMap(NativeMenuCommand.init)
        commands = Dictionary(parsed.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        // Keep disabled rows during navigation rather than reshuffling an open menu.
        for item in items.values { item.isEnabled = false }
        for command in parsed {
            let item: NSMenuItem
            if let existing = items[command.id] { item = existing }
            else {
                let menu = command.menu == "TextText" ? main.items.first?.submenu
                    : main.items.first(where: { $0.title == command.menu })?.submenu
                guard let menu else { continue }
                item = NSMenuItem(title: command.title, action: #selector(run(_:)), keyEquivalent: command.key)
                item.target = self
                item.representedObject = command.id
                item.keyEquivalentModifierMask = command.modifiers
                // Native text editing keeps the responder-chain shortcuts.
                if ["post.copy", "post.paste", "selection.select-all", "workspace.close-tab"].contains(command.id) {
                    item.keyEquivalent = ""
                }
                menu.addItem(item)
                items[command.id] = item
            }
            item.title = command.title
            item.state = command.checked ? .on : .off
            item.isEnabled = command.enabled && isWorkspaceKey?() == true
        }
    }

    static func fullScreenTitle(isFullScreen: Bool) -> String {
        isFullScreen ? "Exit full screen" : "Enter full screen"
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        for item in menu.items where item.action == #selector(NSWindow.toggleFullScreen(_:)) {
            item.title = Self.fullScreenTitle(isFullScreen: NSApp.keyWindow?.styleMask.contains(.fullScreen) == true)
        }
        requestState?()
    }
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard isWorkspaceKey?() == true, let id = item.representedObject as? String else { return false }
        return commands[id]?.enabled == true
    }
    @objc private func run(_ item: NSMenuItem) {
        guard validateMenuItem(item), let id = item.representedObject as? String else { return }
        invoke?(id)
    }
}
