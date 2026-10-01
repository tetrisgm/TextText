import Foundation
import TextTextWorkspaceCore

private func writeVaultSyncJournal(_ data: Data, to url: URL) throws {
    try data.write(to: url, options: .atomic)
    let handle = try FileHandle(forWritingTo: url)
    try handle.synchronize()
    try handle.close()
}

public struct LocalVaultSyncBinding: Codable, Sendable, Equatable {
    public let origin: URL
    public let workspaceId: String
    public init(origin: URL, workspaceId: String) throws {
        try Self.validate(origin: origin, workspaceId: workspaceId)
        self.origin = origin; self.workspaceId = workspaceId
    }
    static func validate(origin: URL, workspaceId: String) throws {
        let loopback = ["localhost", "127.0.0.1", "::1"].contains(origin.host ?? "")
        guard origin.scheme == "https" || (origin.scheme == "http" && loopback),
              origin.host != nil, origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil,
              origin.path.isEmpty || origin.path == "/",
              !workspaceId.isEmpty, workspaceId.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
        else { throw LocalVaultSyncFailure.invalidBinding }
    }
}

public struct LocalVaultSyncReport: Sendable {
    public var uploaded = 0
    public var downloaded = 0
    public var conflicts: [String] = []
    public var errors: [String] = []
    public var hasMore = false
    public init() {}
}

/// Each pass is sequential and bounded. A journal entry and its exact bytes are
/// durable before upload, so an interrupted request reuses its operation ID.
public actor LocalVaultSync {
    private struct Baseline: Codable {
        var path: String
        var revision: String
        var localHash: String
    }
    private struct Pending: Codable {
        var itemId: String
        var path: String
        var hash: String
        var baseRevision: String?
        var operationId: String
        var action: String? = nil
        var newPath: String? = nil
    }
    private struct Conflict: Codable {
        var localHash: String
        var remoteRevision: String
        var paths: [String]
        var remotePath: String? = nil
    }
    private struct State: Codable {
        var binding: LocalVaultSyncBinding
        var baselines: [String: Baseline] = [:]
        var outbox: [String: Pending] = [:]
        var conflicts: [String: Conflict] = [:]
        var cursor = 0
        var identities: [String: String]? = nil
        var sharedDownloads: [String: Bool]? = nil
    }
    private let root: URL
    private let directory: URL
    private let transport: any LocalVaultSyncTransport
    private var state: State
    private var running = false
    private struct SharedSession { var token: String; var path: String; var hash: String; var retired = false }
    private var sharedSessions: [String: SharedSession] = [:]
    private var sharedStore: LocalVaultSharedEditingStore { LocalVaultSharedEditingStore(root: root) }

    public init(root: URL, binding: LocalVaultSyncBinding, transport: any LocalVaultSyncTransport) throws {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        self.directory = self.root.appendingPathComponent(".texttext/sync", isDirectory: true)
        self.transport = transport
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        let stateURL = directory.appendingPathComponent("state.json")
        guard stateURL.resolvingSymlinksInPath().path == stateURL.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        if FileManager.default.fileExists(atPath: stateURL.path) {
            state = try JSONDecoder().decode(State.self, from: Data(contentsOf: stateURL))
            guard state.binding == binding else { throw LocalVaultSyncFailure.invalidBinding }
            for pending in state.outbox.values {
                guard UUID(uuidString: pending.operationId) != nil,
                      pending.hash.count == 64, pending.hash.allSatisfy({ $0.isHexDigit }) else {
                    throw LocalVaultSyncFailure.invalidResponse
                }
                _ = try LocalVaultDocumentStore(root: self.root).url(for: pending.path)
                if let newPath = pending.newPath { _ = try LocalVaultDocumentStore(root: self.root).url(for: newPath) }
            }
        } else {
            state = State(binding: binding)
            try FileManager.default.createDirectory(at: directory.appendingPathComponent("outbox"), withIntermediateDirectories: true)
            try writeVaultSyncJournal(JSONEncoder().encode(state), to: stateURL)
        }
    }

    public func readSharedCheckpoint(itemId: String) throws -> LocalVaultSharedCheckpoint? {
        do { return try sharedStore.checkpoint(itemId: itemId) }
        catch LocalVaultSyncFailure.changed { return try sharedStore.checkpoint(itemId: itemId) }
    }
    public func beginSharedEditing(itemId: String, path: String, expectedHash: String) throws -> LocalVaultSharedSession {
        guard sharedSessions[itemId] == nil else { throw LocalVaultSyncFailure.busy }
        let replayBeforeHash = try sharedStore.pendingIntentBeforeHash(itemId: itemId)
        var checkpoint = try readSharedCheckpoint(itemId: itemId)
        let document = try LocalVaultDocumentStore(root: root).read(path: path)
        let replayedOwnWrite = replayBeforeHash == expectedHash && checkpoint?.projectedHash == document.hash && checkpoint?.path == path && checkpoint?.retiredReason == nil
        guard document.hash == expectedHash || replayedOwnWrite,
              MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == itemId else { throw LocalVaultSyncFailure.changed }
        if let saved = checkpoint {
            if saved.retiredReason == nil && (saved.path != path || saved.projectedHash != document.hash) {
                if !saved.pending { try sharedStore.archive(itemId: itemId); checkpoint = nil }
                else { checkpoint = try sharedStore.retire(itemId: itemId, reason: "The file changed outside shared editing. Recover the retained shared journal before continuing.") }
            }
        }
        if checkpoint == nil {
            guard let baseline = state.baselines[itemId], baseline.path == path, baseline.localHash == document.hash else { throw LocalVaultSyncFailure.changed }
        }
        if checkpoint?.retiredReason == nil {
            guard state.outbox[itemId] == nil, state.conflicts[itemId] == nil else { throw LocalVaultSyncFailure.busy }
        }
        let session = SharedSession(token: UUID().uuidString, path: path, hash: document.hash)
        sharedSessions[itemId] = session
        return LocalVaultSharedSession(sessionToken: session.token, acknowledgedRevision: checkpoint?.acknowledgedRevision ?? state.baselines[itemId]!.revision, document: document, checkpoint: checkpoint)
    }
    public func materializeSharedEditing(sessionToken: String, itemId: String, expectedHash: String, epoch: Int, seq: Int,
        acknowledgedRevision: String, journalGeneration: UInt64, journal: String, pending: Bool,
        markdown: String, documentJSON: String) throws -> LocalVaultSharedMaterialization {
        guard let session = sharedSessions[itemId], session.token == sessionToken else { throw LocalVaultSharedFailure.staleSession }
        guard !session.retired else { throw LocalVaultSyncFailure.changed }
        guard session.hash == expectedHash else { throw LocalVaultSyncFailure.changed }
        guard state.outbox[itemId] == nil, state.conflicts[itemId] == nil else { throw LocalVaultSyncFailure.busy }
        let journalObject = try JSONSerialization.jsonObject(with: Data(journal.utf8)) as? [String: Any]
        let retirement = journalObject?["retired"] as? String
        let checkpoint = LocalVaultSharedCheckpoint(itemId: itemId, path: session.path, projectedHash: expectedHash,
            acknowledgedRevision: acknowledgedRevision, epoch: epoch, seq: seq, journalGeneration: journalGeneration,
            journal: journal, pending: pending, retiredReason: retirement)
        do {
            let result = try sharedStore.materialize(checkpoint: checkpoint, expectedHash: expectedHash, markdown: markdown, documentJSON: documentJSON)
            sharedSessions[itemId]?.hash = result.document.hash
            if result.checkpoint.retiredReason != nil { sharedSessions[itemId]?.retired = true }
            return result
        } catch LocalVaultSyncFailure.changed {
            sharedSessions[itemId]?.retired = true
            _ = try sharedStore.retire(itemId: itemId, reason: "The file changed outside shared editing. Its shared journal is retained for recovery.")
            throw LocalVaultSyncFailure.changed
        }
    }
    public func endSharedEditing(sessionToken: String, itemId: String, retiredReason: String? = nil) throws {
        guard sharedSessions[itemId]?.token == sessionToken else { throw LocalVaultSharedFailure.staleSession }
        if let retiredReason { _ = try sharedStore.retire(itemId: itemId, reason: retiredReason) }
        sharedSessions.removeValue(forKey: itemId)
        _ = try sharedProtection(itemId: itemId)
    }
    public func finishSharedRecovery(sessionToken: String, itemId: String, recoveryPath: String, recoveryHash: String) throws {
        guard let session = sharedSessions[itemId], session.token == sessionToken, recoveryPath != session.path else { throw LocalVaultSharedFailure.staleSession }
        let store = LocalVaultDocumentStore(root: root), recovered = try store.read(path: recoveryPath)
        guard recovered.hash == recoveryHash, let identity = MarkdownIdentityCodec.extract(from: recovered.contents.markdown)?.itemId,
              identity != itemId else { throw LocalVaultSyncFailure.changed }
        let checkpoint = try readSharedCheckpoint(itemId: itemId)
        let primary = try? store.read(path: session.path)
        if let checkpoint, let primary, primary.hash == checkpoint.projectedHash, primary.path == checkpoint.path {
            state.baselines[itemId] = Baseline(path: primary.path, revision: checkpoint.acknowledgedRevision, localHash: primary.hash)
            if state.sharedDownloads == nil { state.sharedDownloads = [:] }
            state.sharedDownloads?[itemId] = true
            try persist()
        }
        try sharedStore.archive(itemId: itemId)
        sharedSessions.removeValue(forKey: itemId)
        if state.sharedDownloads?[itemId] == true, let checkpoint, let primary,
           let acknowledged = try? store.readRevision(path: primary.path, hash: checkpoint.acknowledgedRevision) {
            let bytes = try Data(contentsOf: root.appendingPathComponent(".texttext/history/" + acknowledged.hash + ".textpack"))
            try install(LocalVaultRemotePack(data: bytes, relativePath: primary.path, revision: acknowledged.hash), itemId: itemId, path: primary.path, expectedLocal: primary.hash)
            state.baselines[itemId] = Baseline(path: primary.path, revision: acknowledged.hash, localHash: acknowledged.hash)
            // Keep the marker: a newer remote epoch must still be fetched when connectivity returns.
            try persist()
        }
    }
    /// Rechecked immediately before local install/staging as actor reentrancy can activate editing during network awaits.
    private func sharedProtection(itemId: String) throws -> Bool {
        let checkpoint = try readSharedCheckpoint(itemId: itemId)
        let live = sharedSessions[itemId]
        guard checkpoint != nil || live != nil else { return false }
        if checkpoint == nil, live?.retired == true { return false }
        let path = checkpoint?.path ?? live!.path, expected = checkpoint?.projectedHash ?? live!.hash
        let current = try? LocalVaultDocumentStore(root: root).readMetadata(path: path)
        guard let current, current.hash == expected, MarkdownIdentityCodec.extract(from: current.contents.markdown)?.itemId == itemId else {
            if let checkpoint, !checkpoint.pending {
                // The shared journal is clean: its acknowledged revision is the
                // real common ancestor for a subsequent Finder or agent edit.
                // The older sync baseline predates shared editing and would
                // otherwise manufacture a conflict with the already advanced server.
                state.baselines[itemId] = Baseline(path: checkpoint.path, revision: checkpoint.acknowledgedRevision, localHash: checkpoint.projectedHash)
                if state.sharedDownloads == nil { state.sharedDownloads = [:] }
                state.sharedDownloads?[itemId] = true
                try persist()
                try sharedStore.archive(itemId: itemId)
                sharedSessions[itemId]?.retired = true
                return false
            }
            _ = try sharedStore.retire(itemId: itemId, reason: "The file was changed, moved, or deleted outside shared editing. The retained journal is available for recovery.")
            sharedSessions[itemId]?.retired = true
            return false
        }
        if checkpoint?.retiredReason != nil || live?.retired == true {
            // Retired shared bytes still need recovery; external file changes took the branch above.
            if checkpoint?.pending == true { return true }
            sharedSessions[itemId]?.retired = true
            if let checkpoint {
                state.baselines[itemId] = Baseline(path: checkpoint.path, revision: checkpoint.acknowledgedRevision, localHash: checkpoint.projectedHash)
                if state.sharedDownloads == nil { state.sharedDownloads = [:] }
                state.sharedDownloads?[itemId] = true
                try persist()
                try sharedStore.archive(itemId: itemId)
            }
            return false
        }
        if live != nil || checkpoint?.pending == true { return true }
        if let checkpoint, state.baselines[itemId]?.path != checkpoint.path || state.baselines[itemId]?.revision != checkpoint.acknowledgedRevision || state.baselines[itemId]?.localHash != checkpoint.projectedHash {
            state.baselines[itemId] = Baseline(path: checkpoint.path, revision: checkpoint.acknowledgedRevision, localHash: checkpoint.projectedHash)
            try persist()
        }
        return false
    }

    public static func binding(root: URL) throws -> LocalVaultSyncBinding? {
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let url = canonicalRoot.appendingPathComponent(".texttext/sync/state.json")
        guard url.resolvingSymlinksInPath().path == url.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(State.self, from: Data(contentsOf: url)).binding
    }

    /// Collaboration may take over only after these exact local bytes have an acknowledged remote baseline.
    public static func collaborationReady(root: URL, path: String, itemId: String, localHash: String) throws -> Bool {
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let url = canonicalRoot.appendingPathComponent(".texttext/sync/state.json")
        guard url.resolvingSymlinksInPath().path == url.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 16 * 1024 * 1024 else { throw LocalVaultDocumentStore.Failure.tooLarge }
        let state = try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
        guard let baseline = state.baselines[itemId], baseline.path == path,
              baseline.localHash == localHash, baseline.revision.count == 64,
              baseline.revision.allSatisfy({ $0.isHexDigit }),
              state.outbox[itemId] == nil, state.conflicts[itemId] == nil else { return false }
        return true
    }

    private func persist() throws {
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        try writeVaultSyncJournal(JSONEncoder().encode(state), to: directory.appendingPathComponent("state.json"))
    }
    private func payload(_ pending: Pending) -> URL {
        directory.appendingPathComponent("outbox/\(pending.operationId).textpack")
    }
    private func hash(at url: URL) throws -> String {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 64 * 1024 * 1024 else { throw LocalVaultDocumentStore.Failure.tooLarge }
        return TextTextStableDigest.sha256Hex(try Data(contentsOf: url))
    }
    private func validate(_ pack: LocalVaultRemotePack, itemId: String, path: String) throws {
        guard pack.relativePath == path, pack.data.count <= 64 * 1024 * 1024,
              TextTextStableDigest.sha256Hex(pack.data) == pack.revision else { throw LocalVaultSyncFailure.invalidResponse }
        _ = try LocalVaultDocumentStore(root: root).url(for: path)
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let url = scratch.appendingPathComponent("remote.textpack")
        try pack.data.write(to: url)
        let contents = try TextTextTextBundlePackage.read(from: url, in: scratch)
        guard MarkdownIdentityCodec.extract(from: contents.markdown)?.itemId == itemId else {
            throw LocalVaultSyncFailure.invalidResponse
        }
    }

    /// expectedLocal nil means create-only. File coordination and a final byte
    /// check prevent a download from replacing an intervening editor save.
    private func install(_ pack: LocalVaultRemotePack, itemId: String, path: String, expectedLocal: String?) throws {
        guard try !sharedProtection(itemId: itemId) else { throw LocalVaultSharedFailure.protected }
        try validate(pack, itemId: itemId, path: path)
        let target = try LocalVaultDocumentStore(root: root).url(for: path)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        var error: NSError?
        var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &error) { target in
            result = Result {
                let exists = FileManager.default.fileExists(atPath: target.path)
                if let expectedLocal {
                    guard exists, try hash(at: target) == expectedLocal else { throw LocalVaultSyncFailure.changed }
                } else if exists { throw LocalVaultSyncFailure.changed }
                let staging = target.deletingLastPathComponent().appendingPathComponent(".texttext-download-\(UUID().uuidString)")
                try pack.data.write(to: staging, options: .atomic)
                defer { try? FileManager.default.removeItem(at: staging) }
                if exists {
                    let history = root.appendingPathComponent(".texttext/history")
                    try FileManager.default.createDirectory(at: history, withIntermediateDirectories: true)
                    let before = try Data(contentsOf: target)
                    guard TextTextStableDigest.sha256Hex(before) == expectedLocal else { throw LocalVaultSyncFailure.changed }
                    let recovery = history.appendingPathComponent("\(expectedLocal!).textpack")
                    if !FileManager.default.fileExists(atPath: recovery.path) { try before.write(to: recovery, options: .atomic) }
                    _ = try FileManager.default.replaceItemAt(target, withItemAt: staging)
                } else { try FileManager.default.moveItem(at: staging, to: target) }
            }
        }
        if let error { throw error }
        guard let result else { throw LocalVaultSyncFailure.changed }
        try result.get()
    }

    private func preserveConflict(_ pending: Pending, remote: LocalVaultRemotePack) throws -> [String] {
        try validate(remote, itemId: pending.itemId, path: remote.relativePath)
        let folder = ".texttext/conflicts/\(pending.operationId)"
        let destination = root.appendingPathComponent(folder)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        var paths: [String] = []
        if let local = try? Data(contentsOf: payload(pending)) {
            let path = "\(folder)/local-\((pending.path as NSString).lastPathComponent)"
            try local.write(to: root.appendingPathComponent(path), options: .atomic)
            paths.append(path)
        }
        let remotePath = "\(folder)/remote-\((remote.relativePath as NSString).lastPathComponent)"
        try remote.data.write(to: root.appendingPathComponent(remotePath), options: .atomic)
        paths.append(remotePath)
        state.conflicts[pending.itemId] = Conflict(localHash: pending.hash, remoteRevision: remote.revision,
                                                 paths: paths, remotePath: remote.relativePath)
        return paths
    }

    private func preserveDeletedConflict(_ pending: Pending, tombstone: LocalVaultRemoteItem) throws -> [String] {
        let folder = ".texttext/conflicts/\(pending.operationId)"
        let destination = root.appendingPathComponent(folder)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        var paths: [String] = []
        if let local = try? Data(contentsOf: payload(pending)) {
            let path = "\(folder)/local-\((pending.path as NSString).lastPathComponent)"
            try local.write(to: root.appendingPathComponent(path), options: .atomic)
            paths.append(path)
        }
        try JSONEncoder().encode(tombstone).write(to: destination.appendingPathComponent("remote-deletion.json"), options: .atomic)
        state.conflicts[pending.itemId] = Conflict(localHash: pending.hash, remoteRevision: tombstone.revision,
                                                 paths: paths, remotePath: tombstone.relativePath)
        return paths
    }

    private func stage(itemId: String, path: String, hash: String, base: String?,
                       bytes: Data?, action: String? = nil, newPath: String? = nil) throws -> Pending {
        guard try !sharedProtection(itemId: itemId) else { throw LocalVaultSharedFailure.protected }
        let pending = Pending(itemId: itemId, path: path, hash: hash, baseRevision: base,
                              operationId: UUID().uuidString.lowercased(), action: action, newPath: newPath)
        if let bytes { try writeVaultSyncJournal(bytes, to: payload(pending)) }
        state.outbox[itemId] = pending
        try persist()
        return pending
    }

    private func send(_ pending: Pending, report: inout LocalVaultSyncReport) async throws {
        do {
            if pending.action == "delete" {
                guard let base = pending.baseRevision else { throw LocalVaultSyncFailure.invalidResponse }
                try await transport.delete(itemId: pending.itemId, path: pending.path, baseRevision: base, operationId: pending.operationId)
                state.baselines.removeValue(forKey: pending.itemId)
            } else if pending.action == "rename" {
                guard let base = pending.baseRevision, let newPath = pending.newPath,
                      var baseline = state.baselines[pending.itemId] else { throw LocalVaultSyncFailure.invalidResponse }
                let revision = try await transport.rename(itemId: pending.itemId, from: pending.path, to: newPath,
                    baseRevision: base, operationId: pending.operationId)
                baseline.path = newPath; baseline.revision = revision
                state.baselines[pending.itemId] = baseline
                report.hasMore = true
            } else {
                let bytes = try Data(contentsOf: payload(pending))
                guard TextTextStableDigest.sha256Hex(bytes) == pending.hash else { throw LocalVaultSyncFailure.invalidResponse }
                let revision = try await transport.upload(itemId: pending.itemId, path: pending.path, data: bytes,
                    baseRevision: pending.baseRevision, operationId: pending.operationId)
                if revision != pending.hash {
                    let remote = try await transport.download(itemId: pending.itemId)
                    try install(remote, itemId: pending.itemId, path: pending.path, expectedLocal: pending.hash)
                    state.baselines[pending.itemId] = Baseline(path: pending.path, revision: remote.revision, localHash: remote.revision)
                } else {
                    state.baselines[pending.itemId] = Baseline(path: pending.path, revision: revision, localHash: pending.hash)
                }
            }
            state.conflicts.removeValue(forKey: pending.itemId)
            report.uploaded += 1
        } catch LocalVaultSyncFailure.conflict {
            let records = try await transport.manifest()
            if let tombstone = records.first(where: { $0.itemId == pending.itemId && $0.isDeleted }) {
                report.conflicts += try preserveDeletedConflict(pending, tombstone: tombstone)
            } else {
                let remote = try await transport.download(itemId: pending.itemId)
                report.conflicts += try preserveConflict(pending, remote: remote)
            }
        } catch LocalVaultSyncFailure.changed {
            report.hasMore = true
        }
        state.outbox.removeValue(forKey: pending.itemId)
        try persist()
        try? FileManager.default.removeItem(at: payload(pending))
    }

    private func removeLocal(path: String, expectedHash: String) throws {
        let url = try LocalVaultDocumentStore(root: root).url(for: path)
        var error: NSError?
        var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &error) { target in
            result = Result {
                let before = try Data(contentsOf: target)
                guard TextTextStableDigest.sha256Hex(before) == expectedHash else { throw LocalVaultSyncFailure.changed }
                let history = root.appendingPathComponent(".texttext/history")
                try FileManager.default.createDirectory(at: history, withIntermediateDirectories: true)
                try before.write(to: history.appendingPathComponent(expectedHash + ".textpack"), options: .atomic)
                try FileManager.default.removeItem(at: target)
            }
        }
        if let error { throw error }
        guard let result else { throw LocalVaultSyncFailure.changed }
        try result.get()
    }

    private func moveLocal(from: String, to: String, expectedHash: String) throws {
        let store = LocalVaultDocumentStore(root: root)
        let source = try store.url(for: from), destination = try store.url(for: to)
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        var error: NSError?
        var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: source, options: .forMoving,
            writingItemAt: destination, options: [], error: &error) { source, destination in
            result = Result {
                guard try hash(at: source) == expectedHash else { throw LocalVaultSyncFailure.changed }
                guard !FileManager.default.fileExists(atPath: destination.path) else { throw LocalVaultSyncFailure.conflict }
                try FileManager.default.moveItem(at: source, to: destination)
            }
        }
        if let error { throw error }
        guard let result else { throw LocalVaultSyncFailure.changed }
        try result.get()
    }

    public func sync(maxItems: Int = 128) async throws -> LocalVaultSyncReport {
        guard !running else { throw LocalVaultSyncFailure.busy }
        running = true
        defer { running = false }
        var report = LocalVaultSyncReport()
        let budget = max(1, min(maxItems, 512))
        // Retry exact journal entries before producing new operations.
        for pending in state.outbox.values.sorted(by: { $0.path < $1.path }).prefix(budget) {
            do { try await send(pending, report: &report) }
            catch { report.errors.append("\(pending.path): \(error.localizedDescription)") }
        }
        let manifest = try await transport.manifest()
        var remoteByID: [String: LocalVaultRemoteItem] = [:]
        var remotePaths = Set<String>()
        for item in manifest {
            _ = try LocalVaultDocumentStore(root: root).url(for: item.relativePath)
            guard remoteByID[item.itemId] == nil else { throw LocalVaultSyncFailure.invalidResponse }
            if !item.isDeleted, !remotePaths.insert(item.relativePath).inserted { throw LocalVaultSyncFailure.invalidResponse }
            remoteByID[item.itemId] = item
        }
        let store = LocalVaultDocumentStore(root: root)
        let paths = try store.list()
        let pathSet = Set(paths)
        var identities = (state.identities ?? [:]).filter { pathSet.contains($0.key) }
        var inspected = 0
        var indexComplete = true
        for path in paths where identities[path] == nil {
            guard inspected < budget else { indexComplete = false; continue }
            inspected += 1
            do {
                let document = try store.read(path: path)
                if let id = MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId { identities[path] = id }
                else { indexComplete = false; report.errors.append("\(path): missing document identity") }
            } catch { indexComplete = false; report.errors.append("\(path): \(error.localizedDescription)") }
        }
        state.identities = identities
        var localByID: [String: [String]] = [:]
        for (path, id) in identities { localByID[id, default: []].append(path) }
        let ids = Array(Set(localByID.keys).union(remoteByID.keys).union(state.baselines.keys)).sorted()
        guard !ids.isEmpty else { return report }
        let start = min(state.cursor, ids.count - 1)
        let count = min(budget, ids.count - start)
        for id in ids[start..<(start + count)] {
            var activePath = localByID[id]?.first ?? remoteByID[id]?.relativePath ?? state.baselines[id]?.path ?? id
            do {
                if try sharedProtection(itemId: id) { continue }
                guard (localByID[id]?.count ?? 0) <= 1 else { throw LocalVaultSyncFailure.duplicateIdentity(activePath) }
                if state.outbox[id] != nil { report.hasMore = true; continue }
                let remote = remoteByID[id]
                var baseline = state.baselines[id]
                var localPath = localByID[id]?.first
                var document = try localPath.map { try store.read(path: $0) }
                if let document, MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId != id {
                    state.identities?.removeValue(forKey: document.path)
                    throw LocalVaultSyncFailure.changed
                }
                if let conflict = state.conflicts[id],
                   conflict.localHash == (document?.hash ?? baseline?.localHash),
                   conflict.remoteRevision == remote?.revision,
                   conflict.remotePath == nil || conflict.remotePath == remote?.relativePath {
                    report.conflicts += conflict.paths; continue
                }
                if let remote, remote.isDeleted {
                    if let document, let localPath {
                        if let baseline, baseline.localHash == document.hash, baseline.revision == remote.revision,
                           baseline.path == localPath, baseline.path == remote.relativePath {
                            try removeLocal(path: localPath, expectedHash: document.hash)
                            state.identities?.removeValue(forKey: localPath)
                            state.baselines.removeValue(forKey: id)
                            report.downloaded += 1
                        } else {
                            let bytes = try Data(contentsOf: store.url(for: localPath))
                            guard TextTextStableDigest.sha256Hex(bytes) == document.hash else { throw LocalVaultSyncFailure.changed }
                            let pending = try stage(itemId: id, path: localPath, hash: document.hash,
                                base: baseline?.revision, bytes: bytes)
                            report.conflicts += try preserveDeletedConflict(pending, tombstone: remote)
                            state.outbox.removeValue(forKey: id)
                            try persist(); try? FileManager.default.removeItem(at: payload(pending))
                        }
                    } else { state.baselines.removeValue(forKey: id) }
                    try persist(); continue
                }
                if document == nil {
                    guard indexComplete else { report.hasMore = true; continue }
                    guard let remote else { continue }
                    if let baseline {
                        let history = root.appendingPathComponent(".texttext/history/\(baseline.localHash).textpack")
                        let pending = try stage(itemId: id, path: baseline.path, hash: baseline.localHash,
                            base: baseline.revision, bytes: try? Data(contentsOf: history), action: "delete")
                        try await send(pending, report: &report)
                    } else {
                        let pack = try await transport.download(itemId: id)
                        try install(pack, itemId: id, path: remote.relativePath, expectedLocal: nil)
                        state.baselines[id] = Baseline(path: remote.relativePath, revision: pack.revision, localHash: pack.revision)
                        state.identities?[remote.relativePath] = id
                        try persist(); report.downloaded += 1
                    }
                    continue
                }
                guard var current = document, var path = localPath else { continue }
                if var previous = baseline, let remote {
                    if path != previous.path {
                        if remote.relativePath == path {
                            previous.path = path
                            state.baselines[id] = previous; baseline = previous
                        } else {
                            let bytes = try Data(contentsOf: store.url(for: path))
                            guard TextTextStableDigest.sha256Hex(bytes) == current.hash else { throw LocalVaultSyncFailure.changed }
                            let pending = try stage(itemId: id, path: previous.path, hash: current.hash,
                                base: previous.revision, bytes: bytes, action: "rename", newPath: path)
                            try await send(pending, report: &report)
                            continue
                        }
                    } else if remote.relativePath != previous.path {
                        // A remote rename can carry concurrent local content edits.
                        // Move those bytes first, then upload against their old base.
                        try moveLocal(from: path, to: remote.relativePath, expectedHash: current.hash)
                        state.identities?.removeValue(forKey: path)
                        path = remote.relativePath; activePath = path
                        state.identities?[path] = id
                        previous.path = path; state.baselines[id] = previous; baseline = previous
                        localPath = path; document = try store.read(path: path); current = document!
                        report.downloaded += 1
                        try persist()
                    }
                }
                if let baseline, remote == nil {
                    report.errors.append("\(baseline.path): server omitted this tracked document without a tombstone")
                    continue
                }
                if let remote, remote.relativePath != path { throw LocalVaultSyncFailure.duplicateIdentity(path) }
                if state.sharedDownloads?[id] == true {
                    if let baseline, baseline.localHash == current.hash, let remote {
                        let pack = try await transport.download(itemId: id)
                        try install(pack, itemId: id, path: path, expectedLocal: current.hash)
                        state.baselines[id] = Baseline(path: path, revision: pack.revision, localHash: pack.revision)
                        state.sharedDownloads?.removeValue(forKey: id)
                        try persist(); report.downloaded += 1
                        continue
                    }
                    // An external edit after recovery is real file work, not the abandoned shared projection.
                    state.sharedDownloads?.removeValue(forKey: id)
                    try persist()
                }
                if remote?.revision == current.hash {
                    state.baselines[id] = Baseline(path: path, revision: current.hash, localHash: current.hash)
                    state.conflicts.removeValue(forKey: id)
                    try persist(); continue
                }
                if let baseline, baseline.localHash == current.hash {
                    guard let remote, remote.revision != baseline.revision else { continue }
                    let pack = try await transport.download(itemId: id)
                    try install(pack, itemId: id, path: path, expectedLocal: current.hash)
                    state.baselines[id] = Baseline(path: path, revision: pack.revision, localHash: pack.revision)
                    try persist(); report.downloaded += 1
                    continue
                }
                let bytes = try Data(contentsOf: store.url(for: path))
                guard TextTextStableDigest.sha256Hex(bytes) == current.hash else { throw LocalVaultSyncFailure.changed }
                let pending = try stage(itemId: id, path: path, hash: current.hash, base: baseline?.revision, bytes: bytes)
                try await send(pending, report: &report)
            } catch LocalVaultSharedFailure.protected { continue }
            catch { report.errors.append("\(activePath): \(error.localizedDescription)") }
        }
        state.cursor = (start + count) % ids.count
        report.hasMore = report.hasMore || !indexComplete || start + count < ids.count || !state.outbox.isEmpty
        try persist()
        return report
    }
}
