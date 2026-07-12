import Foundation

/// The stable identity the File Provider hangs every item off, independent of
/// the FileProvider framework so it stays unit-testable. Each case round-trips
/// through a raw string, and the three reserved cases use Apple's documented
/// constant values so `NSFileProviderItemIdentifier(rawValue:)` in the
/// extension bridges them for free.
public enum WriteItemIdentifier: Hashable, Sendable {
    /// The domain root; its children are the workspace's top-level folders.
    case rootContainer
    /// The working set (everything the system may want to index/materialize).
    case workingSet
    /// The trash. Write soft-deletes; this is where evicted items surface.
    case trashContainer
    /// A workspace folder (server folder id).
    case folder(String)
    /// A content item (server post id): article, project, talk, note, bookmark.
    case file(String)

    // Apple's reserved identifier raw values. Matching them exactly means the
    // extension can do `NSFileProviderItemIdentifier(rawValue: id.rawValue)`
    // and get `.rootContainer` etc. without a translation table.
    static let rootRaw = "NSFileProviderRootContainerItemIdentifier"
    static let workingSetRaw = "NSFileProviderWorkingSetContainerItemIdentifier"
    static let trashRaw = "NSFileProviderTrashContainerItemIdentifier"

    static let folderPrefix = "folder:"
    static let filePrefix = "file:"

    public var rawValue: String {
        switch self {
        case .rootContainer: return Self.rootRaw
        case .workingSet: return Self.workingSetRaw
        case .trashContainer: return Self.trashRaw
        case .folder(let id): return Self.folderPrefix + id
        case .file(let id): return Self.filePrefix + id
        }
    }

    public init?(rawValue: String) {
        switch rawValue {
        case Self.rootRaw: self = .rootContainer
        case Self.workingSetRaw: self = .workingSet
        case Self.trashRaw: self = .trashContainer
        default:
            if rawValue.hasPrefix(Self.folderPrefix) {
                let id = String(rawValue.dropFirst(Self.folderPrefix.count))
                guard !id.isEmpty else { return nil }
                self = .folder(id)
            } else if rawValue.hasPrefix(Self.filePrefix) {
                let id = String(rawValue.dropFirst(Self.filePrefix.count))
                guard !id.isEmpty else { return nil }
                self = .file(id)
            } else {
                return nil
            }
        }
    }

    /// True for containers the enumerator can list children of.
    public var isContainer: Bool {
        switch self {
        case .rootContainer, .workingSet, .trashContainer, .folder:
            return true
        case .file:
            return false
        }
    }
}
