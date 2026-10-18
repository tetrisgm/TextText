import Foundation
import Darwin
import TextTextWorkspaceCore

/// Workspace identity index. Raw filename moves cannot bypass an unresolved
/// operation. This private format is independent of the native edit journal.
struct ReplacementRecoveryRegistry {
    private final class EntryCache: @unchecked Sendable {
        let lock = NSLock()
        var values: [String: (String, Entry)] = [:]
    }
    private static let cache = EntryCache()
    private static func requireKnownFields(_ bytes: Data) throws {
        guard let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(fields.keys).isSubset(of: Set(["version", "operation", "workspaceRootHash", "ownerHash", "itemId", "path", "expectedHash", "preparedHash", "recoveryPath", "resolution"])) else { throw Failure.invalidRegistry }
        if let value = fields["resolution"], !(value is NSNull) {
            guard let resolution = value as? [String: Any],
                  Set(resolution.keys).isSubset(of: Set(["visibleHash", "preparedHash", "displacedHash", "preparedFingerprint", "displacedFingerprint"])) else { throw Failure.invalidRegistry }
        }
    }
    struct Entry: Codable, Equatable {
        let version: Int
        let operation: UUID
        let workspaceRootHash: String
        var ownerHash: String
        let itemId: String
        let path: String
        let expectedHash: String
        let preparedHash: String
        var recoveryPath: String? = nil
        var resolution: Resolution?
    }
    struct Resolution: Codable, Equatable {
        let visibleHash: String
        let preparedHash: String
        let displacedHash: String
        var preparedFingerprint: String? = nil
        var displacedFingerprint: String? = nil
    }
    struct Inspection {
        let entry: Entry
        let recovery: RetainedFileReplacement.Recovery
        let prepared: Data
        let displaced: Data
        var preparedHash: String { TextTextStableDigest.sha256Hex(prepared) }
        var displacedHash: String { TextTextStableDigest.sha256Hex(displaced) }
    }
    enum Failure: Error, LocalizedError {
        case invalidRegistry, unresolved(UUID), observedVersionChanged
        var errorDescription: String? {
            switch self {
            case .invalidRegistry: return "This workspace's file recovery record is unavailable or needs a newer TextText version. Saved files are preserved."
            case .unresolved: return "This file has another retained version. Open Recovery to inspect both versions before saving."
            case .observedVersionChanged: return "The file or a retained version changed. Reopen Recovery and review the latest versions."
            }
        }
    }
    let root: URL
    private let physicalRoot: String?
    init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        if let canonical = realpath(self.root.path, nil) {
            self.physicalRoot = String(cString: canonical); free(canonical)
        } else { self.physicalRoot = nil }
    }
    private var directory: URL { LocalVaultDeviceState.directory(root: root).appendingPathComponent("replacement-index", isDirectory: true) }
    private func digest(_ data: Data) -> String { TextTextStableDigest.sha256Hex(data) }
    private func validHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private func ownerHash() throws -> String {
        let marker = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        guard FileManager.default.fileExists(atPath: marker.path) else { return digest(Data("unowned-local-workspace".utf8)) }
        let bytes = try StableFileSnapshot.read(marker, maximumBytes: 4096)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: bytes)
        guard (owner.version == 1 || owner.version == 2), owner.rootHash == digest(Data(root.path.utf8)) else { throw Failure.invalidRegistry }
        if owner.version == 2 { try RetainedReplacementProfile.verify(root: root, owner: owner) }
        _ = try LocalVaultAccountIdentity.validate(owner.accountId)
        _ = try PortableWorkspaceBinding.normalized(owner.binding)
        return try RetainedReplacementProfile.principalHash(owner)
    }
    /// Runs only inside the existing explicit account-adoption transaction.
    /// The before bytes remain in that transaction; foreign owners and unknown
    /// fields/formats cannot be silently rebound or rewritten.
    static func bindForAdoption(_ original: Data, path: String, root: URL, owner: LocalVaultAccountRootOwnership.Owner) throws -> (Data, Bool) {
        try requireKnownFields(original)
        var entry = try JSONDecoder().decode(Entry.self, from: original)
        let registry = ReplacementRecoveryRegistry(root: root)
        let principal = try RetainedReplacementProfile.principalHash(owner)
        guard entry.version == 1, entry.workspaceRootHash == registry.digest(Data(registry.root.path.utf8)),
              owner.rootHash == entry.workspaceRootHash, !entry.itemId.isEmpty, entry.itemId.utf8.count <= 256,
              entry.operation.uuidString + ".json" == (path as NSString).lastPathComponent,
              registry.validHash(entry.expectedHash), registry.validHash(entry.preparedHash) else { throw Failure.invalidRegistry }
        _ = try registry.target(entry)
        guard entry.ownerHash == registry.digest(Data("unowned-local-workspace".utf8)) || entry.ownerHash == principal else { throw LocalVaultAccountRootOwnership.Failure.account }
        if entry.ownerHash == principal { return (original, false) }
        let retained = try registry.recovery(entry, persistRelocation: false)
        guard retained.record.expectedHash == entry.expectedHash, retained.record.preparedHash == entry.preparedHash else { throw Failure.invalidRegistry }
        entry.ownerHash = principal
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return (try encoder.encode(entry), true)
    }
    private func target(_ entry: Entry) throws -> URL {
        let path = entry.recoveryPath ?? entry.path
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty, path.utf8.count <= 4096,
              path.utf8.allSatisfy({ $0 >= 32 && $0 != 127 }),
              parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") }),
              path.hasSuffix(".textpack") else { throw Failure.invalidRegistry }
        let target = root.appendingPathComponent(path)
        guard let physicalRoot else { throw Failure.invalidRegistry }
        var parentURL = target.deletingLastPathComponent()
        var remaining = Array(parts.dropLast())
        var actual = realpath(parentURL.path, nil)
        while actual == nil, errno == ENOENT, !remaining.isEmpty {
            parentURL.deleteLastPathComponent(); remaining.removeLast()
            actual = realpath(parentURL.path, nil)
        }
        guard let actual else { throw Failure.invalidRegistry }
        defer { free(actual) }
        let parent = remaining.joined(separator: "/")
        guard String(cString: actual) == physicalRoot + (parent.isEmpty ? "" : "/" + parent) else { throw Failure.invalidRegistry }
        return target
    }
    private func save(_ entry: Entry, creating: Bool) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalidRegistry }
        let final = directory.appendingPathComponent(entry.operation.uuidString + ".json")
        if creating {
            try RetainedFileReplacement.create(JSONEncoder().encode(entry), at: final)
        } else {
            let temporary = directory.appendingPathComponent("." + UUID().uuidString)
            try RetainedFileReplacement.create(JSONEncoder().encode(entry), at: temporary)
            guard rename(temporary.path, final.path) == 0 else { throw POSIXError(.EIO) }
        }
        try RetainedFileReplacement.flushDirectory(directory)
        try RetainedFileReplacement.flushDirectory(directory.deletingLastPathComponent())
        try RetainedFileReplacement.flushDirectory(root)
    }
    func entries() throws -> [Entry] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalidRegistry }
        let paths = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let principalHash = try ownerHash()
        let rootHash = digest(Data(root.path.utf8))
        return try paths.filter { !$0.lastPathComponent.hasPrefix(".") }.map { file in
            let stamp = try RetainedFileReplacement.fingerprint(file)
            Self.cache.lock.lock()
            let cached = Self.cache.values[file.path]
            Self.cache.lock.unlock()
            let entry: Entry
            if let cached, cached.0 == stamp { entry = cached.1 }
            else {
                let bytes = try StableFileSnapshot.read(file, maximumBytes: 8192)
                try Self.requireKnownFields(bytes)
                entry = try JSONDecoder().decode(Entry.self, from: bytes)
                guard stamp == (try RetainedFileReplacement.fingerprint(file)) else { throw Failure.invalidRegistry }
                Self.cache.lock.lock()
                if Self.cache.values.count >= 2048 { Self.cache.values.removeAll(keepingCapacity: true) }
                Self.cache.values[file.path] = (stamp, entry)
                Self.cache.lock.unlock()
            }
            guard entry.version == 1, entry.operation.uuidString + ".json" == file.lastPathComponent,
                  entry.workspaceRootHash == rootHash,
                  entry.ownerHash == principalHash,
                  !entry.itemId.isEmpty, entry.itemId.utf8.count <= 256,
                  validHash(entry.expectedHash), validHash(entry.preparedHash) else { throw Failure.invalidRegistry }
            _ = try target(entry)
            if let resolution = entry.resolution {
                guard validHash(resolution.visibleHash), validHash(resolution.preparedHash), validHash(resolution.displacedHash) else { throw Failure.invalidRegistry }
            }
            return entry
        }
    }
    /// Must be durable before invoking the replacement primitive. Even failure
    /// before staging remains a visible refusal, never a silent replay success.
    func register(operation: UUID, itemId: String, path: String, expectedHash: String, preparedHash: String) throws {
        let entry = Entry(version: 1, operation: operation, workspaceRootHash: digest(Data(root.path.utf8)), ownerHash: try ownerHash(), itemId: itemId, path: path,
                          expectedHash: expectedHash, preparedHash: preparedHash, resolution: nil)
        guard !itemId.isEmpty, itemId.utf8.count <= 256, validHash(expectedHash), validHash(preparedHash) else { throw Failure.invalidRegistry }
        _ = try target(entry)
        try save(entry, creating: true)
    }
    private func recovery(_ entry: Entry, persistRelocation: Bool = true) throws -> RetainedFileReplacement.Recovery {
        let originalTarget = try target(entry)
        let direct = RetainedFileReplacement.operationDirectory(target: originalTarget, operation: entry.operation)
        let recovery: RetainedFileReplacement.Recovery
        if FileManager.default.fileExists(atPath: direct.path) {
            recovery = try RetainedFileReplacement.recovery(target: originalTarget, operation: entry.operation)
        } else {
            // A provider or user may move the containing folder and its private
            // inode-retention directory. Locate only this exact UUID, never a
            // filename/content winner. Cache the relocated reference durably.
            guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsPackageDescendants]) else { throw Failure.unresolved(entry.operation) }
            var found: RetainedFileReplacement.Recovery?, scanned = 0
            for case let candidate as URL in enumerator {
                scanned += 1
                guard scanned <= 100_000 else { throw Failure.unresolved(entry.operation) }
                let values = try candidate.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                if values.isSymbolicLink == true { enumerator.skipDescendants(); continue }
                if candidate.lastPathComponent == ".texttext" { enumerator.skipDescendants(); continue }
                guard values.isDirectory == true, candidate.lastPathComponent == entry.operation.uuidString,
                      candidate.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent == ".texttext-replacements" else { continue }
                let movedTarget = candidate.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(originalTarget.lastPathComponent)
                let match = try RetainedFileReplacement.recovery(target: movedTarget, operation: entry.operation)
                guard found == nil else { throw Failure.invalidRegistry }
                found = match
                enumerator.skipDescendants()
            }
            guard let found else { throw Failure.unresolved(entry.operation) }
            recovery = found
            let movedTarget = classificationTarget(found)
            guard let physicalRoot, let parent = realpath(movedTarget.deletingLastPathComponent().path, nil) else { throw Failure.invalidRegistry }
            defer { free(parent) }
            let actualParent = String(cString: parent)
            guard actualParent == physicalRoot || actualParent.hasPrefix(physicalRoot + "/") else { throw Failure.invalidRegistry }
            let relativeParent = actualParent == physicalRoot ? "" : String(actualParent.dropFirst(physicalRoot.count + 1)) + "/"
            var updated = entry
            updated.recoveryPath = relativeParent + movedTarget.lastPathComponent
            if persistRelocation { try save(updated, creating: false) }
        }
        guard recovery.record.expectedHash == entry.expectedHash,
              recovery.record.preparedHash == entry.preparedHash else { throw Failure.unresolved(entry.operation) }
        return recovery
    }
    private func classificationTarget(_ recovery: RetainedFileReplacement.Recovery) -> URL {
        recovery.directory.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(recovery.record.filename)
    }
    func inspect(_ entry: Entry) throws -> Inspection {
        let recovery = try recovery(entry)
        let prepared = try StableFileSnapshot.read(recovery.prepared)
        guard digest(prepared) == entry.preparedHash else { throw Failure.invalidRegistry }
        return Inspection(entry: entry, recovery: recovery, prepared: prepared,
                          displaced: try StableFileSnapshot.read(recovery.displaced))
    }
    /// Nil identity means a malformed/unidentified projection. Fail closed for
    /// any unresolved workspace entry instead of accepting a renamed candidate.
    func assertReadable(itemId: String?) throws {
        for entry in try entries() where itemId == nil || itemId == entry.itemId {
            let retained = try recovery(entry)
            if let resolution = entry.resolution {
                if resolution.preparedFingerprint == (try? RetainedFileReplacement.fingerprint(retained.prepared)),
                   resolution.preparedFingerprint != nil,
                   resolution.displacedFingerprint == (try? RetainedFileReplacement.fingerprint(retained.displaced)),
                   resolution.displacedFingerprint != nil {
                    if retained.record.state != .completed || retained.record.acknowledgedDisplacedHash != resolution.displacedHash {
                        try RetainedFileReplacement.acknowledge(retained, preparedHash: resolution.preparedHash, displacedHash: resolution.displacedHash)
                    }
                    continue
                }
                let inspection = try inspect(entry)
                guard inspection.preparedHash == resolution.preparedHash,
                      inspection.displacedHash == resolution.displacedHash else { throw Failure.unresolved(entry.operation) }
                try RetainedFileReplacement.acknowledge(retained, preparedHash: resolution.preparedHash, displacedHash: resolution.displacedHash)
                continue
            }
            let classified = try RetainedFileReplacement.classify(retained, target: classificationTarget(retained))
            guard classified.record.state == .completed else { throw Failure.unresolved(entry.operation) }
        }
    }
    /// Snapshot every retained version into the existing recoverable TextPack
    /// list. Malformed external bytes remain at the original retained inode.
    @discardableResult func export(_ inspection: Inspection) throws -> [URL] {
        let destination = root.appendingPathComponent(".texttext/conflicts/" + inspection.entry.operation.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        guard destination.resolvingSymlinksInPath().path == destination.path else { throw Failure.invalidRegistry }
        var result: [URL] = []
        for bytes in [inspection.prepared, inspection.displaced] {
            let file = destination.appendingPathComponent(digest(bytes) + ".textpack")
            if FileManager.default.fileExists(atPath: file.path) {
                guard try StableFileSnapshot.read(file) == bytes else { throw Failure.observedVersionChanged }
            } else { try RetainedFileReplacement.create(bytes, at: file) }
            result.append(file)
        }
        try RetainedFileReplacement.flushDirectory(destination)
        try RetainedFileReplacement.flushDirectory(destination.deletingLastPathComponent())
        return result
    }
    /// Explicit user acknowledgement retains both snapshots and never changes
    /// the visible projection. A later old-descriptor write reopens the fence.
    func resolve(operation: UUID, visible: URL, itemId: String, observed: Resolution, observe: ((String) throws -> Void)? = nil) throws {
        guard let physicalRoot, let parent = realpath(visible.deletingLastPathComponent().path, nil) else { throw Failure.invalidRegistry }
        defer { free(parent) }
        let actualParent = String(cString: parent)
        guard actualParent == physicalRoot || actualParent.hasPrefix(physicalRoot + "/") else { throw Failure.invalidRegistry }
        guard var entry = try entries().first(where: { $0.operation == operation }), entry.itemId == itemId else { throw Failure.invalidRegistry }
        let first = try inspect(entry)
        guard first.preparedHash == observed.preparedHash, first.displacedHash == observed.displacedHash,
              digest(try StableFileSnapshot.read(visible)) == observed.visibleHash else { throw Failure.observedVersionChanged }
        _ = try export(first)
        let preparedStamp = try RetainedFileReplacement.fingerprint(first.recovery.prepared)
        let displacedStamp = try RetainedFileReplacement.fingerprint(first.recovery.displaced)
        let latest = try inspect(entry)
        guard latest.preparedHash == observed.preparedHash, latest.displacedHash == observed.displacedHash,
              preparedStamp == (try RetainedFileReplacement.fingerprint(first.recovery.prepared)),
              displacedStamp == (try RetainedFileReplacement.fingerprint(first.recovery.displaced)),
              digest(try StableFileSnapshot.read(visible)) == observed.visibleHash else { throw Failure.observedVersionChanged }
        var acknowledged = observed
        acknowledged.preparedFingerprint = preparedStamp
        acknowledged.displacedFingerprint = displacedStamp
        entry.resolution = acknowledged
        try save(entry, creating: false)
        try observe?("resolutionPreserved")
        try RetainedFileReplacement.acknowledge(latest.recovery, preparedHash: observed.preparedHash, displacedHash: observed.displacedHash)
    }
}
