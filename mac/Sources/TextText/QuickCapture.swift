import Foundation
import TextTextFileProviderKit

struct QuickCaptureContent: Equatable {
    let title: String
    let body: String

    static func parse(_ text: String) -> QuickCaptureContent {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let parts = normalized.split(separator: "\n", omittingEmptySubsequences: false)
        let firstLine = parts.first.map(String.init) ?? ""
        let title = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = parts.dropFirst().joined(separator: "\n")
        return QuickCaptureContent(
            title: title.isEmpty ? "Untitled" : title,
            body: body
        )
    }

}

enum QuickCaptureTarget: String, Codable, Equatable {
    case notes
    case bookmarks

    var kind: String {
        switch self {
        case .notes: "note"
        case .bookmarks: "bookmark"
        }
    }
}

struct QuickCaptureRecord: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let body: String
    let createdAt: Date
    let target: QuickCaptureTarget
    let attempts: Int
    let lastError: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, body, createdAt, target, attempts, lastError
    }

    init(
        id: String = UUID().uuidString,
        content: QuickCaptureContent,
        createdAt: Date = Date(),
        target: QuickCaptureTarget = .notes,
        attempts: Int = 0,
        lastError: String? = nil
    ) {
        self.id = id
        title = content.title
        body = content.body
        self.createdAt = Date(
            timeIntervalSince1970:
                (createdAt.timeIntervalSince1970 * 1_000).rounded(.down) / 1_000)
        self.target = target
        self.attempts = attempts
        self.lastError = lastError
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        title = try values.decode(String.self, forKey: .title)
        body = try values.decode(String.self, forKey: .body)
        createdAt = try values.decode(Date.self, forKey: .createdAt)
        target = try values.decodeIfPresent(QuickCaptureTarget.self, forKey: .target) ?? .notes
        attempts = try values.decodeIfPresent(Int.self, forKey: .attempts) ?? 0
        lastError = try values.decodeIfPresent(String.self, forKey: .lastError)
    }

    func retrying(after message: String) -> QuickCaptureRecord {
        QuickCaptureRecord(
            id: id,
            content: QuickCaptureContent(title: title, body: body),
            createdAt: createdAt,
            target: target,
            attempts: attempts + 1,
            lastError: message
        )
    }

    var idempotencyKey: String { "quick-capture:\(id)" }

    var markdown: String {
        let encodedTitle =
            (try? JSONEncoder().encode(title))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "\"Untitled\""
        return """
        ---
        title: \(encodedTitle)
        kind: \(target.kind)
        status: draft
        ---

        \(body)
        """
    }
}

enum QuickCaptureOutboxError: LocalizedError {
    case couldNotCreateDirectory(String)
    case couldNotPersist(String)

    var errorDescription: String? {
        switch self {
        case .couldNotCreateDirectory(let message):
            return "Could not create the capture outbox: \(message)"
        case .couldNotPersist(let message):
            return "Could not save the capture: \(message)"
        }
    }
}

/// Durable, app-owned storage for quick captures. Records are written before
/// any network work begins and retain their stable idempotency key until the
/// server confirms creation. This directory is deliberately separate from the
/// File Provider mount and the share extension's group container.
final class QuickCaptureOutbox {
    private let fileManager: FileManager
    private let queue = DispatchQueue(label: "app.texttext.quick-capture-outbox")
    let pendingDirectory: URL
    let rejectedDirectory: URL

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }()

    init(baseDirectory: URL, fileManager: FileManager = .default) throws {
        self.fileManager = fileManager
        let root = baseDirectory.appendingPathComponent(
            "quick-capture-outbox", isDirectory: true)
        pendingDirectory = root.appendingPathComponent("pending", isDirectory: true)
        rejectedDirectory = root.appendingPathComponent("rejected", isDirectory: true)
        do {
            try Self.createPrivateDirectory(root, fileManager: fileManager)
            try Self.createPrivateDirectory(pendingDirectory, fileManager: fileManager)
            try Self.createPrivateDirectory(rejectedDirectory, fileManager: fileManager)
        } catch {
            throw QuickCaptureOutboxError.couldNotCreateDirectory(
                error.localizedDescription)
        }
    }

    @discardableResult
    func enqueue(
        _ content: QuickCaptureContent,
        id: String = UUID().uuidString,
        createdAt: Date = Date(),
        target: QuickCaptureTarget = .notes
    ) throws -> QuickCaptureRecord {
        let record = QuickCaptureRecord(
            id: id, content: content, createdAt: createdAt, target: target)
        try queue.sync {
            let destination = pendingURL(for: record)
            do {
                let data = try encoder.encode(record)
                try data.write(to: destination, options: .atomic)
                try? fileManager.setAttributes(
                    [.posixPermissions: 0o600], ofItemAtPath: destination.path)
            } catch {
                throw QuickCaptureOutboxError.couldNotPersist(
                    error.localizedDescription)
            }
        }
        return record
    }

    func recordRetry(_ record: QuickCaptureRecord, message: String) throws -> QuickCaptureRecord {
        try queue.sync {
            let updated = record.retrying(after: message)
            let destination = pendingURL(for: updated)
            let data = try encoder.encode(updated)
            try data.write(to: destination, options: .atomic)
            try? fileManager.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: destination.path)
            return updated
        }
    }

    func pendingRecords() -> [QuickCaptureRecord] {
        queue.sync {
            let urls = jsonFiles(in: pendingDirectory)
            var records: [QuickCaptureRecord] = []
            for url in urls {
                do {
                    let data = try Data(contentsOf: url)
                    records.append(try decoder.decode(QuickCaptureRecord.self, from: data))
                } catch {
                    moveUnreadableRecordToRejected(url)
                }
            }
            return records.sorted {
                if $0.createdAt == $1.createdAt { return $0.id < $1.id }
                return $0.createdAt < $1.createdAt
            }
        }
    }

    func remove(_ record: QuickCaptureRecord) throws {
        try queue.sync {
            let url = pendingURL(for: record)
            guard fileManager.fileExists(atPath: url.path) else { return }
            try fileManager.removeItem(at: url)
        }
    }

    func reject(_ record: QuickCaptureRecord) throws {
        try queue.sync {
            let source = pendingURL(for: record)
            guard fileManager.fileExists(atPath: source.path) else { return }
            let destination = rejectedDirectory.appendingPathComponent(
                "\(safeFilename(record.id)).json")
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: source)
            } else {
                try fileManager.moveItem(at: source, to: destination)
            }
        }
    }

    func rejectedRecordCount() -> Int {
        queue.sync { jsonFiles(in: rejectedDirectory).count }
    }

    private func pendingURL(for record: QuickCaptureRecord) -> URL {
        pendingDirectory.appendingPathComponent("\(safeFilename(record.id)).json")
    }

    private func safeFilename(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "_" }
        let cleaned = String(scalars)
        return cleaned.isEmpty ? UUID().uuidString : cleaned
    }

    private func jsonFiles(in directory: URL) -> [URL] {
        (try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ))?.filter { $0.pathExtension == "json" } ?? []
    }

    private func moveUnreadableRecordToRejected(_ source: URL) {
        var destination = rejectedDirectory.appendingPathComponent(
            "unreadable-\(source.lastPathComponent)")
        if fileManager.fileExists(atPath: destination.path) {
            destination = rejectedDirectory.appendingPathComponent(
                "unreadable-\(UUID().uuidString).json")
        }
        try? fileManager.moveItem(at: source, to: destination)
    }

    private static func createPrivateDirectory(
        _ url: URL, fileManager: FileManager
    ) throws {
        try fileManager.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes(
            [.posixPermissions: 0o700], ofItemAtPath: url.path)
    }
}

enum QuickCaptureFilingResult {
    case saved(ManifestItem)
    case retry(String)
    case rejected(String)
}

struct QuickCaptureFiler {
    func file(
        _ record: QuickCaptureRecord,
        workspace: Workspace,
        client: any SyncClient
    ) -> QuickCaptureFilingResult {
        guard let targetFolder = workspace.folders.first(where: { $0.mode == record.target.rawValue }) else {
            return .retry("This workspace has no \(record.target.rawValue.capitalized) folder")
        }
        switch client.postFile(
            body: record.markdown,
            folderId: targetFolder.id,
            representation: .textpack,
            idempotencyKey: record.idempotencyKey
        ) {
        case .failure(let error):
            return .retry(error.description)
        case .success(.conflict):
            return .retry("The capture conflicted on the server")
        case .success(.rejected(let message)):
            return .rejected(message)
        case .success(.saved(let item)):
            guard item.id != nil else {
                return .retry("The server returned no item id")
            }
            return .saved(item)
        }
    }
}

struct QuickCaptureDrainSummary {
    var savedItems: [ManifestItem] = []
    var retryMessages: [String] = []
    var rejectedMessages: [String] = []

    var shouldRetry: Bool { !retryMessages.isEmpty }
}

struct QuickCaptureOutboxDrainer {
    let outbox: QuickCaptureOutbox
    var filer = QuickCaptureFiler()
    var maxAttempts = 5

    func drain(
        workspace: Workspace,
        client: any SyncClient,
        deferRejections: Bool = false
    ) -> QuickCaptureDrainSummary {
        var summary = QuickCaptureDrainSummary()
        for record in outbox.pendingRecords() {
            switch filer.file(record, workspace: workspace, client: client) {
            case .saved(let item):
                do {
                    try outbox.remove(record)
                    summary.savedItems.append(item)
                } catch {
                    summary.retryMessages.append(error.localizedDescription)
                }
            case .retry(let message):
                do {
                    let updated = try outbox.recordRetry(record, message: message)
                    if updated.attempts >= maxAttempts {
                        try outbox.reject(updated)
                        summary.rejectedMessages.append(
                            "\(message) after \(updated.attempts) attempts")
                    } else {
                        summary.retryMessages.append(message)
                    }
                } catch {
                    summary.retryMessages.append(error.localizedDescription)
                }
            case .rejected(let message):
                if deferRejections {
                    do {
                        let updated = try outbox.recordRetry(record, message: message)
                        if updated.attempts >= maxAttempts {
                            try outbox.reject(updated)
                            summary.rejectedMessages.append(
                                "\(message) after \(updated.attempts) attempts")
                        } else {
                            summary.retryMessages.append(message)
                        }
                    } catch {
                        summary.retryMessages.append(error.localizedDescription)
                    }
                    continue
                }
                do {
                    try outbox.reject(record)
                    summary.rejectedMessages.append(message)
                } catch {
                    summary.retryMessages.append(error.localizedDescription)
                }
            }
        }
        return summary
    }
}
