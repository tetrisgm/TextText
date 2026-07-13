import Foundation

/// The stable identity the File Provider hangs every item off, independent of
/// the FileProvider framework so it stays unit-testable. Each case round-trips
/// through a raw string, and the three reserved cases use Apple's documented
/// constant values so `NSFileProviderItemIdentifier(rawValue:)` in the
/// extension bridges them for free.
///
/// Folder and file identifiers are scoped by the workspace HANDLE they belong
/// to, because a single "Write" domain now spans every workspace the user has
/// joined: the extension reads the handle straight out of the identifier to pick
/// that workspace's `wsk_` token. The three reserved containers stay global (not
/// handle-scoped) so the framework bridge stays a free round-trip and the root
/// self-parents.
public enum WriteItemIdentifier: Hashable, Sendable {
    /// The domain root; its children are the workspace containers.
    case rootContainer
    /// The working set (everything the system may want to index/materialize).
    case workingSet
    /// The trash. Write soft-deletes; this is where evicted items surface.
    case trashContainer
    /// A workspace container (server workspace handle); its children are that
    /// workspace's top-level system folders.
    case workspace(String)
    /// A workspace folder (workspace handle + server folder id).
    case folder(handle: String, id: String)
    /// A content item (workspace handle + server post id).
    case file(handle: String, id: String)

    // Apple's reserved identifier raw values. Matching them exactly means the
    // extension can do `NSFileProviderItemIdentifier(rawValue: id.rawValue)`
    // and get `.rootContainer` etc. without a translation table.
    static let rootRaw = "NSFileProviderRootContainerItemIdentifier"
    static let workingSetRaw = "NSFileProviderWorkingSetContainerItemIdentifier"
    static let trashRaw = "NSFileProviderTrashContainerItemIdentifier"

    static let workspacePrefix = "workspace:"
    static let folderPrefix = "folder:"
    static let filePrefix = "file:"

    public var rawValue: String {
        switch self {
        case .rootContainer: return Self.rootRaw
        case .workingSet: return Self.workingSetRaw
        case .trashContainer: return Self.trashRaw
        case .workspace(let handle): return Self.workspacePrefix + handle
        case .folder(let handle, let id): return Self.folderPrefix + handle + ":" + id
        case .file(let handle, let id): return Self.filePrefix + handle + ":" + id
        }
    }

    public init?(rawValue: String) {
        switch rawValue {
        case Self.rootRaw: self = .rootContainer
        case Self.workingSetRaw: self = .workingSet
        case Self.trashRaw: self = .trashContainer
        default:
            if rawValue.hasPrefix(Self.workspacePrefix) {
                let handle = String(rawValue.dropFirst(Self.workspacePrefix.count))
                guard !handle.isEmpty else { return nil }
                self = .workspace(handle)
            } else if rawValue.hasPrefix(Self.folderPrefix) {
                guard let (h, id) = Self.split(rawValue.dropFirst(Self.folderPrefix.count))
                else { return nil }
                self = .folder(handle: h, id: id)
            } else if rawValue.hasPrefix(Self.filePrefix) {
                guard let (h, id) = Self.split(rawValue.dropFirst(Self.filePrefix.count))
                else { return nil }
                self = .file(handle: h, id: id)
            } else {
                return nil
            }
        }
    }

    /// Split "handle:id" on the FIRST colon: the handle is URL-safe and never
    /// contains a colon (guest three-word or an /@username), while a server id
    /// may, so everything after the first colon is the id, preserved verbatim.
    private static func split(_ rest: Substring) -> (String, String)? {
        guard let colon = rest.firstIndex(of: ":") else { return nil }
        let handle = String(rest[..<colon])
        let id = String(rest[rest.index(after: colon)...])
        guard !handle.isEmpty, !id.isEmpty else { return nil }
        return (handle, id)
    }

    /// True for containers the enumerator can list children of.
    public var isContainer: Bool {
        switch self {
        case .rootContainer, .workingSet, .trashContainer, .workspace, .folder:
            return true
        case .file:
            return false
        }
    }

    /// The workspace handle this identifier belongs to, or nil for the reserved
    /// global containers. The extension uses it to select the workspace token.
    public var workspaceHandle: String? {
        switch self {
        case .workspace(let h), .folder(let h, _), .file(let h, _): return h
        case .rootContainer, .workingSet, .trashContainer: return nil
        }
    }
}
