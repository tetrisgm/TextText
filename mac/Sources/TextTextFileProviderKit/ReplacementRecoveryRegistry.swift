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
              Set(fields.keys).isSubset(of: Set(["version", "operation", "workspaceRootHash", "ownerHash", "itemId", "path", "expectedHash", "preparedHash", "recoveryPath", "resolution", "kind", "userDeletion", "deletionMarkerPublished", "deletionIntentCancelled", "explicitCancellation", "supersededBy", "destinationPath", "moveResolution", "caseOnly", "identityMode"])) else { throw Failure.invalidRegistry }
        if let value = fields["moveResolution"], !(value is NSNull) {
            guard let receipt = value as? [String: Any], Set(receipt.keys).isSubset(of: Set(["preparedHash", "displacedHash", "captured", "currentHash", "currentPresent", "sourceHash", "sourcePresent"])) else { throw Failure.invalidRegistry }
        }
        if let value = fields["explicitCancellation"], !(value is NSNull) {
            guard let receipt = value as? [String: Any], Set(receipt.keys).isSubset(of: Set(["preparedHash", "currentHash", "currentPresent"])) else { throw Failure.invalidRegistry }
        }
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
        var explicitCancellation: ExplicitCancellation? = nil
        var supersededBy: UUID? = nil
        var identityMode: String? = nil
        var caseOnly: Bool? = nil
        var destinationPath: String? = nil
        var moveResolution: MoveResolution? = nil
    }
    struct MoveResolution: Codable, Equatable {
        let preparedHash: String
        let displacedHash: String?
        let captured: Bool
        let currentHash: String?
        let currentPresent: Bool
        let sourceHash: String?
        let sourcePresent: Bool
    }
    struct ExplicitCancellation: Codable, Equatable {
        let preparedHash: String
        let currentHash: String?
        let currentPresent: Bool
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
    private func validIdentity(_ entry: Entry) -> Bool {
        if entry.identityMode == "path" {
            return entry.itemId.isEmpty && entry.kind == nil && entry.userDeletion != true && entry.caseOnly != true
        }
        return entry.identityMode == nil && !entry.itemId.isEmpty && entry.itemId.utf8.count <= 256
    }
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
        guard entry.version == 1, (entry.kind == nil || entry.kind == "removal" || entry.kind == "move"), entry.workspaceRootHash == registry.digest(Data(registry.root.path.utf8)),
              owner.rootHash == entry.workspaceRootHash, registry.validIdentity(entry),
              entry.operation.uuidString + ".json" == (path as NSString).lastPathComponent,
              registry.validHash(entry.expectedHash), registry.validHash(entry.preparedHash) else { throw Failure.invalidRegistry }
        guard entry.userDeletion != true || entry.kind == "removal",
              entry.deletionMarkerPublished != true || (entry.kind == "removal" && entry.userDeletion == true),
              entry.deletionIntentCancelled != true || (entry.kind == "removal" && entry.userDeletion == true),
              entry.supersededBy == nil || (entry.kind == "removal" && entry.userDeletion == true && entry.deletionIntentCancelled == true && entry.supersededBy != entry.operation),
              (entry.kind != "removal" && entry.kind != "move") || entry.expectedHash == entry.preparedHash else { throw Failure.invalidRegistry }
        if let receipt = entry.explicitCancellation {
            guard entry.kind == "removal", entry.deletionIntentCancelled == true, entry.resolution == nil,
                  receipt.preparedHash == entry.preparedHash,
                  (receipt.currentPresent ? receipt.currentHash.map(registry.validHash) == true : receipt.currentHash == nil) else { throw Failure.invalidRegistry }
        }
        _ = try registry.target(entry)
        try registry.validateMove(entry)
        guard entry.ownerHash == registry.digest(Data("unowned-local-workspace".utf8)) || entry.ownerHash == principal else { throw LocalVaultAccountRootOwnership.Failure.account }
        if entry.ownerHash == principal { return (original, false) }
        let retained = try registry.recovery(entry, persistRelocation: false)
        guard retained.record.expectedHash == entry.expectedHash, retained.record.preparedHash == entry.preparedHash else { throw Failure.invalidRegistry }
        entry.ownerHash = principal
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return (try encoder.encode(entry), true)
    }
    func captureLease(operation: UUID) -> URL {
        LocalVaultDeviceState.directory(root: root).appendingPathComponent("replacement-capture-leases/" + operation.uuidString + ".lock")
    }
    func recoveryRoot(path: String) -> URL {
        root.appendingPathComponent(".texttext/retained-replacements/" + digest(Data(path.utf8)), isDirectory: true)
    }
    func moveDestination(_ entry: Entry) throws -> URL {
        guard entry.kind == "move", let path = entry.destinationPath, path != entry.path else { throw Failure.invalidRegistry }
        let visible = Entry(version: entry.version, operation: entry.operation, workspaceRootHash: entry.workspaceRootHash, ownerHash: entry.ownerHash,
            itemId: entry.itemId, path: path, expectedHash: entry.expectedHash, preparedHash: entry.preparedHash, resolution: nil)
        return try target(visible)
    }
    private func validateMove(_ entry: Entry) throws {
        guard entry.caseOnly != true || entry.kind == "move" else { throw Failure.invalidRegistry }
        if entry.kind == "move" {
            _ = try moveDestination(entry)
            if entry.caseOnly == true {
                guard let destination = entry.destinationPath,
                      (entry.path as NSString).deletingLastPathComponent == (destination as NSString).deletingLastPathComponent,
                      (entry.path as NSString).lastPathComponent != (destination as NSString).lastPathComponent,
                      (entry.path as NSString).lastPathComponent.lowercased() == (destination as NSString).lastPathComponent.lowercased() else { throw Failure.invalidRegistry }
            }
        }
        else { guard entry.destinationPath == nil, entry.moveResolution == nil else { throw Failure.invalidRegistry } }
        if let receipt = entry.moveResolution {
            guard entry.kind == "move", receipt.preparedHash == entry.preparedHash, entry.resolution == nil, entry.explicitCancellation == nil,
                  receipt.captured ? receipt.displacedHash.map(validHash) == true : receipt.displacedHash == nil,
                  receipt.currentPresent ? receipt.currentHash.map(validHash) == true : receipt.currentHash == nil,
                  receipt.sourcePresent ? receipt.sourceHash.map(validHash) == true : receipt.sourceHash == nil else { throw Failure.invalidRegistry }
        }
    }
    private func usesWorkspaceStaging(_ entry: Entry) -> Bool {
        let prefix = ".texttext/retained-replacements/" + digest(Data(entry.path.utf8)) + "/"
        guard let path = entry.recoveryPath, path.hasPrefix(prefix) else { return false }
        let leaf = String(path.dropFirst(prefix.count))
        return !leaf.isEmpty && !leaf.contains("/") && !leaf.contains("\\") &&
            leaf.lowercased() == (entry.path as NSString).lastPathComponent.lowercased()
    }
    private func target(_ entry: Entry) throws -> URL {
        let path = entry.recoveryPath ?? entry.path
        let visibleParts = entry.path.split(separator: "/", omittingEmptySubsequences: false)
        guard !visibleParts.isEmpty, entry.path.utf8.count <= 4096,
              entry.path.utf8.allSatisfy({ $0 >= 32 && $0 != 127 }),
              visibleParts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") }),
              entry.path.lowercased().hasSuffix(".textpack") else { throw Failure.invalidRegistry }
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
              path.lowercased().hasSuffix(".textpack") else { throw Failure.invalidRegistry }
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
    private func indexedPaths(itemId: String?, path: String?) throws -> [URL] {
        func selected(_ index: [String: [URL]]) -> [URL] {
            guard let itemId else { return index.filter { $0.key.hasPrefix("id:") || $0.key == "path-mode" }.values.flatMap { $0 } }
            var selected = index["id:" + itemId] ?? []
            // An ID-only ACK cannot prove it is unrelated to an unidentified
            // file. Verify retained path-mode history before allowing it.
            if path == nil { selected += index["path-mode"] ?? [] }
            if let path { selected += index["path:" + path] ?? [] }
            var seen = Set<String>()
            return selected.filter { seen.insert($0.path).inserted }
        }
        for _ in 0..<3 {
            let generation = try directoryFingerprint()
            Self.cache.lock.lock()
            let cached = Self.cache.indexes[directory.path]
            Self.cache.lock.unlock()
            if let cached, cached.0 == generation {
                return selected(cached.1)
            }
            let paths = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { !$0.lastPathComponent.hasPrefix(".") }
            var index: [String: [URL]] = [:]
            for file in paths {
                // Private records are published atomically. Identity extraction
                // does not accept the record: selected records still undergo
                // exact fingerprint/schema/principal checks below.
                let bytes = try StableFileSnapshot.read(file, maximumBytes: 8192)
                guard let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                      let identity = fields["itemId"] as? String, identity.utf8.count <= 256,
                      !identity.isEmpty || fields["identityMode"] as? String == "path" else { throw Failure.invalidRegistry }
                if fields["identityMode"] as? String == "path" {
                    guard let originalPath = fields["path"] as? String else { throw Failure.invalidRegistry }
                    index["path-mode", default: []].append(file)
                    index["path:" + originalPath, default: []].append(file)
                } else { index["id:" + identity, default: []].append(file) }
                if fields["kind"] as? String == "move", let source = fields["path"] as? String, let destination = fields["destinationPath"] as? String {
                    index["path:" + source, default: []].append(file)
                    index["path:" + destination, default: []].append(file)
                }
            }
            guard generation == (try directoryFingerprint()) else { continue }
            Self.cache.lock.lock()
            if Self.cache.indexes.count >= 32 { Self.cache.indexes.removeAll(keepingCapacity: true) }
            Self.cache.indexes[directory.path] = (generation, index)
            Self.cache.lock.unlock()
            return selected(index)
        }
        throw Failure.invalidRegistry
    }
    private func directoryFingerprint() throws -> String {
        var info = stat()
        guard lstat(directory.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw Failure.invalidRegistry }
        return "\(info.st_dev):\(info.st_ino):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec):\(info.st_ctimespec.tv_sec):\(info.st_ctimespec.tv_nsec)"
    }
    func entries(itemId: String? = nil, path: String? = nil) throws -> [Entry] {
        // An already-open store must also refuse an interrupted owner/profile
        // publication, even before its first document replacement is indexed.
        let principalHash = try ownerHash()
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalidRegistry }
        let paths = try indexedPaths(itemId: itemId, path: path)
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
            guard (itemId == nil || entry.itemId == itemId || (entry.identityMode == "path" && path == nil) || ((entry.kind == "move" || entry.identityMode == "path") && (entry.path == path || entry.destinationPath == path))), entry.version == 1, (entry.kind == nil || entry.kind == "removal" || entry.kind == "move"), entry.operation.uuidString + ".json" == file.lastPathComponent,
                  entry.workspaceRootHash == rootHash,
                  entry.ownerHash == principalHash,
                  validIdentity(entry),
                  validHash(entry.expectedHash), validHash(entry.preparedHash) else { throw Failure.invalidRegistry }
            guard entry.userDeletion != true || entry.kind == "removal",
                  entry.deletionMarkerPublished != true || (entry.kind == "removal" && entry.userDeletion == true),
                  entry.deletionIntentCancelled != true || (entry.kind == "removal" && entry.userDeletion == true),
                  entry.supersededBy == nil || (entry.kind == "removal" && entry.userDeletion == true && entry.deletionIntentCancelled == true && entry.supersededBy != entry.operation),
                  (entry.kind != "removal" && entry.kind != "move") || entry.expectedHash == entry.preparedHash else { throw Failure.invalidRegistry }
            if validatedTargets.insert(entry.path + "\0" + (entry.recoveryPath ?? entry.path)).inserted { _ = try target(entry) }
            try validateMove(entry)
            if let receipt = entry.explicitCancellation {
                guard entry.kind == "removal", entry.deletionIntentCancelled == true, entry.resolution == nil,
                      receipt.preparedHash == entry.preparedHash,
                      (receipt.currentPresent ? receipt.currentHash.map(validHash) == true : receipt.currentHash == nil) else { throw Failure.invalidRegistry }
            }
            if let resolution = entry.resolution {
                guard (resolution.currentPresent != false || entry.kind == "removal" || entry.identityMode == "path"), ((resolution.currentPresent ?? true) ? resolution.visibleHash.map(validHash) == true : resolution.visibleHash == nil), validHash(resolution.preparedHash), validHash(resolution.displacedHash) else { throw Failure.invalidRegistry }
            }
            return entry
        }
    }
    /// Must be durable before invoking the replacement primitive. Even failure
    /// before staging remains a visible refusal, never a silent replay success.
    func register(operation: UUID, itemId: String, path: String, expectedHash: String, preparedHash: String, workspaceStaging: Bool = false, kind: String? = nil, userDeletion: Bool = false, destinationPath: String? = nil, caseOnly: Bool = false, storageFilename: String? = nil, identityMode: String? = nil) throws {
        var entry = Entry(version: 1, operation: operation, workspaceRootHash: digest(Data(root.path.utf8)), ownerHash: try ownerHash(), itemId: itemId, path: path,
                          expectedHash: expectedHash, preparedHash: preparedHash, resolution: nil)
        entry.kind = kind
        entry.identityMode = identityMode
        entry.destinationPath = destinationPath
        entry.caseOnly = caseOnly ? true : nil
        try validateMove(entry)
        entry.userDeletion = userDeletion ? true : nil
        guard kind == nil || kind == "removal" || kind == "move" else { throw Failure.invalidRegistry }
        if workspaceStaging {
            entry.recoveryPath = ".texttext/retained-replacements/" + digest(Data(path.utf8)) + "/" + (storageFilename ?? (path as NSString).lastPathComponent)
            guard usesWorkspaceStaging(entry) else { throw Failure.invalidRegistry }
        }
        guard validIdentity(entry), validHash(expectedHash), validHash(preparedHash) else { throw Failure.invalidRegistry }
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
              recovery.record.preparedHash == entry.preparedHash, recovery.record.kind == entry.kind, recovery.record.caseOnly == entry.caseOnly else { throw Failure.unresolved(entry.operation) }
        return recovery
    }
    private func visibleClassificationTarget(_ entry: Entry, _ retained: RetainedFileReplacement.Recovery) -> URL {
        usesWorkspaceStaging(entry) ? root.appendingPathComponent(entry.path).deletingLastPathComponent().appendingPathComponent(retained.record.filename) : classificationTarget(retained)
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
    func inspectUncaptured(_ entry: Entry) throws -> (recovery: RetainedFileReplacement.Recovery, prepared: Data) {
        let retained = try recovery(entry, persistRelocation: false)
        guard entry.kind == "removal" || entry.kind == "move", retained.record.state == .pending || retained.record.state == .cancelled || (entry.kind == "move" && retained.record.state == .conflict) else { throw Failure.invalidRegistry }
        var info = stat()
        guard lstat(retained.displaced.path, &info) != 0, errno == ENOENT else { throw Failure.invalidRegistry }
        let prepared = try StableFileSnapshot.read(retained.prepared)
        guard digest(prepared) == entry.preparedHash else { throw Failure.invalidRegistry }
        return (retained, prepared)
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
        if retained.record.state == .cancelled { return (entry.kind == "removal" || entry.kind == "move") && prepared == entry.preparedHash }
        if entry.kind == "move", let receipt = entry.moveResolution {
            guard prepared == receipt.preparedHash else { return false }
            if let expected = receipt.displacedHash { return digest(try StableFileSnapshot.read(retained.displaced)) == expected }
            return try !removalHasCapturedInode(entry)
        }
        if entry.kind == "move", retained.record.state == .pending { return false }
        if entry.kind == "removal", retained.record.state == .pending {
            var info = stat()
            if lstat(retained.displaced.path, &info) != 0, errno == ENOENT {
                if entry.explicitCancellation != nil { return true }
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
    private func cancelRenamedUncaptured(_ entry: Entry, _ retained: RetainedFileReplacement.Recovery) throws -> RetainedFileReplacement.Recovery? {
        guard entry.kind == "removal", retained.record.state == .pending else { return nil }
        var info = stat()
        guard lstat(retained.displaced.path, &info) != 0, errno == ENOENT else { return nil }
        let original = root.appendingPathComponent(entry.path)
        var parent = root
        for part in entry.path.split(separator: "/").dropLast() {
            parent.appendPathComponent(String(part))
            if lstat(parent.path, &info) != 0 {
                guard errno == ENOENT else { throw Failure.invalidRegistry }
                break
            }
            guard info.st_mode & S_IFMT == S_IFDIR else { throw Failure.invalidRegistry }
        }
        // A different recreated original file is ambiguous even when expected
        // content is found elsewhere. Never substitute that other pathname.
        guard lstat(original.path, &info) != 0, errno == ENOENT else { return nil }
        let store = LocalVaultDocumentStore(root: root)
        let paths = try store.list()
        guard paths.count < 20_000 else { throw Failure.invalidRegistry }
        var candidate: URL?
        for path in paths {
            var visible = root
            let parts = path.split(separator: "/")
            for (index, part) in parts.enumerated() {
                visible.appendPathComponent(String(part))
                guard lstat(visible.path, &info) == 0,
                      info.st_mode & S_IFMT == (index == parts.count - 1 ? S_IFREG : S_IFDIR) else { throw Failure.invalidRegistry }
            }
            let bytes = try StableFileSnapshot.read(visible)
            let document = try store.parseDocument(path: path, bytes: bytes, preserveHistory: false)
            guard MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId else { continue }
            guard candidate == nil, digest(bytes) == entry.expectedHash else { throw Failure.unresolved(entry.operation) }
            candidate = visible
        }
        guard let candidate else { return nil }
        guard lstat(original.path, &info) != 0, errno == ENOENT else { throw Failure.unresolved(entry.operation) }
        return try RetainedFileRemoval.cancelUncaptured(retained, preservedAt: candidate)
    }
    /// Called by every operation-bound marker consumption path before unlink.
    /// This receipt closes marker-write/crash/other-process-ACK/restart replay.
    func acknowledgeDeletionPublication(operation: UUID, itemId: String, path: String, hash: String) throws {
        guard var entry = try entries(itemId: itemId).first(where: { $0.operation == operation }),
              entry.kind == "removal", entry.userDeletion == true, entry.path == path,
              entry.expectedHash == hash else { throw Failure.invalidRegistry }
        let retained = try recovery(entry)
        guard retained.record.state == .completed, try isReadableWithoutMutation(entry) else { throw Failure.invalidRegistry }
        if entry.deletionMarkerPublished == true { return }
        entry.deletionMarkerPublished = true
        try save(entry, creating: false)
    }
    private func removalWasRestored(_ entry: Entry) throws -> Bool {
        let visible = root.appendingPathComponent(entry.path)
        if let _ = try? StableFileSnapshot.read(visible) { return true }
        else {
            let store = LocalVaultDocumentStore(root: root)
            let paths = try store.list()
            guard paths.count < 20_000 else { throw Failure.invalidRegistry }
            var matches = 0
            for path in paths where path != entry.path {
                guard let bytes = try? StableFileSnapshot.read(store.url(for: path)),
                      let document = try? store.parseDocument(path: path, bytes: bytes, preserveHistory: false) else { continue }
                if MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId { matches += 1 }
            }
            guard matches <= 1 else { throw Failure.invalidRegistry }
            return matches == 1
        }
    }
    private func restoreDeletionMarker(_ entry: Entry, _ retained: RetainedFileReplacement.Recovery, observe: ((String) throws -> Void)? = nil) throws {
        guard entry.kind == "removal", entry.userDeletion == true, entry.deletionMarkerPublished != true, entry.deletionIntentCancelled != true else { return }
        let visible = root.appendingPathComponent(entry.path)
        let restored = try removalWasRestored(entry)
        if restored {
            try observe?("restorationObserved")
            try LocalVaultDeviceState.withDeletionPublication {
                guard var latest = try entries(itemId: entry.itemId).first(where: { $0.operation == entry.operation }),
                      latest.deletionMarkerPublished != true, latest.deletionIntentCancelled != true,
                      try removalWasRestored(latest) else { return }
                latest.deletionIntentCancelled = true
                try save(latest, creating: false)
                try LocalVaultDeviceState.clearDeletion(root: root, itemId: entry.itemId, operation: entry.operation,
                    path: entry.path, hash: entry.expectedHash)
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
            if let bound = try LocalVaultDeviceState.boundDeletion(root: root, itemId: entry.itemId), bound.operation != entry.operation {
                guard let other = try entries(itemId: entry.itemId).first(where: { $0.operation == bound.operation }),
                      other.kind == "removal", other.userDeletion == true, other.path == bound.path, other.expectedHash == bound.hash,
                      other.deletionMarkerPublished == true,
                      try visibleMatches(root.appendingPathComponent(other.path), hash: nil, present: false) else { throw Failure.invalidRegistry }
                let proof = try recovery(other)
                guard proof.record.state == .completed,
                      try isReadableWithoutMutation(other) else { throw Failure.invalidRegistry }
                var superseded = latest
                superseded.deletionIntentCancelled = true
                superseded.supersededBy = other.operation
                try save(superseded, creating: false)
                return
            }
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
            try LocalVaultDeviceState.recordDeletion(root: root, itemId: entry.itemId, path: entry.path, hash: entry.expectedHash, operationId: entry.operation)
            try observe?("markerWritten")
            var recorded = latest
            recorded.deletionMarkerPublished = true
            try save(recorded, creating: false)
        }
    }
    /// Path-only preflight precedes NSFileCoordinator to refuse an active move
    /// without waiting reentrantly on its coordinated source/destination writer.
    func assertPathReadable(_ path: String) throws {
        try assertReadable(itemId: "", path: path)
    }
    /// Nil identity means a malformed/unidentified projection. Fail closed for
    /// any unresolved workspace entry instead of accepting a renamed candidate.
    func assertReadable(itemId: String?, path: String? = nil, observeDeletionPublication: ((String) throws -> Void)? = nil) throws {
        var validatedTargets: [String: (URL, RetainedFileReplacement.Layout?)] = [:]
        for entry in try entries(itemId: itemId, path: path) {
            let key = entry.path + "\0" + (entry.recoveryPath ?? entry.path)
            let location: (URL, RetainedFileReplacement.Layout?)
            if let existing = validatedTargets[key] { location = existing }
            else {
                let target = try target(entry)
                location = (target, FileManager.default.fileExists(atPath: target.deletingLastPathComponent().path) ? try RetainedFileReplacement.layout(target: target) : nil)
                validatedTargets[key] = location
            }
            let retained = try recovery(entry, validatedTarget: location.0, layout: location.1)
            if entry.kind == "move" {
                try RetainedFileRemoval.withLease(at: captureLease(operation: entry.operation)) {
                    let fresh = try recovery(entry, validatedTarget: location.0, layout: location.1)
                    if let receipt = entry.moveResolution {
                        let prepared = digest(try StableFileSnapshot.read(fresh.prepared))
                        guard prepared == receipt.preparedHash else { throw Failure.invalidRegistry }
                        if let expected = receipt.displacedHash {
                            guard digest(try StableFileSnapshot.read(fresh.displaced)) == expected else { throw Failure.unresolved(entry.operation) }
                        } else { _ = try inspectUncaptured(entry) }
                        if fresh.record.state != (receipt.captured ? .completed : .cancelled) || (receipt.captured && fresh.record.acknowledgedDisplacedHash != receipt.displacedHash) {
                            try RetainedFileMove.acceptCurrentState(fresh, displacedHash: receipt.displacedHash)
                        }
                    } else {
                        let classified = try RetainedFileMove.classify(fresh, source: root.appendingPathComponent(entry.path), destination: moveDestination(entry))
                        guard classified.record.state == .completed || classified.record.state == .cancelled else { throw Failure.unresolved(entry.operation) }
                    }
                }
                continue
            }
            if let resolution = entry.resolution {
                if resolution.preparedFingerprint == (try? RetainedFileReplacement.fingerprint(retained.prepared)),
                   resolution.preparedFingerprint != nil,
                   resolution.displacedFingerprint == (try? RetainedFileReplacement.fingerprint(retained.displaced)),
                   resolution.displacedFingerprint != nil {
                    if retained.record.state != .completed || retained.record.acknowledgedDisplacedHash != resolution.displacedHash {
                        try RetainedFileReplacement.acknowledge(retained, preparedHash: resolution.preparedHash, displacedHash: resolution.displacedHash)
                    }
                    try restoreDeletionMarker(entry, retained, observe: observeDeletionPublication)
                    continue
                }
                let inspection = try inspect(entry)
                guard inspection.preparedHash == resolution.preparedHash,
                      inspection.displacedHash == resolution.displacedHash else { throw Failure.unresolved(entry.operation) }
                try RetainedFileReplacement.acknowledge(retained, preparedHash: resolution.preparedHash, displacedHash: resolution.displacedHash)
                try restoreDeletionMarker(entry, retained, observe: observeDeletionPublication)
                continue
            }
            let classified: RetainedFileReplacement.Recovery
            if entry.kind == "removal", retained.record.state == .pending {
                classified = try RetainedFileRemoval.withLease(at: captureLease(operation: entry.operation)) {
                    let fresh = try recovery(entry, validatedTarget: location.0, layout: location.1)
                    if entry.explicitCancellation != nil {
                        _ = try inspectUncaptured(entry)
                        return try RetainedFileRemoval.cancelAfterInspection(fresh)
                    }
                    return try cancelRenamedUncaptured(entry, fresh) ?? RetainedFileReplacement.classify(fresh, target: visibleClassificationTarget(entry, fresh))
                }
            } else { classified = try RetainedFileReplacement.classify(retained, target: visibleClassificationTarget(entry, retained)) }
            guard classified.record.state == .completed || classified.record.state == .cancelled else { throw Failure.unresolved(entry.operation) }
            try restoreDeletionMarker(entry, classified, observe: observeDeletionPublication)
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
    func cancelUncaptured(operation: UUID, itemId: String, path: String, preparedHash: String,
                          current: Data?, validateCurrent: () throws -> Void,
                          beforeAcknowledge: (() throws -> Void)? = nil) throws {
        try RetainedFileRemoval.withLease(at: captureLease(operation: operation)) {
            guard var entry = try entries(itemId: itemId).first(where: { $0.operation == operation }),
                  entry.kind == "removal", entry.path == path, entry.preparedHash == preparedHash else { throw Failure.invalidRegistry }
            let inspection = try inspectUncaptured(entry)
            try validateCurrent()
            let folder = root.appendingPathComponent(".texttext/conflicts/" + operation.uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            guard folder.resolvingSymlinksInPath().path == folder.path else { throw Failure.invalidRegistry }
            for bytes in [inspection.prepared] + (current.map { [$0] } ?? []) {
                let copy = folder.appendingPathComponent(digest(bytes) + ".textpack")
                if FileManager.default.fileExists(atPath: copy.path) {
                    guard try StableFileSnapshot.read(copy) == bytes else { throw Failure.observedVersionChanged }
                } else { try RetainedFileReplacement.create(bytes, at: copy) }
            }
            try RetainedFileReplacement.flushDirectory(folder)
            try RetainedFileReplacement.flushDirectory(folder.deletingLastPathComponent())
            _ = try inspectUncaptured(entry)
            try validateCurrent()
            try beforeAcknowledge?()
            entry.explicitCancellation = .init(preparedHash: preparedHash, currentHash: current.map(digest), currentPresent: current != nil)
            entry.deletionIntentCancelled = true
            try save(entry, creating: false)
            _ = try RetainedFileRemoval.cancelAfterInspection(inspection.recovery)
            try LocalVaultDeviceState.clearDeletion(root: root, itemId: itemId, operation: operation, path: path, hash: entry.expectedHash)
        }
    }
    func resolveMove(operation: UUID, observed: MoveResolution, current: Data?, source: Data?,
                     validateCurrent: () throws -> Void, beforeAcknowledge: (() throws -> Void)? = nil) throws {
        try RetainedFileRemoval.withLease(at: captureLease(operation: operation)) {
            guard var entry = try entries().first(where: { $0.operation == operation }), entry.kind == "move" else { throw Failure.invalidRegistry }
            let retained = try recovery(entry)
            let prepared = try StableFileSnapshot.read(retained.prepared)
            let captured = try removalHasCapturedInode(entry)
            let displaced = captured ? try StableFileSnapshot.read(retained.displaced) : nil
            guard digest(prepared) == observed.preparedHash, observed.preparedHash == entry.preparedHash,
                  captured == observed.captured, displaced.map(digest) == observed.displacedHash,
                  (current != nil) == observed.currentPresent, current.map(digest) == observed.currentHash,
                  (source != nil) == observed.sourcePresent, source.map(digest) == observed.sourceHash else { throw Failure.observedVersionChanged }
            try validateCurrent()
            let destination = root.appendingPathComponent(".texttext/conflicts/" + operation.uuidString, isDirectory: true)
            try RetainedFileReplacement.checkedDirectory(destination)
            for bytes in [prepared, displaced, current, source].compactMap({ $0 }) {
                let copy = destination.appendingPathComponent(digest(bytes) + ".textpack")
                if FileManager.default.fileExists(atPath: copy.path) {
                    guard try StableFileSnapshot.read(copy) == bytes else { throw Failure.observedVersionChanged }
                } else { try RetainedFileReplacement.create(bytes, at: copy) }
            }
            try RetainedFileReplacement.flushDirectory(destination)
            try RetainedFileReplacement.flushDirectory(destination.deletingLastPathComponent())
            guard try StableFileSnapshot.read(retained.prepared) == prepared,
                  (try removalHasCapturedInode(entry)) == captured else { throw Failure.observedVersionChanged }
            if let displaced { guard try StableFileSnapshot.read(retained.displaced) == displaced else { throw Failure.observedVersionChanged } }
            try validateCurrent()
            try beforeAcknowledge?()
            entry.moveResolution = observed
            try save(entry, creating: false)
            try RetainedFileMove.acceptCurrentState(retained, displacedHash: observed.displacedHash)
        }
    }
    /// Explicit user acknowledgement retains both snapshots and never changes
    /// the visible projection. A later old-descriptor write reopens the fence.
    func resolve(operation: UUID, visible: URL, itemId: String, observed: Resolution, observe: ((String) throws -> Void)? = nil, beforeAcknowledge: (() throws -> Void)? = nil) throws {
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
        if entry.identityMode == "path", observed.currentPresent != false {
            let bytes = try StableFileSnapshot.read(visible)
            guard digest(bytes) == observed.visibleHash else { throw Failure.observedVersionChanged }
            let destination = root.appendingPathComponent(".texttext/conflicts/" + operation.uuidString)
            let copy = destination.appendingPathComponent(digest(bytes) + ".textpack")
            if FileManager.default.fileExists(atPath: copy.path) {
                guard try StableFileSnapshot.read(copy) == bytes else { throw Failure.observedVersionChanged }
            } else { try RetainedFileReplacement.create(bytes, at: copy) }
            try RetainedFileReplacement.flushDirectory(destination)
        }
        let preparedStamp = try RetainedFileReplacement.fingerprint(first.recovery.prepared)
        let displacedStamp = try RetainedFileReplacement.fingerprint(first.recovery.displaced)
        let latest = try inspect(entry)
        guard latest.preparedHash == observed.preparedHash, latest.displacedHash == observed.displacedHash,
              preparedStamp == (try RetainedFileReplacement.fingerprint(first.recovery.prepared)),
              displacedStamp == (try RetainedFileReplacement.fingerprint(first.recovery.displaced)),
              try visibleMatches(visible, hash: observed.visibleHash, present: observed.currentPresent ?? true) else { throw Failure.observedVersionChanged }
        try beforeAcknowledge?()
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
