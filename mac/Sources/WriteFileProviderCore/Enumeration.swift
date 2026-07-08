import Foundation

public struct WriteFileProviderPageToken: Codable, Equatable {
    public var offset: Int

    public init(offset: Int = 0) {
        self.offset = max(0, offset)
    }

    public init?(data: Data) {
        guard let decoded = try? JSONDecoder().decode(WriteFileProviderPageToken.self, from: data) else {
            return nil
        }
        self = decoded
    }

    public var data: Data {
        (try? JSONEncoder().encode(self)) ?? Data()
    }
}

public struct WriteFileProviderChangeAnchor: Codable, Equatable {
    public var cursor: String?

    public init(cursor: String? = nil) {
        self.cursor = cursor
    }

    public init?(data: Data) {
        guard let decoded = try? JSONDecoder().decode(WriteFileProviderChangeAnchor.self, from: data) else {
            return nil
        }
        self = decoded
    }

    public var data: Data {
        (try? JSONEncoder().encode(self)) ?? Data()
    }
}

public struct WriteFileProviderEnumerationPage: Equatable {
    public var items: [WriteFileProviderItemMetadata]
    public var nextPageToken: WriteFileProviderPageToken?

    public init(items: [WriteFileProviderItemMetadata], nextPageToken: WriteFileProviderPageToken? = nil) {
        self.items = items
        self.nextPageToken = nextPageToken
    }
}

public enum WriteFileProviderChange: Codable, Equatable {
    case updated(WriteFileProviderItemMetadata)
    case deleted(WriteFileProviderItemIdentifier)
}

public struct WriteFileProviderChangeSet: Codable, Equatable {
    public var changes: [WriteFileProviderChange]
    public var anchor: WriteFileProviderChangeAnchor
    public var requiresFullEnumeration: Bool

    public init(
        changes: [WriteFileProviderChange],
        anchor: WriteFileProviderChangeAnchor,
        requiresFullEnumeration: Bool = false
    ) {
        self.changes = changes
        self.anchor = anchor
        self.requiresFullEnumeration = requiresFullEnumeration
    }
}

public struct WriteRemoteChangePoll: Codable, Equatable {
    public var cursor: String
    public var changed: Bool

    public init(cursor: String, changed: Bool) {
        self.cursor = cursor
        self.changed = changed
    }
}
