import Foundation

enum TextTextItemOpenMode: String, Equatable {
    case read
    case edit
}

/// A launch-safe link to one exact TextText item.
///
/// Existing `texttext-app://item/{id}` links remain valid. New agent integrations
/// include the workspace and mode so a cold app launch never guesses either.
struct TextTextItemLink: Equatable {
    let itemId: String
    let workspaceHandle: String?
    let mode: TextTextItemOpenMode?

    init?(url: URL) {
        guard url.scheme?.lowercased() == "texttext-app",
              url.host?.lowercased() == "item",
              url.pathComponents.count == 2,
              let itemId = url.pathComponents.last,
              Self.isValidItemId(itemId) else {
            return nil
        }
        let query = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
        )?.queryItems ?? []

        let workspaceValues = query.filter { $0.name == "workspace" }
        guard workspaceValues.count <= 1 else { return nil }
        let workspaceHandle: String?
        if let value = workspaceValues.first?.value {
            guard Self.isValidWorkspaceHandle(value) else { return nil }
            workspaceHandle = value
        } else {
            workspaceHandle = nil
        }

        let modeValues = query.filter { $0.name == "mode" }
        guard modeValues.count <= 1 else { return nil }
        let mode: TextTextItemOpenMode?
        if let value = modeValues.first?.value {
            guard let parsed = TextTextItemOpenMode(rawValue: value) else {
                return nil
            }
            mode = parsed
        } else {
            mode = nil
        }

        self.itemId = itemId
        self.workspaceHandle = workspaceHandle
        self.mode = mode
    }

    static func isValidItemId(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 64 else { return false }
        return value.allSatisfy { character in
            (character.isASCII && (character.isLetter || character.isNumber))
                || character == "-"
        }
    }

    static func isValidWorkspaceHandle(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 160 else { return false }
        return value.allSatisfy { character in
            (character.isASCII && (character.isLetter || character.isNumber))
                || character == "-"
                || character == "_"
                || character == "."
                || character == "@"
        }
    }
}

/// A small cold-launch buffer for item links received before File Provider is
/// ready. The newest request for an exact target wins and the queue stays
/// bounded if several agents launch TextText at once.
struct PendingTextTextItemLinks {
    private static let limit = 8
    private var links: [TextTextItemLink] = []

    var count: Int { links.count }

    mutating func enqueue(_ link: TextTextItemLink) {
        links.removeAll { existing in
            existing.itemId == link.itemId
                && existing.workspaceHandle == link.workspaceHandle
        }
        links.append(link)
        if links.count > Self.limit {
            links.removeFirst(links.count - Self.limit)
        }
    }

    mutating func drain() -> [TextTextItemLink] {
        let pending = links
        links.removeAll(keepingCapacity: true)
        return pending
    }
}
