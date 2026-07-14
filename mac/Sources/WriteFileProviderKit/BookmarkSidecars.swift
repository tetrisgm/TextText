import Foundation

/// Pure naming, validation, and Markdown transforms for bookmark sidecars.
/// The canonical server Markdown always keeps Write-hosted URLs. Only the
/// Finder materialization swaps those exact URLs for relative paths.
public enum WriteBookmarkSidecars {
    private static let folderIDPrefix = "write-bookmark-assets."
    private static let fileIDPrefix = "write-bookmark-asset."

    public static func directoryName(slug: String) -> String {
        WriteFilename.encodeComponent(slug.isEmpty ? "bookmark" : slug, appending: ".assets")
    }

    public static func folderIdentifier(handle: String, postId: String) -> WriteItemIdentifier {
        .folder(handle: handle, id: folderIDPrefix + encoded(postId))
    }

    public static func assetIdentifier(
        handle: String, postId: String, filename: String
    ) -> WriteItemIdentifier {
        .file(
            handle: handle,
            id: fileIDPrefix + encoded(postId) + "." + encoded(filename))
    }

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
        guard let postId = decoded(postPart), let filename = decoded(filenamePart),
              isSafeFilename(filename) else { return nil }
        return (postId, filename)
    }

    public static func isSafeFilename(_ filename: String) -> Bool {
        guard !filename.isEmpty, filename != ".", filename != "..",
              !filename.contains("/"), !filename.contains("\\"),
              filename == WriteFilename.encodeComponent(filename) else { return false }
        let parts = filename.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[1].isEmpty else { return false }
        let stem = String(parts[0])
        let allowedPrefix = stem.hasPrefix("asset-") ? "asset-" :
            (stem.hasPrefix("screenshot-") ? "screenshot-" : nil)
        guard let allowedPrefix else { return false }
        let digits = stem.dropFirst(allowedPrefix.count)
        return digits.count >= 3 && digits.allSatisfy(\.isNumber)
            && parts[1].allSatisfy { $0.isLetter || $0.isNumber }
    }

    public static func validatedArtifacts(
        _ manifest: WriteBookmarkArtifactManifest, handle: String
    ) -> [WriteBookmarkArtifact] {
        var seenNames = Set<String>()
        var seenURLs = Set<String>()
        return manifest.artifacts.filter { artifact in
            guard isSafeFilename(artifact.filename),
                  seenNames.insert(artifact.filename).inserted,
                  seenURLs.insert(artifact.url).inserted,
                  let url = URL(string: artifact.url),
                  isWriteHostedCaptureURL(url, handle: handle, postId: manifest.postId)
            else { return false }
            return true
        }
    }

    public static func localMarkdown(
        canonical: String, manifest: WriteBookmarkArtifactManifest, handle: String,
        directoryName: String? = nil
    ) -> String {
        transform(
            canonical, manifest: manifest, handle: handle,
            directoryName: directoryName, toLocal: true)
    }

    public static func canonicalMarkdown(
        local: String, manifest: WriteBookmarkArtifactManifest, handle: String,
        directoryName: String? = nil
    ) -> String {
        transform(
            local, manifest: manifest, handle: handle,
            directoryName: directoryName, toLocal: false)
    }

    public static func isWriteHostedCaptureURL(
        _ url: URL, handle: String, postId: String
    ) -> Bool {
        guard url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              host.hasSuffix(".blob.vercel-storage.com") else { return false }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 4, parts[0] == "captures" else { return false }
        return parts[1].removingPercentEncoding == handle
            && parts[2].removingPercentEncoding == postId
    }

    public static func contentHash(
        manifest: WriteBookmarkArtifactManifest, artifact: WriteBookmarkArtifact
    ) -> String {
        WriteStableDigest.sha256Hex(
            "bookmark-artifact\u{0}\(manifest.fileHash)\u{0}\(artifact.filename)\u{0}\(artifact.url)")
    }

    private static func transform(
        _ markdown: String, manifest: WriteBookmarkArtifactManifest,
        handle: String, directoryName: String?, toLocal: Bool
    ) -> String {
        let directory = directoryName ?? self.directoryName(slug: manifest.slug)
        var result = markdown
        let artifacts = validatedArtifacts(manifest, handle: handle)
            .sorted { $0.url.count > $1.url.count }
        for artifact in artifacts {
            let relative = "./\(directory)/\(artifact.filename)"
            if toLocal {
                result = result.replacingOccurrences(of: artifact.url, with: relative)
            } else {
                result = result.replacingOccurrences(of: relative, with: artifact.url)
                result = result.replacingOccurrences(
                    of: "\(directory)/\(artifact.filename)", with: artifact.url)
            }
        }
        return result
    }

    private static func encoded(_ value: String) -> String {
        Data(value.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func decoded(_ value: String) -> String? {
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder != 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: base64),
              let result = String(data: data, encoding: .utf8), !result.isEmpty else { return nil }
        return result
    }
}
