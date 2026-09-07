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
