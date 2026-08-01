import Foundation

public struct IndexEntry: Codable, Equatable {
    public var hash: String
    public var relativePath: String
    public var fileMtime: Double?
    public var folderId: String?
    public var kind: String?

    public init(
        hash: String,
        relativePath: String,
        fileMtime: Double? = nil,
        folderId: String? = nil,
        kind: String? = nil
    ) {
        self.hash = hash
        self.relativePath = relativePath
        self.fileMtime = fileMtime
        self.folderId = folderId
        self.kind = kind
    }
}

public struct SyncIndex: Codable, Equatable {
    public var entries: [String: IndexEntry]
    public var folderETags: [String: String]
    /// Identity of the mirror this index describes: matches the id inside
    /// the marker file at the sync root. When the app is pointed at a root
    /// whose marker carries a different id (a different mirror era, for
    /// example after an iCloud sign-out re-mirrored into the local fallback),
    /// the index is dropped instead of driving server deletes.
    public var mirrorId: String?
    /// Post ids that were confirmed locally missing in the PREVIOUS completed
    /// healthy scan. A local deletion only propagates to the server on the
    /// second consecutive scan that finds it gone (a two-strike guard), so a
    /// transient disappearance (eviction, a half-materialized mirror, a slow
    /// coordinator read) never erases the server on the first sight of absence.
    /// Optional so an index written before this field decodes cleanly.
    public var previouslyMissing: Set<String>?

    public init(
        entries: [String: IndexEntry] = [:],
        folderETags: [String: String] = [:],
        mirrorId: String? = nil,
        previouslyMissing: Set<String>? = nil
    ) {
        self.entries = entries
        self.folderETags = folderETags
        self.mirrorId = mirrorId
        self.previouslyMissing = previouslyMissing
    }
}
