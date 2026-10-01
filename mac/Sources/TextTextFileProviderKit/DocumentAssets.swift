import Foundation

/// Validation and Markdown transforms for immutable binaries owned by a TextText
/// item. Assets materialize inside its TextBundle, never as visible sibling
/// folders in the workspace.
public enum TextTextDocumentAssets {
    public static func inferredContentType(filename: String) -> String? {
        switch URL(fileURLWithPath: filename).pathExtension.lowercased() {
        case "avif": return "image/avif"
        case "gif": return "image/gif"
        case "heic", "heif": return "image/heic"
        case "jpeg", "jpg": return "image/jpeg"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "webp": return "image/webp"
        case "m4v": return "video/x-m4v"
        case "mov": return "video/quicktime"
        case "mp4": return "video/mp4"
        case "webm": return "video/webm"
        default: return nil
        }
    }

    public static func validatedInlineAssets(
        _ manifest: TextTextArtifactManifest, handle: String, origin: URL? = nil
    ) -> [TextTextArtifact] {
        var seenNames = Set<String>()
        var seenURLs = Set<String>()
        return manifest.artifacts.filter { artifact in
            guard artifact.role == "asset",
                  isSafeFilename(artifact.filename),
                  seenNames.insert(artifact.filename).inserted,
                  seenURLs.insert(artifact.url).inserted,
                  let url = URL(string: artifact.url),
                  isTextTextHostedAssetURL(
                    url, handle: handle, postId: manifest.postId, origin: origin)
            else { return false }
            return true
        }
    }

    public static func localMarkdown(
        canonical: String, manifest: TextTextArtifactManifest, handle: String,
        origin: URL? = nil
    ) -> String {
        transform(canonical, manifest: manifest, handle: handle, origin: origin, toLocal: true)
    }

    public static func canonicalMarkdown(
        local: String, manifest: TextTextArtifactManifest, handle: String,
        origin: URL? = nil
    ) -> String {
        transform(local, manifest: manifest, handle: handle, origin: origin, toLocal: false)
    }

    /// Replace package-local asset references without matching the same path
    /// inside an already-absolute URL. In particular, replacing `./assets/x`
    /// and then `assets/x` naively rewrites the hosted URL inserted by the first
    /// pass. Sorting longest names first also keeps prefix-sharing filenames
    /// from consuming one another.
    public static func canonicalMarkdown(
        local: String, remoteURLsByFilename: [String: String]
    ) -> String {
        var result = local
        let mappings = remoteURLsByFilename.sorted {
            if $0.key.count != $1.key.count { return $0.key.count > $1.key.count }
            return $0.key < $1.key
        }
        for (filename, remoteURL) in mappings {
            guard isSafeFilename(filename) else { continue }
            let escaped = NSRegularExpression.escapedPattern(for: filename)
            guard let expression = try? NSRegularExpression(
                pattern: "(?<![A-Za-z0-9_./:-])(?:\\./)?assets/\(escaped)(?=$|[^A-Za-z0-9_.-])"
            ) else { continue }
            let matches = expression.matches(
                in: result, range: NSRange(result.startIndex..., in: result))
            for match in matches.reversed() {
                guard let range = Range(match.range, in: result) else { continue }
                result.replaceSubrange(range, with: remoteURL)
            }
        }
        return result
    }

    public static func isSafeFilename(_ filename: String) -> Bool {
        guard !filename.isEmpty, filename != ".", filename != "..",
              filename.utf8.count <= 255,
              !filename.contains("/"), !filename.contains("\\"),
              !filename.hasPrefix(".") else { return false }
        return filename.unicodeScalars.allSatisfy {
            !CharacterSet.controlCharacters.contains($0)
        }
    }

    public static func isTextTextHostedAssetURL(
        _ url: URL, handle: String, postId: String, origin: URL? = nil
    ) -> Bool {
        let parts: [String]
        if let origin, let mediaParts = trustedMediaPathParts(url, origin: origin) {
            parts = mediaParts
        } else if let blobParts = legacyBlobPathParts(url) {
            parts = blobParts
        } else {
            return false
        }
        guard parts.count >= 4 else { return false }
        if parts[0] == "captures" {
            return parts[1] == handle && parts[2] == postId
        }
        if parts.count >= 5 && parts[0] == "documents" {
            return parts[1] == handle && parts[2] == postId && parts[3] == "assets"
        }
        // Web editor uploads created before per-document asset paths were
        // introduced are still TextText-owned and scoped to this workspace.
        return parts.count >= 4 && parts[0] == "editor" && parts[1] == "media"
            && parts[2] == handle
    }

    /// Private media may carry a workspace bearer only when its URL is on the
    /// configured product origin and uses the server's canonical media key.
    static func isTrustedSameOriginMediaURL(_ url: URL, origin: URL) -> Bool {
        trustedMediaPathParts(url, origin: origin) != nil
    }

    static func isLegacyBlobAssetURL(_ url: URL) -> Bool {
        guard let parts = legacyBlobPathParts(url), parts.count >= 4 else {
            return false
        }
        return parts[0] == "captures" || parts[0] == "documents"
            || (parts[0] == "editor" && parts[1] == "media")
    }

    private static func trustedMediaPathParts(_ url: URL, origin: URL) -> [String]? {
        guard let scheme = origin.scheme?.lowercased(),
              let host = origin.host?.lowercased(),
              scheme == "https" || (scheme == "http" && (host == "localhost" || host == "127.0.0.1")),
              origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil,
              origin.path.isEmpty || origin.path == "/",
              url.scheme?.lowercased() == scheme,
              url.host?.lowercased() == host,
              (url.port ?? defaultPort(for: scheme))
                == (origin.port ?? defaultPort(for: scheme)),
              url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath,
              path.hasPrefix("/api/media/") else { return nil }

        let key = String(path.dropFirst("/api/media/".count))
        guard key.utf8.count <= 1024 else { return nil }
        let parts = key.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let allowed = CharacterSet(charactersIn:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
        guard parts.allSatisfy({ part in
            !part.isEmpty && part != "." && part != ".."
                && part.unicodeScalars.allSatisfy(allowed.contains)
        }) else { return nil }
        if parts.count >= 4 && (parts[0] == "documents" || parts[0] == "captures") {
            return parts
        }
        if parts.count >= 5 && parts[0] == "editor" && parts[1] == "media" {
            return parts
        }
        return nil
    }

    private static func legacyBlobPathParts(_ url: URL) -> [String]? {
        guard url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              host.hasSuffix(".blob.vercel-storage.com"),
              url.port == nil || url.port == 443,
              url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath
        else { return nil }
        let parts = path.split(separator: "/").map {
            String($0).removingPercentEncoding ?? ""
        }
        guard parts.allSatisfy({ !$0.isEmpty && !$0.contains("/") }) else { return nil }
        return parts
    }

    private static func defaultPort(for scheme: String) -> Int {
        scheme == "https" ? 443 : 80
    }

    private static func transform(
        _ markdown: String, manifest: TextTextArtifactManifest,
        handle: String, origin: URL?, toLocal: Bool
    ) -> String {
        var result = markdown
        let artifacts = validatedInlineAssets(manifest, handle: handle, origin: origin)
            .sorted { $0.url.count > $1.url.count }
        for artifact in artifacts {
            let relative = "assets/\(artifact.filename)"
            if toLocal {
                result = result.replacingOccurrences(of: artifact.url, with: relative)
            }
        }
        if !toLocal {
            result = canonicalMarkdown(
                local: result,
                remoteURLsByFilename: Dictionary(
                    uniqueKeysWithValues: artifacts.map { ($0.filename, $0.url) }))
        }
        return result
    }
}
