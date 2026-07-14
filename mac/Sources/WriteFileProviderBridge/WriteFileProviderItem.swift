import FileProvider
import Foundation
import UniformTypeIdentifiers
import WriteFileProviderKit

/// Stable keys used by the extension's Info.plist action predicates. Finder
/// receives booleans only; the manifest URL itself is resolved fresh when an
/// action runs and is never exposed as predicate metadata.
public enum WriteFileProviderUserInfoKey {
    public static let fileActionsAvailable = "writeFileActions"
    public static let manifestURLAvailable = "writeLinkAvailable"
}

/// Adapts a kit `WriteItem` to the `NSFileProviderItem` the framework consumes.
/// This is the whole surface the extension exposes per item: identity, parent,
/// name, type, capabilities, size, dates, and a version stamp derived from the
/// content hash so the framework knows when to re-materialize.
public final class WriteFileProviderItem: NSObject, NSFileProviderItem {
    /// Current content versions identify both the native representation and the
    /// canonical server hash. Bump this marker whenever local materialization
    /// changes so already-downloaded content is fetched again after an upgrade.
    public static let nativeMaterializationVersion = "native-local-v3:"

    /// Accepted marker from the release that manually returned ZIP snapshots for
    /// TextBundle fetches. Never emit it again; the framework now owns package
    /// transport and receives directory packages directly.
    public static let previousNativeMaterializationVersion = "native-local-v2:"

    /// The first native marker shipped before plain Markdown assets moved into
    /// the central Data/Attachments tree. Accept it while Finder rolls cached
    /// versions forward, but never emit it for newly enumerated items.
    public static let legacyNativeMaterializationVersion = "native-local-v1:"

    /// Accepted legacy marker from the bookmark-sidecar-only materializer.
    /// Keep the public spelling while older extension builds can still return it.
    public static let bookmarkMaterializationVersion = "bookmark-local-v1:"

    private let item: WriteItem

    public init(_ item: WriteItem) {
        self.item = item
    }

    public var itemIdentifier: NSFileProviderItemIdentifier {
        NSFileProviderItemIdentifier(item.identifier)
    }

    public var parentItemIdentifier: NSFileProviderItemIdentifier {
        NSFileProviderItemIdentifier(item.parentIdentifier)
    }

    public var filename: String { item.filename }

    public var contentType: UTType {
        if item.isFolder { return .folder }
        if item.representation == .textbundle {
            return UTType(
                importedAs: WriteItem.textBundleTypeIdentifier,
                conformingTo: .package)
        }
        return UTType(item.typeIdentifier)
            ?? item.representation.flatMap {
                UTType(filenameExtension: $0.filenameExtension)
            }
            ?? .plainText
    }

    public var capabilities: NSFileProviderItemCapabilities {
        nsCapabilities(from: item.capabilities)
    }

    public var documentSize: NSNumber? {
        item.documentSize.map { NSNumber(value: $0) }
    }

    public var creationDate: Date? { item.creationDate }

    public var contentModificationDate: Date? { item.contentModificationDate }

    public var userInfo: [AnyHashable: Any]? {
        guard !item.isFolder else { return nil }
        let hasLink = !(item.manifestURL?.isEmpty ?? true)
        return [
            WriteFileProviderUserInfoKey.fileActionsAvailable: hasLink,
            WriteFileProviderUserInfoKey.manifestURLAvailable: hasLink,
        ]
    }

    /// The framework compares versions to decide when to re-fetch. A file's
    /// content version carries its native representation and the server change
    /// hash; folders have no body, so their content version is a stable constant
    /// and only metadata (name/parent) drives change. Both fields are bounded.
    ///
    /// metadataVersion is representation+name+parent for native files (and the
    /// legacy name+parent identity for non-represented items), deliberately NOT
    /// the content hash:
    /// coupling them made an ordinary body edit (hash changes, name does not)
    /// look like a metadata change too, and — because the Finder filename derives
    /// from the post title — a rename's frontmatter re-render then churned the
    /// metadata channel in a reconciliation loop. Keeping the two versions
    /// independent lets a rename settle the name once and a content change settle
    /// the body once, instead of each re-triggering the other.
    public var itemVersion: NSFileProviderItemVersion {
        let serverHash = item.contentHash ?? "folder"
        let versionedHash = item.representation.map {
            Self.nativeMaterializationVersion + $0.rawValue + ":" + serverHash
        } ?? serverHash
        let content = Data(versionedHash.utf8)
        let metadataIdentity = item.representation.map {
            "metadata\u{0}\($0.rawValue)\u{0}\(item.filename)\u{0}\(item.parentIdentifier.rawValue)"
        } ?? "metadata\u{0}\(item.filename)\u{0}\(item.parentIdentifier.rawValue)"
        let metadata = WriteStableDigest.sha256(metadataIdentity)
        return NSFileProviderItemVersion(
            contentVersion: content, metadataVersion: metadata)
    }

    /// Recover the If-Match hash from current native versions and both forms a
    /// rolling upgrade may hand back: the old raw hash and bookmark-local-v1.
    public static func serverHash(from contentVersion: Data) -> String? {
        guard let value = String(data: contentVersion, encoding: .utf8),
              !value.isEmpty else { return nil }

        if value.hasPrefix(nativeMaterializationVersion)
            || value.hasPrefix(previousNativeMaterializationVersion)
            || value.hasPrefix(legacyNativeMaterializationVersion) {
            let prefix = if value.hasPrefix(nativeMaterializationVersion) {
                nativeMaterializationVersion
            } else if value.hasPrefix(previousNativeMaterializationVersion) {
                previousNativeMaterializationVersion
            } else {
                legacyNativeMaterializationVersion
            }
            let payload = value.dropFirst(prefix.count)
            guard let separator = payload.firstIndex(of: ":"),
                  WriteFileRepresentation(rawValue: String(payload[..<separator])) != nil else {
                return nil
            }
            let hash = payload[payload.index(after: separator)...]
            return hash.isEmpty ? nil : String(hash)
        }

        if value.hasPrefix(bookmarkMaterializationVersion) {
            let hash = value.dropFirst(bookmarkMaterializationVersion.count)
            return hash.isEmpty ? nil : String(hash)
        }

        return value
    }

    /// Keep every file downloaded on disk (a filled icon, not a hollow "download
    /// on demand" cloud): the owner wants their whole workspace present locally,
    /// always. A server edit is refreshed by the bridge (evict the stale copy on a
    /// detected change, then re-materialize), and this policy re-downloads it to
    /// keep it present and current.
    @available(macOS 14.0, *)
    public var contentPolicy: NSFileProviderContentPolicy {
        .downloadEagerlyAndKeepDownloaded
    }
}
