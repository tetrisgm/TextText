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

    public init(entries: [String: IndexEntry] = [:]) {
        self.entries = entries
    }
}
