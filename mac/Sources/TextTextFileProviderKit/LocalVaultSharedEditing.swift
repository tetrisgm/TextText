import Foundation
import ZIPFoundation
import TextTextWorkspaceCore

public struct LocalVaultSharedCheckpoint: Codable, Sendable {
    public var itemId: String
    public var path: String
    public var projectedHash: String
    public var acknowledgedRevision: String
    public var epoch: Int
    public var seq: Int
    public var journalGeneration: UInt64
    public var journal: String
    public var pending: Bool
    public var retiredReason: String?
}
public struct LocalVaultSharedSession: Sendable {
    public let sessionToken: String
    public let acknowledgedRevision: String
    public let document: LocalVaultDocumentStore.Document
    public let checkpoint: LocalVaultSharedCheckpoint?
}
public struct LocalVaultSharedMaterialization: Sendable {
    public let document: LocalVaultDocumentStore.Document
    public let checkpoint: LocalVaultSharedCheckpoint
}

enum LocalVaultSharedFailure: Error, LocalizedError {
    case invalid, staleSession, generation, protected, interrupted
    var errorDescription: String? {
        switch self {
        case .invalid: return "Invalid shared editing checkpoint. Your retained journal has not been removed."
        case .staleSession: return "This shared editing session is no longer active. Reopen the document."
        case .generation: return "A newer shared editing checkpoint is already saved."
        case .protected: return "This document has protected shared edits."
        case .interrupted: return "Shared editing materialization was interrupted."
        }
    }
}

/// Used exclusively by the workspace's LocalVaultSync actor. No independent file writer or worker.
struct LocalVaultSharedEditingStore: Sendable {
    let root: URL
    private struct Intent: Codable {
        var beforeHash: String
        var checkpoint: LocalVaultSharedCheckpoint
        var markdown: String
        var documentJSON: String
    }
    private func itemDirectory(_ itemId: String, create: Bool = false) throws -> URL {
        guard itemId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) == itemId.startIndex..<itemId.endIndex else { throw LocalVaultSharedFailure.invalid }
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        var directory = canonical
        for component in [".texttext", "shared-editing", itemId] {
            directory.appendPathComponent(component, isDirectory: true)
            guard directory.resolvingSymlinksInPath().path == directory.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
            if create {
                var isDirectory: ObjCBool = false
                if FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory) {
                    guard isDirectory.boolValue else { throw LocalVaultSharedFailure.invalid }
                } else { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false) }
            }
        }
        return directory
    }
    private func read(_ url: URL, limit: Int) throws -> Data? {
        guard url.resolvingSymlinksInPath().path == url.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard attributes.isRegularFile == true, (attributes.fileSize ?? 0) <= limit else { throw LocalVaultSharedFailure.invalid }
        let data = try Data(contentsOf: url)
        guard data.count <= limit else { throw LocalVaultSharedFailure.invalid }
        return data
    }
    private func write(_ data: Data, to url: URL) throws {
        guard url.resolvingSymlinksInPath().path == url.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        try data.write(to: url, options: .atomic)
        let handle = try FileHandle(forWritingTo: url)
        try handle.synchronize(); try handle.close()
    }
    private func validHash(_ value: String) -> Bool { value.count == 64 && value.allSatisfy({ $0.isHexDigit }) }
    private func validate(_ checkpoint: LocalVaultSharedCheckpoint) throws {
        _ = try LocalVaultDocumentStore(root: root).url(for: checkpoint.path)
        guard validHash(checkpoint.projectedHash), validHash(checkpoint.acknowledgedRevision),
              checkpoint.epoch >= 1, checkpoint.epoch <= 9_007_199_254_740_991,
              checkpoint.seq >= 0, checkpoint.seq <= 9_007_199_254_740_991,
              checkpoint.journalGeneration > 0, checkpoint.journalGeneration <= 9_007_199_254_740_991,
              checkpoint.journal.utf8.count <= 4 * 1024 * 1024,
              (checkpoint.retiredReason?.utf8.count ?? 0) <= 2000,
              let journal = try JSONSerialization.jsonObject(with: Data(checkpoint.journal.utf8)) as? [String: Any],
              journal["version"] as? Int == 1, journal["epoch"] as? Int == checkpoint.epoch,
              journal["seq"] as? Int == checkpoint.seq, journal["journalGeneration"] as? UInt64 == checkpoint.journalGeneration, journal["revision"] as? String == checkpoint.acknowledgedRevision,
              journal["relativePath"] as? String == checkpoint.path,
              let update = journal["update"] as? String, !update.isEmpty, Data(base64Encoded: update) != nil,
              let pending = journal["pending"] as? [String], pending.count <= 1024,
              pending.allSatisfy({ $0.utf8.count <= 512 * 1024 && Data(base64Encoded: $0) != nil }) else { throw LocalVaultSharedFailure.invalid }
        let hasBatch = journal["batch"] != nil && !(journal["batch"] is NSNull)
        guard checkpoint.pending || (pending.isEmpty && !hasBatch && journal["unqueuedDirty"] as? Bool != true) else { throw LocalVaultSharedFailure.invalid }
    }
    private func contentMatches(_ document: LocalVaultDocumentStore.Document, intent: Intent) -> Bool {
        guard document.contents.markdown == intent.markdown,
              let raw = document.contents.documentJSON,
              let actual = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? NSDictionary,
              let expected = try? JSONSerialization.jsonObject(with: Data(intent.documentJSON.utf8)) as? NSDictionary else { return false }
        return actual == expected
    }
    /// Digest unchanged archive entries, so a same-text external asset/metadata edit is never adopted as our write.
    private func preservedEntries(_ bytes: Data) throws -> [String: String] {
        let archive = try Archive(data: bytes, accessMode: .read)
        let canonical: String
        if archive["text.md"] != nil { canonical = "" }
        else {
            let candidates = archive.filter { entry in
                let components = entry.path.split(separator: "/")
                return components.count == 2 && components.last == "text.md" && archive[String(entry.path.dropLast("text.md".count)) + "document.json"] != nil
            }
            guard candidates.count == 1 else { throw LocalVaultSharedFailure.invalid }
            canonical = String(candidates[0].path.dropLast("text.md".count))
        }
        var result: [String: String] = [:], total: UInt64 = 0, count = 0
        for entry in archive {
            count += 1; total += entry.uncompressedSize
            guard count <= 10000, total <= 64 * 1024 * 1024 else { throw LocalVaultSharedFailure.invalid }
            if [canonical + "text.md", canonical + "document.json"].contains(entry.path) { continue }
            guard result[entry.path] == nil else { throw LocalVaultSharedFailure.invalid }
            var data = Data(); _ = try archive.extract(entry) { data.append($0) }
            result[entry.path] = TextTextStableDigest.sha256Hex(data)
        }
        return result
    }
    func pendingIntentBeforeHash(itemId: String) throws -> String? {
        let directory = try itemDirectory(itemId)
        guard let data = try read(directory.appendingPathComponent("intent.json"), limit: 9 * 1024 * 1024) else { return nil }
        let intent = try JSONDecoder().decode(Intent.self, from: data)
        guard intent.checkpoint.itemId == itemId, validHash(intent.beforeHash) else { throw LocalVaultSharedFailure.invalid }
        return intent.beforeHash
    }
    func checkpoint(itemId: String) throws -> LocalVaultSharedCheckpoint? {
        let directory = try itemDirectory(itemId)
        if let data = try read(directory.appendingPathComponent("intent.json"), limit: 9 * 1024 * 1024) {
            let intent = try JSONDecoder().decode(Intent.self, from: data)
            guard intent.checkpoint.itemId == itemId else { throw LocalVaultSharedFailure.invalid }
            return try finish(intent, directory: directory).checkpoint
        }
        guard let data = try read(directory.appendingPathComponent("checkpoint.json"), limit: 5 * 1024 * 1024) else { return nil }
        let value = try JSONDecoder().decode(LocalVaultSharedCheckpoint.self, from: data)
        guard value.itemId == itemId else { throw LocalVaultSharedFailure.invalid }
        try validate(value)
        return value
    }
    private func finish(_ intent: Intent, directory: URL, interruptAfterWrite: Bool = false) throws -> LocalVaultSharedMaterialization {
        try validate(intent.checkpoint)
        let store = LocalVaultDocumentStore(root: root)
        guard let original = try read(directory.appendingPathComponent("before.textpack"), limit: 64 * 1024 * 1024),
              TextTextStableDigest.sha256Hex(original) == intent.beforeHash else { throw LocalVaultSharedFailure.invalid }
        let current = try? store.read(path: intent.checkpoint.path)
        var checkpoint = intent.checkpoint
        let document: LocalVaultDocumentStore.Document
        if let current, current.hash == intent.beforeHash {
            document = try store.write(path: current.path, expectedHash: current.hash, markdown: intent.markdown,
                documentJSON: intent.documentJSON, templateJSON: current.contents.templateJSON,
                templateAuthoringSourceJSON: current.contents.templateAuthoringSourceJSON)
            if interruptAfterWrite { throw LocalVaultSharedFailure.interrupted }
        } else if let current, contentMatches(current, intent: intent),
                  let bytes = try read(store.url(for: current.path), limit: 64 * 1024 * 1024),
                  try preservedEntries(bytes) == preservedEntries(original) {
            document = current
        } else {
            checkpoint.retiredReason = "The file changed outside shared editing. Its saved shared journal is available for recovery."
            try write(JSONEncoder().encode(checkpoint), to: directory.appendingPathComponent("checkpoint.json"))
            try FileManager.default.removeItem(at: directory.appendingPathComponent("intent.json"))
            throw LocalVaultSyncFailure.changed
        }
        guard MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == checkpoint.itemId else { throw LocalVaultSharedFailure.invalid }
        checkpoint.projectedHash = document.hash
        let bytes = try Data(contentsOf: store.url(for: document.path))
        guard TextTextStableDigest.sha256Hex(bytes) == document.hash else { throw LocalVaultSyncFailure.changed }
        try write(bytes, to: directory.appendingPathComponent("projection.textpack"))
        try write(JSONEncoder().encode(checkpoint), to: directory.appendingPathComponent("checkpoint.json"))
        try FileManager.default.removeItem(at: directory.appendingPathComponent("intent.json"))
        return LocalVaultSharedMaterialization(document: document, checkpoint: checkpoint)
    }
    func materialize(checkpoint: LocalVaultSharedCheckpoint, expectedHash: String, markdown: String, documentJSON: String,
                     interruptAfterIntent: Bool = false, interruptAfterWrite: Bool = false) throws -> LocalVaultSharedMaterialization {
        try validate(checkpoint)
        guard markdown.utf8.count <= 2 * 1024 * 1024, documentJSON.utf8.count <= 2 * 1024 * 1024,
              MarkdownIdentityCodec.extract(from: markdown)?.itemId == checkpoint.itemId,
              let snapshot = try JSONSerialization.jsonObject(with: Data(documentJSON.utf8)) as? [String: Any],
              snapshot["schemaVersion"] as? Int == 1, snapshot["content"] is [String: Any] else { throw LocalVaultSharedFailure.invalid }
        let directory = try itemDirectory(checkpoint.itemId, create: true)
        let prior = try self.checkpoint(itemId: checkpoint.itemId)
        let store = LocalVaultDocumentStore(root: root), current = try store.read(path: checkpoint.path)
        let intent = Intent(beforeHash: expectedHash, checkpoint: checkpoint, markdown: markdown, documentJSON: documentJSON)
        if let prior {
            guard prior.retiredReason == nil else { throw LocalVaultSharedFailure.staleSession }
            guard checkpoint.journalGeneration >= prior.journalGeneration else { throw LocalVaultSharedFailure.generation }
            if checkpoint.journalGeneration == prior.journalGeneration {
                guard checkpoint.journal == prior.journal, checkpoint.pending == prior.pending,
                      current.hash == prior.projectedHash, contentMatches(current, intent: intent) else { throw LocalVaultSharedFailure.generation }
                return LocalVaultSharedMaterialization(document: current, checkpoint: prior)
            }
            guard !prior.pending || checkpoint.epoch == prior.epoch else { throw LocalVaultSharedFailure.staleSession }
        }
        guard current.hash == expectedHash else { throw LocalVaultSyncFailure.changed }
        let original = try Data(contentsOf: store.url(for: current.path))
        guard TextTextStableDigest.sha256Hex(original) == expectedHash else { throw LocalVaultSyncFailure.changed }
        try write(original, to: directory.appendingPathComponent("before.textpack"))
        try write(JSONEncoder().encode(intent), to: directory.appendingPathComponent("intent.json"))
        if interruptAfterIntent { throw LocalVaultSharedFailure.interrupted }
        return try finish(intent, directory: directory, interruptAfterWrite: interruptAfterWrite)
    }
    func archive(itemId: String) throws {
        let directory = try itemDirectory(itemId)
        guard let data = try read(directory.appendingPathComponent("checkpoint.json"), limit: 5 * 1024 * 1024) else { return }
        let name = "archived-" + UUID().uuidString
        for retained in ["projection", "before"] {
            if let bytes = try read(directory.appendingPathComponent(retained + ".textpack"), limit: 64 * 1024 * 1024) {
                try write(bytes, to: directory.appendingPathComponent(name + "-" + retained + ".textpack"))
            }
        }
        try write(data, to: directory.appendingPathComponent(name + ".json"))
        try FileManager.default.removeItem(at: directory.appendingPathComponent("checkpoint.json"))
    }
    func retire(itemId: String, reason: String) throws -> LocalVaultSharedCheckpoint? {
        guard var checkpoint = try checkpoint(itemId: itemId) else { return nil }
        checkpoint.retiredReason = String(reason.prefix(1000))
        let directory = try itemDirectory(itemId)
        try write(JSONEncoder().encode(checkpoint), to: directory.appendingPathComponent("checkpoint.json"))
        return checkpoint
    }
}
