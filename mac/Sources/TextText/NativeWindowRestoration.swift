import Foundation
import CryptoKit

enum NativeWindowRestoration {
    static func key(origin: URL, homePath: String?) -> String {
        "TextTextLastItem:\(origin.absoluteString):\(homePath ?? "")"
    }
    static func linkedFallbackKey(origin: URL, token: String) -> String {
        let digest = SHA256.hash(data: Data(token.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return "TextTextLastLinkedPath:\(origin.absoluteString):\(digest)"
    }
    static func webSessionKey(origin: URL, cookie: HTTPCookie) -> String {
        let identity = "\(cookie.name):\(cookie.value)"
        let digest = SHA256.hash(data: Data(identity.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return "TextTextLastWebSessionPath:\(origin.absoluteString):\(digest)"
    }
    static func accepts(_ path: String, homePath: String?) -> Bool {
        guard let homePath, homePath.hasPrefix("/@"),
              let components = URLComponents(string: path),
              components.scheme == nil, components.host == nil, components.fragment == nil,
              path.utf8.count <= 2048 else { return false }
        if components.path == homePath {
            if components.query == nil { return true }
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

    /// A just-linked app may have a token before its workspace handle arrives.
    /// Accept only a plain workspace route for that short fallback window.
    static func acceptsCookieSessionPath(_ path: String) -> Bool {
        guard let components = URLComponents(string: path),
              components.scheme == nil, components.host == nil else { return false }
        let parts = components.path.split(separator: "/", omittingEmptySubsequences: false)
        let handle: Substring
        if parts.count == 2, parts[0].isEmpty, parts[1].hasPrefix("@") {
            handle = parts[1].dropFirst()
        } else if parts.count == 4, parts[0].isEmpty, parts[1] == "t" {
            handle = parts[2]
        } else { return false }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        guard !handle.isEmpty, handle.utf8.count <= 80,
              handle.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return false }
        return accepts(path, homePath: "/@\(handle)")
    }
}
