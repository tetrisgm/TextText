import FileProvider
import Foundation
import UniformTypeIdentifiers
import WriteFileProviderKit

/// Adapts a kit `WriteItem` to the `NSFileProviderItem` the framework consumes.
/// This is the whole surface the extension exposes per item: identity, parent,
/// name, type, capabilities, size, dates, and a version stamp derived from the
/// content hash so the framework knows when to re-materialize.
public final class WriteFileProviderItem: NSObject, NSFileProviderItem {
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
        return UTType(item.typeIdentifier)
            ?? UTType(filenameExtension: "md")
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

    /// The framework compares versions to decide when to re-fetch. The content
    /// hash is exactly the server's change signal for a file; folders have no
    /// body, so their content version is a stable constant and only metadata
    /// (name/parent) drives change. Both fields must be non-empty and small.
    ///
    /// metadataVersion is name+parent ONLY, deliberately NOT the content hash:
    /// coupling them made an ordinary body edit (hash changes, name does not)
    /// look like a metadata change too, and — because the Finder filename derives
    /// from the post title — a rename's frontmatter re-render then churned the
    /// metadata channel in a reconciliation loop. Keeping the two versions
    /// independent lets a rename settle the name once and a content change settle
    /// the body once, instead of each re-triggering the other.
    public var itemVersion: NSFileProviderItemVersion {
        let content = Data((item.contentHash ?? "folder").utf8)
        let metadata = Data("\(item.filename)|\(item.parentIdentifier.rawValue)".utf8)
        return NSFileProviderItemVersion(
            contentVersion: content, metadataVersion: metadata)
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
