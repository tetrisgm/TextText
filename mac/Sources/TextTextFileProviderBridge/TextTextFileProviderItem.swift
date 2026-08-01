import FileProvider
import Foundation
import UniformTypeIdentifiers
import TextTextFileProviderKit

/// Stable keys used by the extension's Info.plist action predicates. Finder
/// receives booleans only; the manifest URL itself is resolved fresh when an
/// action runs and is never exposed as predicate metadata.
public enum TextTextFileProviderUserInfoKey {
    public static let fileActionsAvailable = "textTextFileActions"
    public static let manifestURLAvailable = "textTextLinkAvailable"
}

/// Adapts a kit `TextTextItem` to the `NSFileProviderItem` the framework consumes.
/// This is the whole surface the extension exposes per item: identity, parent,
/// name, type, capabilities, size, dates, and a version stamp derived from the
/// content hash so the framework knows when to re-materialize.
public final class TextTextFileProviderItem: NSObject, NSFileProviderItem {
    /// Current content versions identify both the native representation and the
    /// canonical server hash. Bump this marker whenever local materialization
    /// changes so already-downloaded content is fetched again after an upgrade.
    /// v4 forces one re-fetch of every item after the `.textpack` cutover, so a
    /// mount left holding stale zero-byte replicas refills from the server.
    public static let nativeMaterializationVersion = "native-local-v4:"

    /// Accepted marker from the release just before the `.textpack` create-format
    /// cutover (posts materialized as `.md`/`.textbundle`). Never emit it again;
    /// accept it only so a dirty replica still versioned with it can recover its
    /// If-Match server hash across the upgrade.
    public static let priorNativeMaterializationVersion = "native-local-v3:"

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

    private let item: TextTextItem

    public init(_ item: TextTextItem) {
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
            let textBundle = UTType(
                importedAs: TextTextItem.textBundleTypeIdentifier,
                conformingTo: .package)
            // Some hosts already register org.textbundle.package without its
            // package conformance. File Provider must still receive a package
            // type or it can reconcile the directory name and contents as
            // separate nodes. The filename retains the TextBundle association.
            return textBundle.conforms(to: .package) ? textBundle : .package
        }
        // A .textpack is a zipped textbundle - a single LEAF file. Prefer the
        // registered `org.textbundle.pack` UTI (the app bundle declares it,
        // conforming to public.zip-archive with the `textpack` extension) so a
        // double-clicked .textpack opens in TextText, its declared Owner, instead of
        // Archive Utility, which owns the generic public.zip-archive. Accept that
        // resolved type ONLY when it is a zip leaf and NOT a package: a package
        // conformance would let its directory name and body reconcile separately
        // and revive the rename revert-loop. Fall back to the concrete zip type
        // (still a leaf) when the UTI is unregistered - e.g. in unit tests that do
        // not load the app bundle's type declarations, where an `importedAs`
        // placeholder does NOT reliably conform to .zip.
        if item.representation == .textpack {
            if let pack = UTType(TextTextItem.textPackTypeIdentifier),
               pack.conforms(to: .zip), !pack.conforms(to: .package) {
                return pack
            }
            return .zip
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
            TextTextFileProviderUserInfoKey.fileActionsAvailable: hasLink,
            TextTextFileProviderUserInfoKey.manifestURLAvailable: hasLink,
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
    /// look like a metadata change too, and - because the Finder filename derives
    /// from the post title - a rename's frontmatter re-render then churned the
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
        let metadata = TextTextStableDigest.sha256(metadataIdentity)
        return NSFileProviderItemVersion(
            contentVersion: content, metadataVersion: metadata)
    }

    /// Recover the If-Match hash from current native versions and both forms a
    /// rolling upgrade may hand back: the old raw hash and bookmark-local-v1.
    public static func serverHash(from contentVersion: Data) -> String? {
        guard let value = String(data: contentVersion, encoding: .utf8),
              !value.isEmpty else { return nil }

        let nativeMarkers = [
            nativeMaterializationVersion,
            priorNativeMaterializationVersion,
            previousNativeMaterializationVersion,
            legacyNativeMaterializationVersion,
        ]
        if let prefix = nativeMarkers.first(where: { value.hasPrefix($0) }) {
            let payload = value.dropFirst(prefix.count)
            guard let separator = payload.firstIndex(of: ":"),
                  TextTextFileRepresentation(rawValue: String(payload[..<separator])) != nil else {
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
