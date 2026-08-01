import Foundation

/// The stable identity the File Provider hangs every item off, independent of
/// the FileProvider framework so it stays unit-testable. Each case round-trips
/// through a raw string, and the three reserved cases use Apple's documented
/// constant values so `NSFileProviderItemIdentifier(rawValue:)` in the
/// extension bridges them for free.
///
/// Folder and file identifiers are scoped by the workspace HANDLE they belong
/// to, because a single "TextText" domain now spans every workspace the user has
/// joined: the extension reads the handle straight out of the identifier to pick
/// that workspace's `wsk_` token. The three reserved containers stay global (not
/// handle-scoped) so the framework bridge stays a free round-trip and the root
/// self-parents.
public enum TextTextItemIdentifier: Hashable, Sendable {
    /// The domain root; its children are the workspace containers.
    case rootContainer
    /// The working set (everything the system may want to index/materialize).
    case workingSet
    /// The trash. TextText soft-deletes; this is where evicted items surface.
    case trashContainer
    /// TextText-owned auxiliary data, kept separate from user content folders.
    case dataContainer
    /// Central attachments for imported plain Markdown/text files.
    case attachmentsContainer
    /// One workspace inside Data/Attachments.
    case attachmentWorkspace(String)
    /// One imported plain document's attachment container.
    case attachmentItem(handle: String, id: String)
    /// One immutable attachment referenced by an imported plain document.
    case attachmentFile(handle: String, id: String, filename: String)
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
    static let dataRaw = "texttext-data"
    static let attachmentsRaw = "texttext-attachments"
    static let attachmentWorkspacePrefix = "attachment-workspace:"
    static let attachmentItemPrefix = "attachment-item:"
    static let attachmentFilePrefix = "attachment-file:"

    public var rawValue: String {
        switch self {
        case .rootContainer: return Self.rootRaw
        case .workingSet: return Self.workingSetRaw
        case .trashContainer: return Self.trashRaw
        case .dataContainer: return Self.dataRaw
        case .attachmentsContainer: return Self.attachmentsRaw
        case .attachmentWorkspace(let handle):
            return Self.attachmentWorkspacePrefix + Self.token(handle)
        case .attachmentItem(let handle, let id):
            return Self.attachmentItemPrefix + Self.tokens([handle, id])
        case .attachmentFile(let handle, let id, let filename):
            return Self.attachmentFilePrefix + Self.tokens([handle, id, filename])
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
        case Self.dataRaw: self = .dataContainer
        case Self.attachmentsRaw: self = .attachmentsContainer
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
            } else if rawValue.hasPrefix(Self.attachmentWorkspacePrefix) {
                let raw = String(rawValue.dropFirst(Self.attachmentWorkspacePrefix.count))
                guard let handle = Self.value(from: raw) else { return nil }
                self = .attachmentWorkspace(handle)
            } else if rawValue.hasPrefix(Self.attachmentItemPrefix) {
                let raw = String(rawValue.dropFirst(Self.attachmentItemPrefix.count))
                guard let values = Self.values(from: raw, count: 2) else { return nil }
                self = .attachmentItem(handle: values[0], id: values[1])
            } else if rawValue.hasPrefix(Self.attachmentFilePrefix) {
                let raw = String(rawValue.dropFirst(Self.attachmentFilePrefix.count))
                guard let values = Self.values(from: raw, count: 3) else { return nil }
                self = .attachmentFile(
                    handle: values[0], id: values[1], filename: values[2])
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

    private static func token(_ value: String) -> String {
        Data(value.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func tokens(_ values: [String]) -> String {
        values.map(token).joined(separator: ".")
    }

    private static func value(from token: String) -> String? {
        var base64 = token
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else { return nil }
        return value
    }

    private static func values(from raw: String, count: Int) -> [String]? {
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == count else { return nil }
        let decoded = parts.compactMap { value(from: String($0)) }
        return decoded.count == count ? decoded : nil
    }

    /// True for containers the enumerator can list children of.
    public var isContainer: Bool {
        switch self {
        case .rootContainer, .workingSet, .trashContainer, .dataContainer,
             .attachmentsContainer, .attachmentWorkspace, .attachmentItem,
             .workspace, .folder:
            return true
        case .file, .attachmentFile:
            return false
        }
    }

    /// The workspace handle this identifier belongs to, or nil for the reserved
    /// global containers. The extension uses it to select the workspace token.
    public var workspaceHandle: String? {
        switch self {
        case .workspace(let h), .folder(let h, _), .file(let h, _),
             .attachmentWorkspace(let h), .attachmentItem(let h, _),
             .attachmentFile(let h, _, _): return h
        case .rootContainer, .workingSet, .trashContainer, .dataContainer,
             .attachmentsContainer: return nil
        }
    }
}
