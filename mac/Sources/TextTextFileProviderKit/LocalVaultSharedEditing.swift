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
    private struct MoveIntent: Codable {
        var sourcePath: String
        var checkpoint: LocalVaultSharedCheckpoint
        /// The destination was renamed and edited outside TextText; the retained
        /// projection stays as the reconciliation base at the new path.
        var adoptsExternalChange: Bool?
    }
    private struct Intent: Codable {
        var beforeHash: String
        var checkpoint: LocalVaultSharedCheckpoint
        var markdown: String
        var documentJSON: String
    }
    private func itemDirectory(_ itemId: String, create: Bool = false) throws -> URL {
        guard itemId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) == itemId.startIndex..<itemId.endIndex else { throw LocalVaultSharedFailure.invalid }
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        var directory = LocalVaultDeviceState.directory(root: canonical)
        for component in ["shared-editing", itemId] {
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
        if let raw = journal["recovery"], !(raw is NSNull) {
            guard let intent = Self.recoveryIntent(raw), intent.epoch <= checkpoint.epoch else { throw LocalVaultSharedFailure.invalid }
        }
    }
    /// The client's durable epoch-recovery intent: the exact bytes it sent to the
    /// server for the old epoch, plus whether the replacement epoch is adopted.
    struct RecoveryIntent: Equatable {
        let operationId: String
        let epoch: Int
        let update: String
        let adopted: Bool
    }
    static func recoveryIntent(_ raw: Any) -> RecoveryIntent? {
        guard let fields = raw as? [String: Any],
              Set(fields.keys).isSubset(of: ["operationId", "epoch", "update", "adopted"]),
              let operationId = fields["operationId"] as? String,
              operationId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) == operationId.startIndex..<operationId.endIndex,
              let epochNumber = fields["epoch"] as? NSNumber, CFGetTypeID(epochNumber) != CFBooleanGetTypeID(),
              let epoch = fields["epoch"] as? Int, epoch >= 1, epoch <= 9_007_199_254_740_991,
              let update = fields["update"] as? String, !update.isEmpty, update.utf8.count <= 6 * 1024 * 1024, Data(base64Encoded: update) != nil else { return nil }
        let adopted: Bool
        if let flag = fields["adopted"] {
            guard let number = flag as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
            adopted = number.boolValue
        } else { adopted = false }
        return RecoveryIntent(operationId: operationId, epoch: epoch, update: update, adopted: adopted)
    }
    private func recoveryIntent(of checkpoint: LocalVaultSharedCheckpoint) -> RecoveryIntent? {
        guard let journal = try? JSONSerialization.jsonObject(with: Data(checkpoint.journal.utf8)) as? [String: Any],
              let raw = journal["recovery"], !(raw is NSNull) else { return nil }
        return Self.recoveryIntent(raw)
    }
    /// A pending journal may only move to a newer epoch when the incoming
    /// checkpoint proves the client adopted the epoch produced by the recovery
    /// intent this store already holds. Server acknowledgement alone never
    /// qualifies: the intent must have been checkpointed here before the send.
    private func authorizedAdoption(prior: LocalVaultSharedCheckpoint, incoming: LocalVaultSharedCheckpoint,
                                    current: LocalVaultDocumentStore.Document) -> RecoveryIntent? {
        guard prior.pending, prior.retiredReason == nil, incoming.epoch > prior.epoch,
              incoming.itemId == prior.itemId, incoming.path == prior.path, current.path == prior.path,
              current.hash == prior.projectedHash,
              incoming.journalGeneration > prior.journalGeneration,
              let retained = recoveryIntent(of: prior), !retained.adopted, retained.epoch == prior.epoch,
              let adopted = recoveryIntent(of: incoming), adopted.adopted,
              adopted.operationId == retained.operationId, adopted.epoch == retained.epoch,
              adopted.update == retained.update else { return nil }
        return adopted
    }
    private struct Presentation {
        let templateJSON: String?
        let templateAuthoringSourceJSON: String?
    }
    private func presentation(_ checkpoint: LocalVaultSharedCheckpoint) throws -> Presentation? {
        let journal = try JSONSerialization.jsonObject(with: Data(checkpoint.journal.utf8)) as? [String: Any]
        guard let raw = journal?["presentation"] else { return nil }
        guard let fields = raw as? [String: Any], Set(fields.keys) == ["templateJSON", "templateAuthoringSourceJSON"] else { throw LocalVaultSharedFailure.invalid }
        func field(_ key: String) throws -> String? {
            if fields[key] is NSNull { return nil }
            guard let value = fields[key] as? String, value.utf8.count <= 1024 * 1024,
                  (try? JSONSerialization.jsonObject(with: Data(value.utf8))) is [String: Any] else { throw LocalVaultSharedFailure.invalid }
            return value
        }
        return try Presentation(templateJSON: field("templateJSON"), templateAuthoringSourceJSON: field("templateAuthoringSourceJSON"))
    }
    private func contentMatches(_ document: LocalVaultDocumentStore.Document, intent: Intent) -> Bool {
        guard document.contents.markdown == intent.markdown,
              let raw = document.contents.documentJSON,
              let actual = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? NSDictionary,
              let expected = try? JSONSerialization.jsonObject(with: Data(intent.documentJSON.utf8)) as? NSDictionary else { return false }
        if let metadata = try? presentation(intent.checkpoint) {
            guard document.contents.templateJSON == metadata.templateJSON, document.contents.templateAuthoringSourceJSON == metadata.templateAuthoringSourceJSON else { return false }
        }
        return actual == expected
    }
    /// Digest unchanged archive entries, so a same-text external asset/metadata edit is never adopted as our write.
    private func preservedEntries(_ bytes: Data, replacingPresentation: Bool = false) throws -> [String: String] {
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
            // The projection sidecar is derived from the two content entries.
            if [canonical + "text.md", canonical + "document.json", canonical + TextTextProjectionBaseline.entryName].contains(entry.path) || (replacingPresentation && [canonical + "template.json", canonical + "template-source.json"].contains(entry.path)) { continue }
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
        if let data = try read(directory.appendingPathComponent("move-intent.json"), limit: 5 * 1024 * 1024) {
            let intent = try JSONDecoder().decode(MoveIntent.self, from: data)
            guard intent.checkpoint.itemId == itemId else { throw LocalVaultSharedFailure.invalid }
            return try finishMove(intent, directory: directory)
        }
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
    /// Move the projection and its journal as one recoverable operation. Content,
    /// pending update batches and generations remain unchanged.
    /// `adoptingExternalChange` lets a gone source follow a same-identity file
    /// whose content also changed outside TextText. The caller must have proven
    /// the destination unique; the projection is kept as the reconciliation base.
    func rebase(itemId: String, newPath: String, adoptingExternalChange: Bool = false,
                interruptAfterIntent: Bool = false, interruptAfterMove: Bool = false) throws -> LocalVaultSharedCheckpoint {
        guard var target = try checkpoint(itemId: itemId), target.retiredReason == nil else { throw LocalVaultSharedFailure.staleSession }
        if target.path == newPath { return target }
        let source = target.path
        target.path = newPath
        guard var journal = try JSONSerialization.jsonObject(with: Data(target.journal.utf8)) as? [String: Any] else { throw LocalVaultSharedFailure.invalid }
        journal["relativePath"] = newPath
        target.journal = String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self)
        try validate(target)
        let store = LocalVaultDocumentStore(root: root)
        var adopted = false
        if FileManager.default.fileExists(atPath: try store.url(for: source).path) {
            let current = try store.read(path: source)
            guard current.hash == target.projectedHash,
                  MarkdownIdentityCodec.extract(from: current.contents.markdown)?.itemId == itemId,
                  !FileManager.default.fileExists(atPath: try store.url(for: newPath).path) else { throw LocalVaultSyncFailure.changed }
        } else {
            // Finder, the CLI or a cloud provider already moved the file. Adopt
            // the same identity at its new location; a changed projection is
            // allowed only when the caller asks for external-change adoption.
            let moved = try store.read(path: newPath)
            guard MarkdownIdentityCodec.extract(from: moved.contents.markdown)?.itemId == itemId,
                  moved.hash == target.projectedHash || adoptingExternalChange else { throw LocalVaultSyncFailure.changed }
            adopted = moved.hash != target.projectedHash
        }
        let directory = try itemDirectory(itemId)
        let intent = MoveIntent(sourcePath: source, checkpoint: target, adoptsExternalChange: adopted ? true : nil)
        try write(JSONEncoder().encode(intent), to: directory.appendingPathComponent("move-intent.json"))
        if interruptAfterIntent { throw LocalVaultSharedFailure.interrupted }
        return try finishMove(intent, directory: directory, interruptAfterMove: interruptAfterMove)
    }
    private func finishMove(_ intent: MoveIntent, directory: URL, interruptAfterMove: Bool = false) throws -> LocalVaultSharedCheckpoint {
        try validate(intent.checkpoint)
        let store = LocalVaultDocumentStore(root: root)
        let source = try store.url(for: intent.sourcePath)
        let target = intent.checkpoint
        guard intent.sourcePath != target.path else { throw LocalVaultSharedFailure.invalid }
        if FileManager.default.fileExists(atPath: source.path) {
            let current = try store.read(path: intent.sourcePath)
            guard current.hash == target.projectedHash,
                  MarkdownIdentityCodec.extract(from: current.contents.markdown)?.itemId == target.itemId else { throw LocalVaultSyncFailure.changed }
            _ = try store.rename(path: intent.sourcePath, expectedHash: current.hash, newPath: target.path)
            if interruptAfterMove { throw LocalVaultSharedFailure.interrupted }
        }
        let moved = try store.read(path: target.path)
        guard moved.hash == target.projectedHash || intent.adoptsExternalChange == true,
              MarkdownIdentityCodec.extract(from: moved.contents.markdown)?.itemId == target.itemId else { throw LocalVaultSyncFailure.changed }
        try write(JSONEncoder().encode(target), to: directory.appendingPathComponent("checkpoint.json"))
        try FileManager.default.removeItem(at: directory.appendingPathComponent("move-intent.json"))
        return target
    }
    private func finish(_ intent: Intent, directory: URL, interruptAfterWrite: Bool = false) throws -> LocalVaultSharedMaterialization {
        try validate(intent.checkpoint)
        let store = LocalVaultDocumentStore(root: root)
        guard let original = try read(directory.appendingPathComponent("before.textpack"), limit: 64 * 1024 * 1024),
              TextTextStableDigest.sha256Hex(original) == intent.beforeHash else { throw LocalVaultSharedFailure.invalid }
        let current = try? store.read(path: intent.checkpoint.path)
        let metadata = try presentation(intent.checkpoint)
        var checkpoint = intent.checkpoint
        let document: LocalVaultDocumentStore.Document
        if let current, current.hash == intent.beforeHash {
            // The shared editor projects both representations from one snapshot;
            // the store re-digests the stamp over the bytes it writes.
            document = try store.write(path: current.path, expectedHash: current.hash, markdown: intent.markdown,
                documentJSON: intent.documentJSON, templateJSON: metadata.map { $0.templateJSON } ?? current.contents.templateJSON,
                templateAuthoringSourceJSON: metadata.map { $0.templateAuthoringSourceJSON } ?? current.contents.templateAuthoringSourceJSON,
                projectionJSON: "")
            if interruptAfterWrite { throw LocalVaultSharedFailure.interrupted }
        } else if let current, contentMatches(current, intent: intent),
                  let bytes = try read(store.url(for: current.path), limit: 64 * 1024 * 1024),
                  try preservedEntries(bytes, replacingPresentation: metadata != nil) == preservedEntries(original, replacingPresentation: metadata != nil) {
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
        _ = try presentation(checkpoint)
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
                let incomingJournal = try JSONSerialization.jsonObject(with: Data(checkpoint.journal.utf8))
                let retainedJournal = try JSONSerialization.jsonObject(with: Data(prior.journal.utf8))
                guard try JSONSerialization.data(withJSONObject: incomingJournal, options: [.sortedKeys]) == JSONSerialization.data(withJSONObject: retainedJournal, options: [.sortedKeys]), checkpoint.pending == prior.pending,
                      current.hash == prior.projectedHash, contentMatches(current, intent: intent) else { throw LocalVaultSharedFailure.generation }
                return LocalVaultSharedMaterialization(document: current, checkpoint: prior)
            }
            if prior.pending && checkpoint.epoch != prior.epoch {
                guard let adoption = authorizedAdoption(prior: prior, incoming: checkpoint, current: current),
                      current.hash == expectedHash else { throw LocalVaultSharedFailure.staleSession }
                // The replaced epoch's journal stays recoverable on disk before
                // anything about it is rewritten. A retry of the same operation
                // rewrites the identical archive.
                try write(JSONEncoder().encode(prior), to: directory.appendingPathComponent("recovery-" + adoption.operationId + ".json"))
            }
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
