import Foundation

/// Parser retained only so a File Provider schema upgrade can recognize and
/// discard the visible bookmark sidecar objects created by releases 0.65-0.67.
/// New releases never enumerate or create these identifiers.
public enum TextTextLegacyBookmarkSidecars {
    private static let folderIDPrefix = "texttext-bookmark-assets."
    private static let fileIDPrefix = "texttext-bookmark-asset."

    public static func postId(fromFolderServerId id: String) -> String? {
        guard id.hasPrefix(folderIDPrefix) else { return nil }
        return decoded(String(id.dropFirst(folderIDPrefix.count)))
    }

    public static func assetIdentity(
        fromFileServerId id: String
    ) -> (postId: String, filename: String)? {
        guard id.hasPrefix(fileIDPrefix) else { return nil }
        let rest = id.dropFirst(fileIDPrefix.count)
        guard let separator = rest.firstIndex(of: ".") else { return nil }
        let postPart = String(rest[..<separator])
        let filenamePart = String(rest[rest.index(after: separator)...])
        guard let postId = decoded(postPart),
              let filename = decoded(filenamePart),
              TextTextDocumentAssets.isSafeFilename(filename) else { return nil }
        return (postId, filename)
    }

    private static func decoded(_ value: String) -> String? {
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder != 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: base64),
              let result = String(data: data, encoding: .utf8),
              !result.isEmpty else { return nil }
        return result
    }
}
