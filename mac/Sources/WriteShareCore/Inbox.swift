import Foundation

public enum InboxItemKind: String, Codable, Equatable, CaseIterable, Sendable {
    case note
    case bookmark
    case draft
    case append
    case file
}

public struct InboxItem: Codable, Equatable, Sendable {
    public var kind: InboxItemKind
    public var title: String?
    public var text: String?
    public var urlString: String?
    public var targetWriteId: String?
    public var payloadFilename: String?

    public init(
        kind: InboxItemKind,
        title: String? = nil,
        text: String? = nil,
        urlString: String? = nil,
        targetWriteId: String? = nil,
        payloadFilename: String? = nil
    ) {
        self.kind = kind
        self.title = title
        self.text = text
        self.urlString = urlString
        self.targetWriteId = targetWriteId
        self.payloadFilename = payloadFilename
    }
}

public struct InboxPayload: Equatable, Sendable {
    public var filename: String
    public var data: Data

    public init(filename: String, data: Data) {
        self.filename = filename
        self.data = data
    }
}

public struct InboxRecord: Equatable {
    public var id: String
    public var item: InboxItem
    public var directoryURL: URL
    public var payloadURL: URL?

    public init(id: String, item: InboxItem, directoryURL: URL, payloadURL: URL?) {
        self.id = id
        self.item = item
        self.directoryURL = directoryURL
        self.payloadURL = payloadURL
    }
}

public enum InboxError: LocalizedError, Equatable {
    case invalidPayloadFilename(String)

    public var errorDescription: String? {
        switch self {
        case .invalidPayloadFilename(let filename):
            return "Invalid inbox payload filename: \(filename)"
        }
    }
}

public final class InboxWriter {
    public static let inboxDirectoryName = "Inbox"
    public static let itemSidecarName = "item.json"

    public let containerURL: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder

    public init(containerURL: URL, fileManager: FileManager = .default) {
        self.containerURL = containerURL
        self.fileManager = fileManager
        self.encoder = JSONEncoder()
        self.encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    @discardableResult
    public func write(_ item: InboxItem, payload: InboxPayload? = nil) throws -> InboxRecord {
        let id = UUID().uuidString
        let directory = Self.inboxURL(containerURL: containerURL)
            .appendingPathComponent(id, isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)

        var item = item
        var payloadURL: URL?
        if let payload {
            let filename = try Self.sanitizedPayloadFilename(payload.filename)
            item.payloadFilename = filename
            payloadURL = directory.appendingPathComponent(filename, isDirectory: false)
            try payload.data.write(to: payloadURL!, options: .atomic)
        } else if let filename = item.payloadFilename {
            item.payloadFilename = try Self.sanitizedPayloadFilename(filename)
            payloadURL = directory.appendingPathComponent(item.payloadFilename!, isDirectory: false)
        }

        let data = try encoder.encode(item)
        try data.write(to: directory.appendingPathComponent(Self.itemSidecarName), options: .atomic)
        return InboxRecord(id: id, item: item, directoryURL: directory, payloadURL: payloadURL)
    }

    public static func inboxURL(containerURL: URL) -> URL {
        containerURL.appendingPathComponent(inboxDirectoryName, isDirectory: true)
    }

    public static func sanitizedPayloadFilename(_ filename: String) throws -> String {
        let lastComponent = URL(fileURLWithPath: filename).lastPathComponent
        let trimmed = lastComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != ".", trimmed != ".." else {
            throw InboxError.invalidPayloadFilename(filename)
        }
        let cleanedScalars = trimmed.unicodeScalars.map { scalar -> Character in
            if CharacterSet.controlCharacters.contains(scalar) {
                return "-"
            }
            if scalar == "/" || scalar == ":" {
                return "-"
            }
            return Character(scalar)
        }
        let cleaned = String(cleanedScalars).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, cleaned != ".", cleaned != ".." else {
            throw InboxError.invalidPayloadFilename(filename)
        }
        return String(cleaned.prefix(180))
    }
}

public final class InboxReader {
    public let containerURL: URL
    private let fileManager: FileManager
    private let decoder = JSONDecoder()

    public init(containerURL: URL, fileManager: FileManager = .default) {
        self.containerURL = containerURL
        self.fileManager = fileManager
    }

    public func completeItems() throws -> [InboxRecord] {
        let inbox = Self.inboxURL(containerURL: containerURL)
        guard fileManager.fileExists(atPath: inbox.path) else { return [] }
        let directories = try fileManager.contentsOfDirectory(
            at: inbox,
            includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )

        var records: [InboxRecord] = []
        for directory in directories {
            let values = try? directory.resourceValues(forKeys: [.isDirectoryKey])
            guard values?.isDirectory == true else { continue }
            let sidecar = directory.appendingPathComponent(InboxWriter.itemSidecarName)
            guard fileManager.fileExists(atPath: sidecar.path) else { continue }
            // One unreadable or corrupt sidecar must never wedge the whole
            // inbox: skip it and keep draining every other shared item.
            guard let data = try? Data(contentsOf: sidecar),
                  let item = try? decoder.decode(InboxItem.self, from: data) else {
                continue
            }
            let payloadURL = item.payloadFilename.map { directory.appendingPathComponent($0, isDirectory: false) }
            if let payloadURL, !fileManager.fileExists(atPath: payloadURL.path) {
                continue
            }
            records.append(InboxRecord(
                id: directory.lastPathComponent,
                item: item,
                directoryURL: directory,
                payloadURL: payloadURL
            ))
        }
        return records.sorted { lhs, rhs in
            modificationDate(lhs.directoryURL) < modificationDate(rhs.directoryURL)
        }
    }

    public func deleteConsumed(_ record: InboxRecord) throws {
        guard fileManager.fileExists(atPath: record.directoryURL.path) else { return }
        try fileManager.removeItem(at: record.directoryURL)
    }

    /// Park a record the server REJECTED (HTTP 400) where a retry of identical
    /// bytes is futile but the user's shared text may be their only copy.
    /// Moving it out of the inbox stops the retry loop without destroying it;
    /// the dead-letter folder sits next to the inbox in the app-group container.
    public func moveToDeadLetter(_ record: InboxRecord) throws {
        guard fileManager.fileExists(atPath: record.directoryURL.path) else { return }
        let deadLetter = Self.deadLetterURL(containerURL: containerURL)
        try fileManager.createDirectory(at: deadLetter, withIntermediateDirectories: true)
        let destination = deadLetter.appendingPathComponent(
            record.directoryURL.lastPathComponent, isDirectory: true)
        if fileManager.fileExists(atPath: destination.path) {
            // Same record parked twice (crash between move and the caller's
            // bookkeeping): the copies are identical, keep the existing one.
            try fileManager.removeItem(at: record.directoryURL)
            return
        }
        try fileManager.moveItem(at: record.directoryURL, to: destination)
    }

    public static func inboxURL(containerURL: URL) -> URL {
        InboxWriter.inboxURL(containerURL: containerURL)
    }

    public static func deadLetterURL(containerURL: URL) -> URL {
        containerURL.appendingPathComponent("Inbox Rejected", isDirectory: true)
    }

    private func modificationDate(_ url: URL) -> Date {
        ((try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate)
            ?? Date.distantPast
    }
}
