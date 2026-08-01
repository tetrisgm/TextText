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
        _ manifest: TextTextArtifactManifest, handle: String
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
                    url, handle: handle, postId: manifest.postId)
            else { return false }
            return true
        }
    }

    public static func localMarkdown(
        canonical: String, manifest: TextTextArtifactManifest, handle: String
    ) -> String {
        transform(canonical, manifest: manifest, handle: handle, toLocal: true)
    }

    public static func canonicalMarkdown(
        local: String, manifest: TextTextArtifactManifest, handle: String
    ) -> String {
        transform(local, manifest: manifest, handle: handle, toLocal: false)
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
        _ url: URL, handle: String, postId: String
    ) -> Bool {
        guard url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              host.hasSuffix(".blob.vercel-storage.com") else { return false }
        let parts = url.path.split(separator: "/").map {
            String($0).removingPercentEncoding ?? ""
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

    private static func transform(
        _ markdown: String, manifest: TextTextArtifactManifest,
        handle: String, toLocal: Bool
    ) -> String {
        var result = markdown
        let artifacts = validatedInlineAssets(manifest, handle: handle)
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
