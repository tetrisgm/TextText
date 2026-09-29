import Foundation

enum NativeWindowRestoration {
    static func key(origin: URL, homePath: String?) -> String {
        "TextTextLastItem:\(origin.absoluteString):\(homePath ?? "")"
    }
    static func accepts(_ path: String, homePath: String?) -> Bool {
        guard let homePath, homePath.hasPrefix("/@"),
              let components = URLComponents(string: path),
              components.scheme == nil, components.host == nil, components.fragment == nil,
              path.utf8.count <= 2048 else { return false }
        if components.path == homePath {
            guard let query = components.queryItems, query.count == 1,
                  query[0].name == "folder", let folder = query[0].value,
                  !folder.isEmpty, folder.utf8.count <= 512,
                  !folder.contains("\\"),
                  folder.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return false }
            let segments = folder.split(separator: "/", omittingEmptySubsequences: false)
            return segments.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
        }
        let handle = String(homePath.dropFirst(2))
        let parts = components.path.split(separator: "/")
        guard parts.count == 3, parts[0] == "t", String(parts[1]) == handle,
              !parts[2].isEmpty, !parts.contains("..") else { return false }
        return (components.queryItems ?? []).allSatisfy { item in
            (item.name == "edit" && item.value == "1") ||
            (item.name == "id" && item.value.map(TextTextItemLink.isValidItemId) == true)
        }
    }
}
