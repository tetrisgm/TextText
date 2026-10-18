import Foundation
import Darwin
import TextTextWorkspaceCore

/// Workspace identity index. Raw filename moves cannot bypass an unresolved
/// operation. This private format is independent of the native edit journal.
struct ReplacementRecoveryRegistry {
    private final class EntryCache: @unchecked Sendable {
        let lock = NSLock()
        var values: [String: (String, Entry)] = [:]
        var indexes: [String: (String, [String: [URL]])] = [:]
    }
    private static let cache = EntryCache()
    private static func requireKnownFields(_ bytes: Data) throws {
        guard let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(fields.keys).isSubset(of: Set(["version", "operation", "workspaceRootHash", "ownerHash", "itemId", "path", "expectedHash", "preparedHash", "recoveryPath", "resolution", "kind", "userDeletion", "deletionMarkerPublished", "deletionIntentCancelled"])) else { throw Failure.invalidRegistry }
        if let value = fields["resolution"], !(value is NSNull) {
            guard let resolution = value as? [String: Any],
                  Set(resolution.keys).isSubset(of: Set(["visibleHash", "preparedHash", "displacedHash", "preparedFingerprint", "displacedFingerprint", "currentPresent"])) else { throw Failure.invalidRegistry }
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
        var kind: String? = nil
        var userDeletion: Bool? = nil
        var deletionMarkerPublished: Bool? = nil
        var deletionIntentCancelled: Bool? = nil
    }
    struct Resolution: Codable, Equatable {
        let visibleHash: String?
        let preparedHash: String
        let displacedHash: String
        var preparedFingerprint: String? = nil
        var displacedFingerprint: String? = nil
        var currentPresent: Bool? = nil
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
        guard FileManager.default.fileExists(atPath: marker.path) else {
            guard !RetainedReplacementProfile.hasRetainedProfile(stateDirectory: marker.deletingLastPathComponent()) else { throw Failure.invalidRegistry }
            return digest(Data("unowned-local-workspace".utf8))
        }
        let bytes = try StableFileSnapshot.read(marker, maximumBytes: 4096)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: bytes)
        guard (owner.version == 1 || owner.version == 2), owner.rootHash == digest(Data(root.path.utf8)) else { throw Failure.invalidRegistry }
        if owner.version == 2 || RetainedReplacementProfile.hasPublishedMarker(stateDirectory: marker.deletingLastPathComponent()) { try RetainedReplacementProfile.verify(root: root, owner: owner) }
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
        guard entry.version == 1, (entry.kind == nil || entry.kind == "removal"), entry.workspaceRootHash == registry.digest(Data(registry.root.path.utf8)),
              owner.rootHash == entry.workspaceRootHash, !entry.itemId.isEmpty, entry.itemId.utf8.count <= 256,
              entry.operation.uuidString + ".json" == (path as NSString).lastPathComponent,
              registry.validHash(entry.expectedHash), registry.validHash(entry.preparedHash) else { throw Failure.invalidRegistry }
        guard entry.userDeletion != true || entry.kind == "removal",
              entry.deletionMarkerPublished != true || (entry.kind == "removal" && entry.userDeletion == true),
              entry.deletionIntentCancelled != true || (entry.kind == "removal" && entry.userDeletion == true),
              entry.kind != "removal" || entry.expectedHash == entry.preparedHash else { throw Failure.invalidRegistry }
        _ = try registry.target(entry)
        guard entry.ownerHash == registry.digest(Data("unowned-local-workspace".utf8)) || entry.ownerHash == principal else { throw LocalVaultAccountRootOwnership.Failure.account }
        if entry.ownerHash == principal { return (original, false) }
        let retained = try registry.recovery(entry, persistRelocation: false)
        guard retained.record.expectedHash == entry.expectedHash, retained.record.preparedHash == entry.preparedHash else { throw Failure.invalidRegistry }
        entry.ownerHash = principal
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return (try encoder.encode(entry), true)
    }
    func recoveryRoot(path: String) -> URL {
        root.appendingPathComponent(".texttext/retained-replacements/" + digest(Data(path.utf8)), isDirectory: true)
    }
    private func usesWorkspaceStaging(_ entry: Entry) -> Bool {
        entry.recoveryPath == ".texttext/retained-replacements/" + digest(Data(entry.path.utf8)) + "/" + (entry.path as NSString).lastPathComponent
    }
    private func target(_ entry: Entry) throws -> URL {
        let path = entry.recoveryPath ?? entry.path
        let visibleParts = entry.path.split(separator: "/", omittingEmptySubsequences: false)
        guard !visibleParts.isEmpty, entry.path.utf8.count <= 4096,
              entry.path.utf8.allSatisfy({ $0 >= 32 && $0 != 127 }),
              visibleParts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") }),
              entry.path.hasSuffix(".textpack") else { throw Failure.invalidRegistry }
        if usesWorkspaceStaging(entry) {
            // Only this recomputed layout admits hidden path components. The
            // helper validates its operation directory's physical containment.
            let target = root.appendingPathComponent(path)
            guard let physicalRoot else { throw Failure.invalidRegistry }
            var ancestor = target.deletingLastPathComponent()
            while !FileManager.default.fileExists(atPath: ancestor.path), ancestor.path != root.path { ancestor.deleteLastPathComponent() }
            guard let actual = realpath(ancestor.path, nil) else { throw Failure.invalidRegistry }
            defer { free(actual) }
            let relative = String(ancestor.path.dropFirst(root.path.count))
            guard String(cString: actual) == physicalRoot + relative else { throw Failure.invalidRegistry }
            return target
        }
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
        let expected = physicalRoot + (parent.isEmpty ? "" : "/" + parent)
        if String(cString: actual) != expected {
            // Case-insensitive volumes may preserve a new containing-folder
            // spelling while the old spelling still resolves the same inode.
            // Validate every relative component without following links; never
            // turn distinct case-sensitive directories into one identity.
            var current = root
            for component in remaining {
                current.appendPathComponent(String(component), isDirectory: true)
                var info = stat()
                guard lstat(current.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw Failure.invalidRegistry }
            }
            var lexical = stat(), canonical = stat()
            guard lstat(parentURL.path, &lexical) == 0, lstat(actual, &canonical) == 0,
                  lexical.st_dev == canonical.st_dev, lexical.st_ino == canonical.st_ino else { throw Failure.invalidRegistry }
        }
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
    private func indexedPaths(itemId: String?) throws -> [URL] {
        for _ in 0..<3 {
            let generation = try directoryFingerprint()
            Self.cache.lock.lock()
            let cached = Self.cache.indexes[directory.path]
            Self.cache.lock.unlock()
            if let cached, cached.0 == generation {
                if let itemId { return cached.1[itemId] ?? [] }
                return cached.1.values.flatMap { $0 }
            }
            let paths = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { !$0.lastPathComponent.hasPrefix(".") }
            var index: [String: [URL]] = [:]
            for file in paths {
                // Private records are published atomically. Identity extraction
                // does not accept the record: selected records still undergo
                // exact fingerprint/schema/principal checks below.
                let bytes = try StableFileSnapshot.read(file, maximumBytes: 8192)
                guard let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                      let identity = fields["itemId"] as? String, !identity.isEmpty, identity.utf8.count <= 256 else { throw Failure.invalidRegistry }
                index[identity, default: []].append(file)
            }
            guard generation == (try directoryFingerprint()) else { continue }
            Self.cache.lock.lock()
            if Self.cache.indexes.count >= 32 { Self.cache.indexes.removeAll(keepingCapacity: true) }
            Self.cache.indexes[directory.path] = (generation, index)
            Self.cache.lock.unlock()
            if let itemId { return index[itemId] ?? [] }
            return paths
        }
        throw Failure.invalidRegistry
    }
    private func directoryFingerprint() throws -> String {
        var info = stat()
        guard lstat(directory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw Failure.invalidRegistry }
        return "\(info.st_dev):\(info.st_ino):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec):\(info.st_ctimespec.tv_sec):\(info.st_ctimespec.tv_nsec)"
    }
    func entries(itemId: String? = nil) throws -> [Entry] {
        // An already-open store must also refuse an interrupted owner/profile
        // publication, even before its first document replacement is indexed.
        let principalHash = try ownerHash()
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalidRegistry }
        let paths = try indexedPaths(itemId: itemId)
        let rootHash = digest(Data(root.path.utf8))
        var validatedTargets = Set<String>()
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
            guard (itemId == nil || entry.itemId == itemId), entry.version == 1, (entry.kind == nil || entry.kind == "removal"), entry.operation.uuidString + ".json" == file.lastPathComponent,
                  entry.workspaceRootHash == rootHash,
                  entry.ownerHash == principalHash,
                  !entry.itemId.isEmpty, entry.itemId.utf8.count <= 256,
                  validHash(entry.expectedHash), validHash(entry.preparedHash) else { throw Failure.invalidRegistry }
            guard entry.userDeletion != true || entry.kind == "removal",
                  entry.deletionMarkerPublished != true || (entry.kind == "removal" && entry.userDeletion == true),
              entry.deletionIntentCancelled != true || (entry.kind == "removal" && entry.userDeletion == true),
                  entry.kind != "removal" || entry.expectedHash == entry.preparedHash else { throw Failure.invalidRegistry }
            if validatedTargets.insert(entry.path + "\0" + (entry.recoveryPath ?? entry.path)).inserted { _ = try target(entry) }
            if let resolution = entry.resolution {
                guard (resolution.currentPresent != false || entry.kind == "removal"), ((resolution.currentPresent ?? true) ? resolution.visibleHash.map(validHash) == true : resolution.visibleHash == nil), validHash(resolution.preparedHash), validHash(resolution.displacedHash) else { throw Failure.invalidRegistry }
            }
            return entry
        }
    }
    /// Must be durable before invoking the replacement primitive. Even failure
    /// before staging remains a visible refusal, never a silent replay success.
    func register(operation: UUID, itemId: String, path: String, expectedHash: String, preparedHash: String, workspaceStaging: Bool = false, kind: String? = nil, userDeletion: Bool = false) throws {
        var entry = Entry(version: 1, operation: operation, workspaceRootHash: digest(Data(root.path.utf8)), ownerHash: try ownerHash(), itemId: itemId, path: path,
                          expectedHash: expectedHash, preparedHash: preparedHash, resolution: nil)
        entry.kind = kind
        entry.userDeletion = userDeletion ? true : nil
        guard kind == nil || kind == "removal" else { throw Failure.invalidRegistry }
        if workspaceStaging { entry.recoveryPath = ".texttext/retained-replacements/" + digest(Data(path.utf8)) + "/" + (path as NSString).lastPathComponent }
        guard !itemId.isEmpty, itemId.utf8.count <= 256, validHash(expectedHash), validHash(preparedHash) else { throw Failure.invalidRegistry }
        _ = try target(entry)
        try save(entry, creating: true)
    }
    private func recovery(_ entry: Entry, persistRelocation: Bool = true, validatedTarget: URL? = nil, layout: RetainedFileReplacement.Layout? = nil) throws -> RetainedFileReplacement.Recovery {
        let originalTarget = try validatedTarget ?? target(entry)
        let directPath = layout.map { $0.basePath + "/" + entry.operation.uuidString } ?? RetainedFileReplacement.operationDirectory(target: originalTarget, operation: entry.operation).path
        let recovery: RetainedFileReplacement.Recovery
        if FileManager.default.fileExists(atPath: directPath) {
            recovery = try RetainedFileReplacement.recovery(target: originalTarget, operation: entry.operation, layout: layout)
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
              recovery.record.preparedHash == entry.preparedHash, recovery.record.kind == entry.kind else { throw Failure.unresolved(entry.operation) }
        return recovery
    }
    private func visibleClassificationTarget(_ entry: Entry, _ retained: RetainedFileReplacement.Recovery) -> URL {
        usesWorkspaceStaging(entry) ? root.appendingPathComponent(entry.path) : classificationTarget(retained)
    }
    private func classificationTarget(_ recovery: RetainedFileReplacement.Recovery) -> URL {
        recovery.directory.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(recovery.record.filename)
    }
    func inspect(_ entry: Entry, persistRelocation: Bool = true) throws -> Inspection {
        let recovery = try recovery(entry, persistRelocation: persistRelocation)
        let prepared = try StableFileSnapshot.read(recovery.prepared)
        guard digest(prepared) == entry.preparedHash else { throw Failure.invalidRegistry }
        return Inspection(entry: entry, recovery: recovery, prepared: prepared,
                          displaced: try StableFileSnapshot.read(recovery.displaced))
    }
    func removalHasCapturedInode(_ entry: Entry) throws -> Bool {
        let retained = try recovery(entry, persistRelocation: false)
        var info = stat()
        if lstat(retained.displaced.path, &info) != 0 {
            guard errno == ENOENT else { throw Failure.invalidRegistry }
            return false
        }
        return true
    }
    /// Recovery listing must not publish classification or acknowledgements.
    /// Exact retained bytes are inspected without updating relocated paths.
    func isReadableWithoutMutation(_ entry: Entry) throws -> Bool {
        let retained = try recovery(entry, persistRelocation: false)
        let prepared = digest(try StableFileSnapshot.read(retained.prepared))
        if retained.record.state == .cancelled { return entry.kind == "removal" && prepared == entry.preparedHash }
        if entry.kind == "removal", retained.record.state == .pending {
            var info = stat()
            if lstat(retained.displaced.path, &info) != 0, errno == ENOENT {
                return try visibleMatches(visibleClassificationTarget(entry, retained), hash: entry.expectedHash, present: true)
            }
        }
        let displaced = digest(try StableFileSnapshot.read(retained.displaced))
        guard prepared == entry.preparedHash else { throw Failure.invalidRegistry }
        if let resolution = entry.resolution {
            return prepared == resolution.preparedHash && displaced == resolution.displacedHash
        }
        guard retained.record.state != .conflict else { return false }
        let expected = retained.record.acknowledgedDisplacedHash ?? entry.expectedHash
        guard displaced == expected else { return false }
        if retained.record.state == .completed { return true }
        if entry.kind == "removal" { return try visibleMatches(visibleClassificationTarget(entry, retained), hash: nil, present: false) }
        return digest(try StableFileSnapshot.read(visibleClassificationTarget(entry, retained))) == entry.preparedHash
    }
    private func restoreDeletionMarker(_ entry: Entry, _ retained: RetainedFileReplacement.Recovery) throws {
        guard entry.kind == "removal", entry.userDeletion == true, entry.deletionMarkerPublished != true, entry.deletionIntentCancelled != true else { return }
        let visible = root.appendingPathComponent(entry.path)
        let restored: Bool
        if let _ = try? StableFileSnapshot.read(visible) { restored = true }
        else {
            let store = LocalVaultDocumentStore(root: root)
            let paths = try store.list()
            guard paths.count <= 20_000 else { throw Failure.invalidRegistry }
            var matches = 0
            for path in paths where path != entry.path {
                guard let bytes = try? StableFileSnapshot.read(store.url(for: path)),
                      let document = try? store.parseDocument(path: path, bytes: bytes, preserveHistory: false) else { continue }
                if MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId { matches += 1 }
            }
            guard matches <= 1 else { throw Failure.invalidRegistry }
            restored = matches == 1
        }
        if restored {
            try LocalVaultDeviceState.withDeletionPublication {
                guard var latest = try entries(itemId: entry.itemId).first(where: { $0.operation == entry.operation }),
                      latest.deletionMarkerPublished != true, latest.deletionIntentCancelled != true else { return }
                latest.deletionIntentCancelled = true
                try save(latest, creating: false)
                if try LocalVaultDeviceState.hasDeletion(root: root, itemId: entry.itemId, path: entry.path, hash: entry.expectedHash),
                   let snapshot = try LocalVaultDeviceState.deletionSnapshot(root: root, itemId: entry.itemId) {
                    try LocalVaultDeviceState.clearDeletion(root: root, itemId: entry.itemId, matching: snapshot)
                }
            }
            return
        }
        guard try visibleMatches(visible, hash: nil, present: false) else { return }
        if let resolution = entry.resolution {
            guard resolution.currentPresent == false, resolution.visibleHash == nil else { return }
        } else { guard retained.record.state == .completed else { return } }
        try LocalVaultDeviceState.withDeletionPublication {
            // Re-read under the same lock used by ACK consumption. Another
            // normal reader may already have completed this publication.
            guard let latest = try entries(itemId: entry.itemId).first(where: { $0.operation == entry.operation }), latest.deletionMarkerPublished != true, latest.deletionIntentCancelled != true else { return }
            guard try visibleMatches(visible, hash: nil, present: false) else { return }
            let inspection = try inspect(latest)
            let trash = root.appendingPathComponent(".texttext/trash", isDirectory: true)
            try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
            guard trash.resolvingSymlinksInPath().path == trash.path else { throw Failure.invalidRegistry }
            for bytes in [inspection.prepared, inspection.displaced] {
                let versionHash = digest(bytes)
                let saved = trash.appendingPathComponent(entry.operation.uuidString + "-" + versionHash + ".textpack")
                if FileManager.default.fileExists(atPath: saved.path) {
                    guard try StableFileSnapshot.read(saved) == bytes else { throw Failure.observedVersionChanged }
                } else { try RetainedFileReplacement.create(bytes, at: saved) }
            }
            try RetainedFileReplacement.flushDirectory(trash)
            try RetainedFileReplacement.flushDirectory(trash.deletingLastPathComponent())
            // Export does not entitle a later writer to stale consent.
            let verified = try inspect(latest)
            guard verified.preparedHash == inspection.preparedHash, verified.displacedHash == inspection.displacedHash,
                  try visibleMatches(visible, hash: nil, present: false) else { throw Failure.observedVersionChanged }
            try LocalVaultDeviceState.recordDeletion(root: root, itemId: entry.itemId, path: entry.path, hash: entry.expectedHash)
            var recorded = latest
            recorded.deletionMarkerPublished = true
            try save(recorded, creating: false)
        }
    }
    /// Nil identity means a malformed/unidentified projection. Fail closed for
    /// any unresolved workspace entry instead of accepting a renamed candidate.
    func assertReadable(itemId: String?) throws {
        var validatedTargets: [String: (URL, RetainedFileReplacement.Layout?)] = [:]
        for entry in try entries(itemId: itemId) {
            let key = entry.path + "\0" + (entry.recoveryPath ?? entry.path)
            let location: (URL, RetainedFileReplacement.Layout?)
            if let existing = validatedTargets[key] { location = existing }
            else {
                let target = try target(entry)
                location = (target, FileManager.default.fileExists(atPath: target.deletingLastPathComponent().path) ? try RetainedFileReplacement.layout(target: target) : nil)
                validatedTargets[key] = location
            }
            let retained = try recovery(entry, validatedTarget: location.0, layout: location.1)
            if let resolution = entry.resolution {
                if resolution.preparedFingerprint == (try? RetainedFileReplacement.fingerprint(retained.prepared)),
                   resolution.preparedFingerprint != nil,
                   resolution.displacedFingerprint == (try? RetainedFileReplacement.fingerprint(retained.displaced)),
                   resolution.displacedFingerprint != nil {
                    if retained.record.state != .completed || retained.record.acknowledgedDisplacedHash != resolution.displacedHash {
                        try RetainedFileReplacement.acknowledge(retained, preparedHash: resolution.preparedHash, displacedHash: resolution.displacedHash)
                    }
                    try restoreDeletionMarker(entry, retained)
                    continue
                }
                let inspection = try inspect(entry)
                guard inspection.preparedHash == resolution.preparedHash,
                      inspection.displacedHash == resolution.displacedHash else { throw Failure.unresolved(entry.operation) }
                try RetainedFileReplacement.acknowledge(retained, preparedHash: resolution.preparedHash, displacedHash: resolution.displacedHash)
                try restoreDeletionMarker(entry, retained)
                continue
            }
            let classified = try RetainedFileReplacement.classify(retained, target: visibleClassificationTarget(entry, retained))
            guard classified.record.state == .completed || classified.record.state == .cancelled else { throw Failure.unresolved(entry.operation) }
            try restoreDeletionMarker(entry, classified)
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
    private func visibleMatches(_ visible: URL, hash: String?, present: Bool) throws -> Bool {
        var info = stat()
        if lstat(visible.path, &info) != 0 {
            guard errno == ENOENT else { throw Failure.invalidRegistry }
            return !present && hash == nil
        }
        guard present, info.st_mode & S_IFMT == S_IFREG, let hash else { return false }
        return digest(try StableFileSnapshot.read(visible)) == hash
    }
    /// Explicit user acknowledgement retains both snapshots and never changes
    /// the visible projection. A later old-descriptor write reopens the fence.
    func resolve(operation: UUID, visible: URL, itemId: String, observed: Resolution, observe: ((String) throws -> Void)? = nil) throws {
        guard let physicalRoot else { throw Failure.invalidRegistry }
        var parentURL = visible.deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: parentURL.path), parentURL.path != root.path { parentURL.deleteLastPathComponent() }
        guard let parent = realpath(parentURL.path, nil) else { throw Failure.invalidRegistry }
        defer { free(parent) }
        let actualParent = String(cString: parent)
        guard actualParent == physicalRoot || actualParent.hasPrefix(physicalRoot + "/") else { throw Failure.invalidRegistry }
        guard var entry = try entries().first(where: { $0.operation == operation }), entry.itemId == itemId else { throw Failure.invalidRegistry }
        let first = try inspect(entry)
        guard first.preparedHash == observed.preparedHash, first.displacedHash == observed.displacedHash,
              try visibleMatches(visible, hash: observed.visibleHash, present: observed.currentPresent ?? true) else { throw Failure.observedVersionChanged }
        _ = try export(first)
        let preparedStamp = try RetainedFileReplacement.fingerprint(first.recovery.prepared)
        let displacedStamp = try RetainedFileReplacement.fingerprint(first.recovery.displaced)
        let latest = try inspect(entry)
        guard latest.preparedHash == observed.preparedHash, latest.displacedHash == observed.displacedHash,
              preparedStamp == (try RetainedFileReplacement.fingerprint(first.recovery.prepared)),
              displacedStamp == (try RetainedFileReplacement.fingerprint(first.recovery.displaced)),
              try visibleMatches(visible, hash: observed.visibleHash, present: observed.currentPresent ?? true) else { throw Failure.observedVersionChanged }
        var acknowledged = observed
        acknowledged.preparedFingerprint = preparedStamp
        acknowledged.displacedFingerprint = displacedStamp
        entry.resolution = acknowledged
        try save(entry, creating: false)
        try observe?("resolutionPreserved")
        try RetainedFileReplacement.acknowledge(latest.recovery, preparedHash: observed.preparedHash, displacedHash: observed.displacedHash)
        try restoreDeletionMarker(entry, latest.recovery)
    }
}
