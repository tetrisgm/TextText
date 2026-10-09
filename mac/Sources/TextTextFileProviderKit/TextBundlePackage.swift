import Foundation
import TextTextWorkspaceCore
import ZIPFoundation

public enum TextTextTextBundleError: Error, Equatable {
    case invalidPackage(String)
    case packageTooLarge
}

public struct TextTextTextBundleRemoteAsset: Codable, Equatable, Sendable {
    public let url: String
    public let contentType: String?
    /// Digest of the package bytes when the remote URL was assigned. If a user
    /// replaces the file inside `assets/`, the mismatch makes it a new local
    /// asset that must be uploaded before the next Markdown revision is saved.
    public let sha256: String?

    public init(url: String, contentType: String? = nil, sha256: String? = nil) {
        self.url = url
        self.contentType = contentType
        self.sha256 = sha256
    }
}

public struct TextTextTextBundleInfo: Codable, Equatable, Sendable {
    public let version: Int
    public let type: String
    public let transient: Bool
    public let creatorIdentifier: String
    public let sourceURL: String?
    public let remoteAssets: [String: TextTextTextBundleRemoteAsset]

    public init(
        sourceURL: String? = nil,
        remoteAssets: [String: TextTextTextBundleRemoteAsset] = [:]
    ) {
        version = 2
        type = "net.daringfireball.markdown"
        transient = false
        creatorIdentifier = "app.texttext"
        self.sourceURL = sourceURL
        self.remoteAssets = remoteAssets
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case type
        case transient
        case creatorIdentifier
        case sourceURL
        case remoteAssets = "net.texttext.assets"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        type = try values.decode(String.self, forKey: .type)
        transient = try values.decodeIfPresent(Bool.self, forKey: .transient) ?? false
        creatorIdentifier = try values.decodeIfPresent(
            String.self, forKey: .creatorIdentifier) ?? ""
        sourceURL = try values.decodeIfPresent(String.self, forKey: .sourceURL)
        remoteAssets = try values.decodeIfPresent(
            [String: TextTextTextBundleRemoteAsset].self, forKey: .remoteAssets) ?? [:]
    }
}

public struct TextTextTextBundleAsset: Equatable, Sendable {
    public let filename: String
    public let data: Data
    public let contentType: String?
    public let remoteURL: String?

    public init(filename: String, data: Data, contentType: String? = nil,
                remoteURL: String? = nil) {
        self.filename = filename
        self.data = data
        self.contentType = contentType
        self.remoteURL = remoteURL
    }
}

public struct TextTextTextBundleContents: Equatable, Sendable {
    public let markdown: String
    public let sourceURL: String?
    public let documentJSON: String?
    /// The look itself, as `template.json`. `document.json` names an id and a
    /// version, which means nothing outside the workspace that stores it, so a
    /// textpack could carry a recipe's cook time and still not know how a
    /// recipe reads. Nil for a bundle written before this existed.
    public let templateJSON: String?
    /// Editable source for the embedded look, stored as `template-source.json`.
    /// The native bridge preserves it without interpreting its schema.
    public let templateAuthoringSourceJSON: String?
    /// `net.texttext.projection.json`: the last coherent baseline stamped with
    /// text.md and document.json. Nil for a bundle written before this existed.
    public let projectionJSON: String?
    public let assets: [TextTextTextBundleAsset]
    public let logicalSize: Int
}

/// Materializes one TextText item as one TextBundle package. The sync wire keeps
/// canonical Markdown with immutable TextText-hosted URLs; only the local package
/// swaps those URLs for `assets/<name>` references.
public enum TextTextTextBundlePackage {
    public static let typeIdentifier = "org.textbundle.package"
    public static let maximumEntryCount = 2_048
    public static let maximumUncompressedSize: UInt64 = 512 * 1_024 * 1_024

    public struct MaterializedAsset: Equatable, Sendable {
        public let filename: String
        public let data: Data
        public let remoteURL: String
        public let contentType: String?
        public let title: String?

        public init(
            filename: String, data: Data, remoteURL: String,
            contentType: String? = nil, title: String? = nil
        ) {
            self.filename = filename
            self.data = data
            self.remoteURL = remoteURL
            self.contentType = contentType
            self.title = title
        }
    }

    public struct MaterializedPackage: Equatable, Sendable {
        public let url: URL
        public let logicalSize: Int
    }

    public static func materialize(
        canonicalMarkdown: String,
        documentJSON: String? = nil,
        templateJSON: String? = nil,
        templateAuthoringSourceJSON: String? = nil,
        /// When non-nil the caller asserts text.md and document.json express
        /// one document; the sidecar is then re-digested over the local bytes.
        projectionJSON: String? = nil,
        /// An existing sidecar to carry verbatim when this write does not
        /// produce a new stamp (a Markdown-only or JSON-only rewrite). Its
        /// digests still say which entry moved since the last coherent save.
        carriedProjectionJSON: String? = nil,
        assets: [MaterializedAsset],
        sourceURL: String?,
        in temporaryDirectory: URL
    ) throws -> MaterializedPackage {
        let fileManager = FileManager.default
        let packageURL = temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("textbundle")
        let assetsURL = packageURL.appendingPathComponent("assets", isDirectory: true)
        try fileManager.createDirectory(
            at: assetsURL, withIntermediateDirectories: true)

        var localMarkdown = canonicalMarkdown
        var localDocumentJSON = documentJSON
        var mappings: [String: TextTextTextBundleRemoteAsset] = [:]
        var logicalSize = 0
        for asset in assets.sorted(by: { $0.filename < $1.filename }) {
            guard isSafeAssetFilename(asset.filename), mappings[asset.filename] == nil else {
                throw TextTextTextBundleError.invalidPackage("Unsafe or duplicate asset name")
            }
            let localReference = "assets/\(asset.filename)"
            // An asset carried through with its local reference needs no
            // rewrite; skipping it keeps document.json byte for byte, which
            // keeps an earlier projection stamp's digest valid.
            if asset.remoteURL != localReference {
                localMarkdown = localMarkdown.replacingOccurrences(
                    of: asset.remoteURL, with: localReference)
                // A Markdown-only write over a pack that already carries local
                // references (the usual case: info.json remembers the remote
                // URL, document.json does not) keeps document.json byte for
                // byte: `replacingStrings` only re-serializes when it replaced.
                if let current = localDocumentJSON {
                    localDocumentJSON = try replacingStrings(
                        inJSON: current,
                        replacements: [asset.remoteURL: localReference])
                }
            }
            mappings[asset.filename] = TextTextTextBundleRemoteAsset(
                url: asset.remoteURL, contentType: asset.contentType,
                sha256: TextTextStableDigest.sha256Hex(asset.data))
            try asset.data.write(
                to: assetsURL.appendingPathComponent(asset.filename), options: .atomic)
            logicalSize += asset.data.count
        }

        let markdownData = Data(localMarkdown.utf8)
        try markdownData.write(
            to: packageURL.appendingPathComponent("text.md"), options: .atomic)
        logicalSize += markdownData.count

        if let localDocumentJSON {
            let documentData = Data(localDocumentJSON.utf8)
            try documentData.write(
                to: packageURL.appendingPathComponent("document.json"), options: .atomic)
            logicalSize += documentData.count
        }

        if let templateJSON {
            // Not asset-rewritten: a look is a render spec over content
            // bindings and never holds an asset URL of its own.
            let templateData = Data(templateJSON.utf8)
            try templateData.write(
                to: packageURL.appendingPathComponent("template.json"), options: .atomic)
            logicalSize += templateData.count
        }

        if templateJSON != nil, let templateAuthoringSourceJSON {
            let sourceData = Data(templateAuthoringSourceJSON.utf8)
            try sourceData.write(
                to: packageURL.appendingPathComponent("template-source.json"), options: .atomic)
            logicalSize += sourceData.count
        }

        if projectionJSON != nil, let localDocumentJSON,
           let itemId = MarkdownIdentityCodec.extract(from: localMarkdown)?.itemId,
           let stamp = TextTextProjectionBaseline.stamp(
               itemId: itemId, markdown: markdownData, documentJSON: Data(localDocumentJSON.utf8)) {
            try stamp.write(
                to: packageURL.appendingPathComponent(TextTextProjectionBaseline.entryName), options: .atomic)
            logicalSize += stamp.count
        } else if let carriedProjectionJSON, localDocumentJSON != nil {
            let carried = Data(carriedProjectionJSON.utf8)
            try carried.write(
                to: packageURL.appendingPathComponent(TextTextProjectionBaseline.entryName), options: .atomic)
            logicalSize += carried.count
        }

        let info = TextTextTextBundleInfo(sourceURL: sourceURL, remoteAssets: mappings)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let infoData = try encoder.encode(info)
        try infoData.write(
            to: packageURL.appendingPathComponent("info.json"), options: .atomic)
        logicalSize += infoData.count

        return MaterializedPackage(url: packageURL, logicalSize: logicalSize)
    }

    /// Zip a materialized textbundle directory into a single `.textpack` leaf file
    /// (the zipped, single-file textbundle form Bear/Ulysses read). `read`
    /// auto-detects the archive and unzips it, so the round-trip is symmetric.
    /// `shouldKeepParent` keeps the `<name>.textbundle` directory as the archive
    /// root, which `findPackageRoot` then locates during read.
    public static func zipToTextPack(
        packageURL: URL, in temporaryDirectory: URL
    ) throws -> URL {
        let textpackURL = temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("textpack")
        try FileManager.default.zipItem(
            at: packageURL, to: textpackURL,
            shouldKeepParent: true, compressionMethod: .deflate)
        return textpackURL
    }

    public static func read(from suppliedURL: URL, in temporaryDirectory: URL) throws
        -> TextTextTextBundleContents {
        var extractionRootToRemove: URL?
        defer {
            if let extractionRootToRemove {
                try? FileManager.default.removeItem(at: extractionRootToRemove)
            }
        }
        let packageRoot: URL
        let values = try suppliedURL.resourceValues(forKeys: [.isDirectoryKey])
        if values.isDirectory == true {
            packageRoot = suppliedURL
        } else {
            let extractionRoot = temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            extractionRootToRemove = extractionRoot
            try FileManager.default.createDirectory(
                at: extractionRoot, withIntermediateDirectories: true)
            try extractArchive(at: suppliedURL, to: extractionRoot)
            packageRoot = try findPackageRoot(in: extractionRoot)
        }

        let infoURL = packageRoot.appendingPathComponent("info.json")
        let markdownURL = packageRoot.appendingPathComponent("text.md")
        let info = try JSONDecoder().decode(
            TextTextTextBundleInfo.self, from: Data(contentsOf: infoURL))
        guard info.version == 2,
              info.type == "net.daringfireball.markdown" else {
            throw TextTextTextBundleError.invalidPackage("Unsupported TextBundle metadata")
        }

        let markdownData = try Data(contentsOf: markdownURL)
        guard let markdown = String(data: markdownData, encoding: .utf8) else {
            throw TextTextTextBundleError.invalidPackage("text.md is not UTF-8")
        }
        var logicalSize = markdownData.count + (try Data(contentsOf: infoURL)).count
        let documentURL = packageRoot.appendingPathComponent("document.json")
        var documentJSON: String?
        if FileManager.default.fileExists(atPath: documentURL.path) {
            let documentData = try Data(contentsOf: documentURL)
            guard let decoded = String(data: documentData, encoding: .utf8) else {
                throw TextTextTextBundleError.invalidPackage("document.json is not UTF-8")
            }
            _ = try decodedJSONObject(decoded)
            documentJSON = decoded
            logicalSize += documentData.count
        }
        let templateURL = packageRoot.appendingPathComponent("template.json")
        var templateJSON: String?
        if FileManager.default.fileExists(atPath: templateURL.path) {
            let templateData = try Data(contentsOf: templateURL)
            guard let decoded = String(data: templateData, encoding: .utf8) else {
                throw TextTextTextBundleError.invalidPackage("template.json is not UTF-8")
            }
            _ = try decodedJSONObject(decoded, filename: "template.json")
            templateJSON = decoded
            logicalSize += templateData.count
        }
        let templateSourceURL = packageRoot.appendingPathComponent("template-source.json")
        var templateAuthoringSourceJSON: String?
        if FileManager.default.fileExists(atPath: templateSourceURL.path),
            let sourceData = try? Data(contentsOf: templateSourceURL) {
            logicalSize += sourceData.count
            // The source is optional editing metadata. A damaged source must
            // not make the document or its still-valid look unreadable.
            if templateJSON != nil,
                let decoded = String(data: sourceData, encoding: .utf8),
                (try? decodedJSONObject(
                    decoded, filename: "template-source.json")) != nil {
                templateAuthoringSourceJSON = decoded
            }
        }
        let projectionURL = packageRoot.appendingPathComponent(TextTextProjectionBaseline.entryName)
        var projectionJSON: String?
        if FileManager.default.fileExists(atPath: projectionURL.path),
            let projectionData = try? Data(contentsOf: projectionURL) {
            logicalSize += projectionData.count
            // Recovery metadata only: a damaged sidecar is simply absent.
            if let decoded = String(data: projectionData, encoding: .utf8),
                (try? decodedJSONObject(decoded, filename: TextTextProjectionBaseline.entryName)) != nil {
                projectionJSON = decoded
            }
        }
        var assets: [TextTextTextBundleAsset] = []
        var remoteURLsByFilename: [String: String] = [:]
        let assetsURL = packageRoot.appendingPathComponent("assets", isDirectory: true)
        let assetURLs = (try? FileManager.default.contentsOfDirectory(
            at: assetsURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles])) ?? []
        for assetURL in assetURLs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let resourceValues = try assetURL.resourceValues(forKeys: [.isRegularFileKey])
            guard resourceValues.isRegularFile == true,
                  isSafeAssetFilename(assetURL.lastPathComponent) else {
                throw TextTextTextBundleError.invalidPackage("Unsafe TextBundle asset")
            }
            let data = try Data(contentsOf: assetURL)
            logicalSize += data.count
            let mapping = info.remoteAssets[assetURL.lastPathComponent]
            let matchesRemote = mapping?.sha256.map {
                $0 == TextTextStableDigest.sha256Hex(data)
            } ?? (mapping != nil)
            if matchesRemote, let remoteURL = mapping?.url {
                remoteURLsByFilename[assetURL.lastPathComponent] = remoteURL
            }
            assets.append(TextTextTextBundleAsset(
                filename: assetURL.lastPathComponent,
                data: data,
                contentType: mapping?.contentType
                    ?? TextTextDocumentAssets.inferredContentType(
                        filename: assetURL.lastPathComponent),
                remoteURL: matchesRemote ? mapping?.url : nil))
        }
        let canonicalMarkdown = TextTextDocumentAssets.canonicalMarkdown(
            local: markdown, remoteURLsByFilename: remoteURLsByFilename)
        documentJSON = try canonicalDocumentJSON(
            local: documentJSON,
            remoteURLsByFilename: remoteURLsByFilename)
        return TextTextTextBundleContents(
            markdown: canonicalMarkdown,
            sourceURL: info.sourceURL,
            documentJSON: documentJSON,
            templateJSON: templateJSON,
            templateAuthoringSourceJSON: templateAuthoringSourceJSON,
            projectionJSON: projectionJSON,
            assets: assets, logicalSize: logicalSize)
    }

    /// Replaces package-local asset references inside a validated document JSON
    /// object with their immutable server URLs. The same mapping is applied to
    /// Markdown separately so both projections remain portable and consistent.
    public static func canonicalDocumentJSON(
        local: String?, remoteURLsByFilename: [String: String]
    ) throws -> String? {
        guard let local else { return nil }
        return try replacingStrings(
            inJSON: local,
            replacements: Dictionary(
                uniqueKeysWithValues: remoteURLsByFilename.map {
                    ("assets/\($0.key)", $0.value)
                }))
    }

    public static func isSafeAssetFilename(_ filename: String) -> Bool {
        guard !filename.isEmpty, filename != ".", filename != "..",
              filename.utf8.count <= 255,
              !filename.contains("/"), !filename.contains("\\"),
              !filename.hasPrefix(".") else { return false }
        return filename.unicodeScalars.allSatisfy {
            !CharacterSet.controlCharacters.contains($0)
        }
    }

    private static func extractArchive(at archiveURL: URL, to destination: URL) throws {
        let archive: Archive
        do {
            archive = try Archive(url: archiveURL, accessMode: .read)
        } catch {
            throw TextTextTextBundleError.invalidPackage("TextBundle is not a ZIP archive")
        }
        var entryCount = 0
        var uncompressedSize: UInt64 = 0
        for entry in archive {
            entryCount += 1
            guard entryCount <= maximumEntryCount,
                  entry.uncompressedSize
                    <= maximumUncompressedSize - uncompressedSize else {
                throw TextTextTextBundleError.packageTooLarge
            }
            uncompressedSize += entry.uncompressedSize
            guard entry.type != .symlink,
                  isSafeArchivePath(entry.path) else {
                throw TextTextTextBundleError.invalidPackage("Unsafe TextBundle archive path")
            }
            let outputURL = destination.appendingPathComponent(entry.path)
            _ = try archive.extract(entry, to: outputURL)
        }
    }

    private static func isSafeArchivePath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\") else {
            return false
        }
        // A zip directory entry legitimately ends in "/" (e.g. "assets/" or the
        // "<name>.textbundle/" parent a .textpack keeps). Drop that trailing marker
        // before validating components; traversal ("..") and absolute paths are
        // still rejected.
        let normalized = path.hasSuffix("/") ? String(path.dropLast()) : path
        let components = normalized.split(separator: "/", omittingEmptySubsequences: false)
        return components.allSatisfy { component in
            !component.isEmpty && component != "." && component != ".."
        }
    }

    private static func findPackageRoot(in extractionRoot: URL) throws -> URL {
        let fileManager = FileManager.default
        if fileManager.fileExists(
            atPath: extractionRoot.appendingPathComponent("text.md").path) {
            return extractionRoot
        }
        let children = try fileManager.contentsOfDirectory(
            at: extractionRoot,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles])
        let candidates = children.filter { child in
            guard (try? child.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            else { return false }
            return fileManager.fileExists(
                atPath: child.appendingPathComponent("text.md").path)
        }
        guard candidates.count == 1, let candidate = candidates.first else {
            throw TextTextTextBundleError.invalidPackage("Missing TextBundle text.md")
        }
        return candidate
    }

    private static func decodedJSONObject(
        _ json: String, filename: String = "document.json"
    ) throws -> Any {
        let data = Data(json.utf8)
        let value: Any
        do {
            value = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw TextTextTextBundleError.invalidPackage("\(filename) is not valid JSON")
        }
        guard value is [String: Any] else {
            throw TextTextTextBundleError.invalidPackage("\(filename) must contain an object")
        }
        return value
    }

    private static func replacingStrings(
        inJSON json: String, replacements: [String: String]
    ) throws -> String {
        let root = try decodedJSONObject(json)
        var changed = false
        func replace(_ value: Any) -> Any {
            if let string = value as? String {
                let replaced = replacements.reduce(string) { result, replacement in
                    result.replacingOccurrences(
                        of: replacement.key, with: replacement.value)
                }
                if replaced != string { changed = true }
                return replaced
            }
            if let array = value as? [Any] { return array.map(replace) }
            if let object = value as? [String: Any] {
                return object.mapValues(replace)
            }
            return value
        }
        let replaced = replace(root)
        // Nothing to rewrite: keep the caller's exact bytes rather than
        // re-serializing, so an unchanged representation keeps its digest.
        guard changed else { return json }
        let encoded = try JSONSerialization.data(
            withJSONObject: replaced,
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        guard let result = String(data: encoded, encoding: .utf8) else {
            throw TextTextTextBundleError.invalidPackage("document.json is not UTF-8")
        }
        return result + "\n"
    }
}
