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

struct QuickCaptureIntent: Equatable {
    let content: QuickCaptureContent
    let target: QuickCaptureTarget
    let rawValue: String

    init?(_ text: String) {
        let rawValue = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let captured = TextTextCaptureIntent(value: rawValue),
            let target = QuickCaptureTarget(rawValue: captured.folder)
        else { return nil }
        content = QuickCaptureContent(title: captured.title, body: captured.body)
        self.target = target
        self.rawValue = rawValue
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
    let raw: String
    let createdAt: Date
    let target: QuickCaptureTarget
    let workspaceHandle: String?
    let attempts: Int
    let lastError: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, body, raw, createdAt, target, workspaceHandle, attempts, lastError
    }

    init(
        id: String = UUID().uuidString,
        content: QuickCaptureContent,
        raw: String? = nil,
        createdAt: Date = Date(),
        target: QuickCaptureTarget = .notes,
        workspaceHandle: String? = nil,
        attempts: Int = 0,
        lastError: String? = nil
    ) {
        self.id = id
        title = content.title
        body = content.body
        self.raw = raw ?? Self.reconstructedRaw(
            title: content.title, body: content.body, target: target)
        self.createdAt = Date(
            timeIntervalSince1970:
                (createdAt.timeIntervalSince1970 * 1_000).rounded(.down) / 1_000)
        self.target = target
        self.workspaceHandle = workspaceHandle
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
        workspaceHandle = try values.decodeIfPresent(
            String.self, forKey: .workspaceHandle)
        raw = try values.decodeIfPresent(String.self, forKey: .raw)
            ?? Self.reconstructedRaw(title: title, body: body, target: target)
        attempts = try values.decodeIfPresent(Int.self, forKey: .attempts) ?? 0
        lastError = try values.decodeIfPresent(String.self, forKey: .lastError)
    }

    func retrying(after message: String) -> QuickCaptureRecord {
        QuickCaptureRecord(
            id: id,
            content: QuickCaptureContent(title: title, body: body),
            raw: raw,
            createdAt: createdAt,
            target: target,
            workspaceHandle: workspaceHandle,
            attempts: attempts + 1,
            lastError: message
        )
    }

    func restoredForRetry() -> QuickCaptureRecord {
        QuickCaptureRecord(
            id: id,
            content: QuickCaptureContent(title: title, body: body),
            raw: raw,
            createdAt: createdAt,
            target: target,
            workspaceHandle: workspaceHandle
        )
    }

    var idempotencyKey: String { "quick-capture:\(id)" }

    private static func reconstructedRaw(
        title: String, body: String, target: QuickCaptureTarget
    ) -> String {
        if target == .bookmarks,
           let open = body.lastIndex(of: "("), body.last == ")"
        {
            return String(body[body.index(after: open)..<body.index(before: body.endIndex)])
        }
        if body.isEmpty { return title }
        if body == title || body.hasPrefix("\(title)\n") { return body }
        return "\(title)\n\n\(body)"
    }

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
    private let receiptsURL: URL
    private static let receiptLimit = 6

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
        receiptsURL = root.appendingPathComponent("recent-receipts.json")
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
        try persistPending(record)
        return record
    }

    @discardableResult
    func enqueue(
        _ capture: QuickCaptureIntent,
        id: String = UUID().uuidString,
        createdAt: Date = Date(),
        workspaceHandle: String? = nil
    ) throws -> QuickCaptureRecord {
        let record = QuickCaptureRecord(
            id: id,
            content: capture.content,
            raw: capture.rawValue,
            createdAt: createdAt,
            target: capture.target,
            workspaceHandle: workspaceHandle)
        try persistPending(record)
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

    func rejectedRecords() -> [QuickCaptureRecord] {
        queue.sync {
            jsonFiles(in: rejectedDirectory).compactMap { url in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? decoder.decode(QuickCaptureRecord.self, from: data)
            }.sorted {
                if $0.createdAt == $1.createdAt { return $0.id < $1.id }
                return $0.createdAt < $1.createdAt
            }
        }
    }

    func recentSavedReceipts(
        workspaceHandle: String? = nil
    ) -> [QuickCaptureSavedReceipt] {
        queue.sync {
            let receipts = loadSavedReceipts()
            let selected = workspaceHandle.map { handle in
                receipts.filter { $0.workspaceHandle == handle }
            } ?? receipts
            return Array(selected.prefix(Self.receiptLimit))
        }
    }

    func recordSavedReceipt(_ receipt: QuickCaptureSavedReceipt) throws {
        try queue.sync {
            var receipts = loadSavedReceipts().filter {
                $0.itemId != receipt.itemId
            }
            receipts.append(receipt)
            receipts = Self.boundSavedReceipts(receipts)
            do {
                let data = try encoder.encode(receipts)
                try data.write(to: receiptsURL, options: .atomic)
                try? fileManager.setAttributes(
                    [.posixPermissions: 0o600], ofItemAtPath: receiptsURL.path)
            } catch {
                throw QuickCaptureOutboxError.couldNotPersist(
                    error.localizedDescription)
            }
        }
    }

    func removeSavedReceipt(
        itemId: String, workspaceHandle: String
    ) throws {
        try queue.sync {
            let receipts = loadSavedReceipts().filter {
                !($0.itemId == itemId && $0.workspaceHandle == workspaceHandle)
            }
            do {
                let data = try encoder.encode(receipts)
                try data.write(to: receiptsURL, options: .atomic)
                try? fileManager.setAttributes(
                    [.posixPermissions: 0o600], ofItemAtPath: receiptsURL.path)
            } catch {
                throw QuickCaptureOutboxError.couldNotPersist(
                    error.localizedDescription)
            }
        }
    }

    /// Moves every readable dead-letter record back to the durable pending
    /// queue. The stable id and idempotency key survive, while the bounded
    /// attempt count starts over for this explicit user retry.
    @discardableResult
    func retryRejectedRecords() throws -> Int {
        try queue.sync {
            var restoredCount = 0
            for source in jsonFiles(in: rejectedDirectory) {
                guard let data = try? Data(contentsOf: source),
                      let record = try? decoder.decode(QuickCaptureRecord.self, from: data)
                else { continue }

                try restoreRejected(record, source: source)
                restoredCount += 1
            }
            return restoredCount
        }
    }

    @discardableResult
    func retryRejectedRecord(id: String) throws -> Bool {
        try queue.sync {
            let source = rejectedURL(id: id)
            guard let data = try? Data(contentsOf: source),
                  let record = try? decoder.decode(QuickCaptureRecord.self, from: data)
            else { return false }
            try restoreRejected(record, source: source)
            return true
        }
    }

    @discardableResult
    func discardRejectedRecord(id: String) throws -> Bool {
        try queue.sync {
            let source = rejectedURL(id: id)
            guard fileManager.fileExists(atPath: source.path) else { return false }
            do {
                try fileManager.removeItem(at: source)
                return true
            } catch {
                throw QuickCaptureOutboxError.couldNotPersist(
                    error.localizedDescription)
            }
        }
    }

    private func pendingURL(for record: QuickCaptureRecord) -> URL {
        pendingDirectory.appendingPathComponent("\(safeFilename(record.id)).json")
    }

    private func rejectedURL(id: String) -> URL {
        rejectedDirectory.appendingPathComponent("\(safeFilename(id)).json")
    }

    private func persistPending(_ record: QuickCaptureRecord) throws {
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
    }

    private func restoreRejected(
        _ record: QuickCaptureRecord, source: URL
    ) throws {
        let restored = record.restoredForRetry()
        let destination = pendingURL(for: restored)
        do {
            let restoredData = try encoder.encode(restored)
            try restoredData.write(to: destination, options: .atomic)
            try? fileManager.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: destination.path)
            try fileManager.removeItem(at: source)
        } catch {
            throw QuickCaptureOutboxError.couldNotPersist(
                error.localizedDescription)
        }
    }

    private func loadSavedReceipts() -> [QuickCaptureSavedReceipt] {
        guard let data = try? Data(contentsOf: receiptsURL),
              let receipts = try? decoder.decode(
                [QuickCaptureSavedReceipt].self, from: data)
        else { return [] }
        return receipts.sorted {
            if $0.savedAt == $1.savedAt { return $0.itemId < $1.itemId }
            return $0.savedAt > $1.savedAt
        }
    }

    private static func boundSavedReceipts(
        _ receipts: [QuickCaptureSavedReceipt]
    ) -> [QuickCaptureSavedReceipt] {
        let grouped = Dictionary(grouping: receipts) {
            $0.workspaceHandle ?? ""
        }
        return grouped.values.flatMap { group in
            group.sorted {
                if $0.savedAt == $1.savedAt { return $0.itemId < $1.itemId }
                return $0.savedAt > $1.savedAt
            }.prefix(receiptLimit)
        }.sorted {
            if $0.savedAt == $1.savedAt { return $0.itemId < $1.itemId }
            return $0.savedAt > $1.savedAt
        }
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

enum QuickCaptureFeedback: Equatable {
    case ready
    case saved([QuickCaptureSavedReceipt])
    case undone(String)
    case queued(Int)
    case failed(Int)

    var title: String {
        switch self {
        case .ready: return "Ready to capture"
        case .saved(let receipts):
            guard let latest = receipts.first else { return "Saved to TextText" }
            if receipts.count == 1 {
                return "Saved \(latest.title) to \(latest.folderPath)"
            }
            return "Saved \(receipts.count) captures; latest is \(latest.title) in \(latest.folderPath)"
        case .undone(let title): return "Undid capture \(title)"
        case .queued(let count):
            return count == 1 ? "Queued safely" : "\(count) captures queued safely"
        case .failed(let count):
            if count == 0 { return "Capture failed" }
            if count == 1 { return "Failed capture" }
            return "Failed captures (\(count))"
        }
    }

    var symbolName: String {
        switch self {
        case .ready: "square.and.pencil"
        case .saved: "checkmark.circle"
        case .undone: "arrow.uturn.backward.circle"
        case .queued: "clock.arrow.circlepath"
        case .failed: "exclamationmark.triangle"
        }
    }
}

enum QuickCaptureFilingResult {
    case saved(ManifestItem, folderPath: String)
    case deferred(String)
    case retry(String)
    case rejected(String)
}

struct QuickCaptureFiler {
    func file(
        _ record: QuickCaptureRecord,
        workspace: Workspace,
        client: any SyncClient
    ) -> QuickCaptureFilingResult {
        if let expectedHandle = record.workspaceHandle,
           expectedHandle != workspace.blog.handle
        {
            return .deferred(
                "This capture belongs to \(expectedHandle), not \(workspace.blog.handle)")
        }
        let targetFolder = workspace.folders
            .filter { $0.mode == record.target.rawValue }
            .sorted {
                let leftDepth = $0.path.split(separator: "/").count
                let rightDepth = $1.path.split(separator: "/").count
                if leftDepth != rightDepth { return leftDepth < rightDepth }
                return $0.path.localizedStandardCompare($1.path) == .orderedAscending
            }
            .first
        guard let targetFolder else {
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
            return .saved(item, folderPath: targetFolder.path)
        }
    }
}

struct QuickCaptureSavedReceipt: Codable, Equatable {
    let itemId: String
    let title: String
    let folderPath: String
    let slug: String
    let kind: String
    let savedAt: Date
    let workspaceHandle: String?
    let hash: String?

    init(
        itemId: String,
        title: String,
        folderPath: String,
        slug: String,
        kind: String,
        savedAt: Date = Date(),
        workspaceHandle: String? = nil,
        hash: String? = nil
    ) {
        self.itemId = itemId
        self.title = title
        self.folderPath = folderPath
        self.slug = slug
        self.kind = kind
        self.workspaceHandle = workspaceHandle
        self.hash = hash
        self.savedAt = Date(
            timeIntervalSince1970:
                (savedAt.timeIntervalSince1970 * 1_000).rounded(.down) / 1_000)
    }

    var canUndo: Bool {
        workspaceHandle?.isEmpty == false && hash?.isEmpty == false
    }
}

enum QuickCaptureUndoFailure: Error, Equatable {
    case couldNotPersist(String)
    case server(String)
    case unavailable
    case workspaceMismatch
}

/// Reverses only the exact server revision returned by capture. The receipt
/// stays available if either the guarded DELETE or local receipt update fails,
/// so retrying cannot silently lose the person's recovery path.
struct QuickCaptureUndoer {
    let outbox: QuickCaptureOutbox

    func undo(
        _ receipt: QuickCaptureSavedReceipt,
        workspaceHandle: String,
        client: any SyncClient
    ) -> Result<Void, QuickCaptureUndoFailure> {
        guard receipt.workspaceHandle == workspaceHandle else {
            return .failure(.workspaceMismatch)
        }
        guard let hash = receipt.hash, !hash.isEmpty else {
            return .failure(.unavailable)
        }
        switch client.workspace() {
        case .failure(let error):
            return .failure(.server(error.description))
        case .success(let (authenticatedWorkspace, _)):
            guard authenticatedWorkspace.blog.handle == workspaceHandle else {
                return .failure(.workspaceMismatch)
            }
        }
        switch client.deleteFile(postId: receipt.itemId, ifMatch: hash) {
        case .failure(let error):
            return .failure(.server(error.description))
        case .success:
            do {
                try outbox.removeSavedReceipt(
                    itemId: receipt.itemId,
                    workspaceHandle: workspaceHandle)
                return .success(())
            } catch {
                return .failure(.couldNotPersist(error.localizedDescription))
            }
        }
    }
}

struct QuickCaptureDrainSummary {
    var savedItems: [ManifestItem] = []
    var savedReceipts: [QuickCaptureSavedReceipt] = []
    var retryMessages: [String] = []
    var deferredMessages: [String] = []
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
            case .saved(let item, let folderPath):
                do {
                    guard let itemId = item.id else {
                        summary.retryMessages.append("The server returned no item id")
                        continue
                    }
                    let receipt = QuickCaptureSavedReceipt(
                        itemId: itemId,
                        title: item.title,
                        folderPath: folderPath,
                        slug: item.slug,
                        kind: item.kind,
                        workspaceHandle: workspace.blog.handle,
                        hash: item.hash)
                    try outbox.recordSavedReceipt(receipt)
                    try outbox.remove(record)
                    summary.savedItems.append(item)
                    summary.savedReceipts.append(receipt)
                } catch {
                    summary.retryMessages.append(error.localizedDescription)
                }
            case .deferred(let message):
                summary.deferredMessages.append(message)
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
