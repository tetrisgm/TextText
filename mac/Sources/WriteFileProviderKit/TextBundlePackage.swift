import Foundation
import ZIPFoundation

public enum WriteTextBundleError: Error, Equatable {
    case invalidPackage(String)
    case packageTooLarge
}

public struct WriteTextBundleRemoteAsset: Codable, Equatable, Sendable {
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

public struct WriteTextBundleInfo: Codable, Equatable, Sendable {
    public let version: Int
    public let type: String
    public let transient: Bool
    public let creatorIdentifier: String
    public let sourceURL: String?
    public let writeAssets: [String: WriteTextBundleRemoteAsset]

    public init(
        sourceURL: String? = nil,
        writeAssets: [String: WriteTextBundleRemoteAsset] = [:]
    ) {
        version = 2
        type = "net.daringfireball.markdown"
        transient = false
        creatorIdentifier = "net.writeapp.write"
        self.sourceURL = sourceURL
        self.writeAssets = writeAssets
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case type
        case transient
        case creatorIdentifier
        case sourceURL
        case writeAssets = "net.writeapp.assets"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        type = try values.decode(String.self, forKey: .type)
        transient = try values.decodeIfPresent(Bool.self, forKey: .transient) ?? false
        creatorIdentifier = try values.decodeIfPresent(
            String.self, forKey: .creatorIdentifier) ?? ""
        sourceURL = try values.decodeIfPresent(String.self, forKey: .sourceURL)
        writeAssets = try values.decodeIfPresent(
            [String: WriteTextBundleRemoteAsset].self, forKey: .writeAssets) ?? [:]
    }
}

public struct WriteTextBundleAsset: Equatable, Sendable {
    public let filename: String
    public let data: Data
    public let contentType: String?
    public let remoteURL: String?
}

public struct WriteTextBundleContents: Equatable, Sendable {
    public let markdown: String
    public let assets: [WriteTextBundleAsset]
    public let logicalSize: Int
}

/// Materializes one Write item as one TextBundle package. The sync wire keeps
/// canonical Markdown with immutable Write-hosted URLs; only the local package
/// swaps those URLs for `assets/<name>` references.
public enum WriteTextBundlePackage {
    public static let typeIdentifier = "org.textbundle.package"
    public static let maximumEntryCount = 2_048
    public static let maximumUncompressedSize: UInt64 = 512 * 1_024 * 1_024

    public struct MaterializedAsset: Equatable, Sendable {
        public let filename: String
        public let data: Data
        public let remoteURL: String
        public let contentType: String?

        public init(
            filename: String, data: Data, remoteURL: String,
            contentType: String? = nil
        ) {
            self.filename = filename
            self.data = data
            self.remoteURL = remoteURL
            self.contentType = contentType
        }
    }

    public struct MaterializedPackage: Equatable, Sendable {
        public let url: URL
        public let logicalSize: Int
    }

    public static func materialize(
        canonicalMarkdown: String,
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
        var mappings: [String: WriteTextBundleRemoteAsset] = [:]
        var logicalSize = 0
        for asset in assets.sorted(by: { $0.filename < $1.filename }) {
            guard isSafeAssetFilename(asset.filename), mappings[asset.filename] == nil else {
                throw WriteTextBundleError.invalidPackage("Unsafe or duplicate asset name")
            }
            let localReference = "assets/\(asset.filename)"
            localMarkdown = localMarkdown.replacingOccurrences(
                of: asset.remoteURL, with: localReference)
            mappings[asset.filename] = WriteTextBundleRemoteAsset(
                url: asset.remoteURL, contentType: asset.contentType,
                sha256: WriteStableDigest.sha256Hex(asset.data))
            try asset.data.write(
                to: assetsURL.appendingPathComponent(asset.filename), options: .atomic)
            logicalSize += asset.data.count
        }

        let markdownData = Data(localMarkdown.utf8)
        try markdownData.write(
            to: packageURL.appendingPathComponent("text.md"), options: .atomic)
        logicalSize += markdownData.count

        let info = WriteTextBundleInfo(sourceURL: sourceURL, writeAssets: mappings)
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
        -> WriteTextBundleContents {
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
            WriteTextBundleInfo.self, from: Data(contentsOf: infoURL))
        guard info.version == 2,
              info.type == "net.daringfireball.markdown" else {
            throw WriteTextBundleError.invalidPackage("Unsupported TextBundle metadata")
        }

        let markdownData = try Data(contentsOf: markdownURL)
        guard let markdown = String(data: markdownData, encoding: .utf8) else {
            throw WriteTextBundleError.invalidPackage("text.md is not UTF-8")
        }
        var logicalSize = markdownData.count + (try Data(contentsOf: infoURL)).count
        var assets: [WriteTextBundleAsset] = []
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
                throw WriteTextBundleError.invalidPackage("Unsafe TextBundle asset")
            }
            let data = try Data(contentsOf: assetURL)
            logicalSize += data.count
            let mapping = info.writeAssets[assetURL.lastPathComponent]
            let matchesRemote = mapping?.sha256.map {
                $0 == WriteStableDigest.sha256Hex(data)
            } ?? (mapping != nil)
            if matchesRemote, let remoteURL = mapping?.url {
                remoteURLsByFilename[assetURL.lastPathComponent] = remoteURL
            }
            assets.append(WriteTextBundleAsset(
                filename: assetURL.lastPathComponent,
                data: data,
                contentType: mapping?.contentType,
                remoteURL: matchesRemote ? mapping?.url : nil))
        }
        return WriteTextBundleContents(
            markdown: WriteDocumentAssets.canonicalMarkdown(
                local: markdown, remoteURLsByFilename: remoteURLsByFilename),
            assets: assets, logicalSize: logicalSize)
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
            throw WriteTextBundleError.invalidPackage("TextBundle is not a ZIP archive")
        }
        var entryCount = 0
        var uncompressedSize: UInt64 = 0
        for entry in archive {
            entryCount += 1
            guard entryCount <= maximumEntryCount,
                  entry.uncompressedSize
                    <= maximumUncompressedSize - uncompressedSize else {
                throw WriteTextBundleError.packageTooLarge
            }
            uncompressedSize += entry.uncompressedSize
            guard entry.type != .symlink,
                  isSafeArchivePath(entry.path) else {
                throw WriteTextBundleError.invalidPackage("Unsafe TextBundle archive path")
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
            throw WriteTextBundleError.invalidPackage("Missing TextBundle text.md")
        }
        return candidate
    }
}
