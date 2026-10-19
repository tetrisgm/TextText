import Foundation
import Darwin
import TextTextWorkspaceCore

/// A known owner-format floor protects supported prior native factories. Raw
/// file readers and already running old processes remain external writers.
enum RetainedReplacementProfile {
    private struct Marker: Codable, Equatable {
        let version: Int
        let ownerVersion: Int
        let principalHash: String
        let originalOwnerHash: String
    }
    enum Failure: Error, LocalizedError {
        case unsupportedOwner, invalidProfile, changed, busy
        var errorDescription: String? {
            switch self {
            case .unsupportedOwner: return "Update TextText or complete the workspace account review before protected saving. Saved files are preserved."
            case .invalidProfile: return "This workspace's account recovery record could not be verified. Return to the original account or update TextText. Saved files are preserved."
            case .changed: return "The workspace's account details changed while preparing the save. Reopen the workspace and review its account."
            case .busy: return "This workspace's account setup is finishing. Try saving again."
            }
        }
    }
    private static func digest(_ data: Data) -> String { TextTextStableDigest.sha256Hex(data) }
    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; return encoder
    }
    static func principalHash(_ owner: LocalVaultAccountRootOwnership.Owner) throws -> String {
        guard owner.version == 1 || owner.version == 2 else { throw Failure.unsupportedOwner }
        var normalized = owner
        normalized.version = 1
        _ = try LocalVaultAccountIdentity.validate(owner.accountId)
        guard try PortableWorkspaceBinding.normalized(owner.binding) == owner.binding else { throw Failure.invalidProfile }
        return digest(try encoder().encode(normalized))
    }
    private static func directory(_ root: URL) -> URL {
        LocalVaultDeviceState.directory(root: root).appendingPathComponent("retained-replacement-profile", isDirectory: true)
    }
    static func hasPublishedMarker(stateDirectory: URL) -> Bool {
        FileManager.default.fileExists(atPath: stateDirectory.appendingPathComponent("retained-replacement-profile/profile.json").path)
    }
    static func hasRetainedProfile(stateDirectory: URL) -> Bool {
        FileManager.default.fileExists(atPath: stateDirectory.appendingPathComponent("retained-replacement-profile").path)
    }
    private static func withMigrationLease<T>(stateDirectory: URL, exclusive: Bool = true, _ body: () throws -> T) throws -> T {
        do {
            return try RetainedFileRemoval.withLease(at: stateDirectory.appendingPathComponent("retained-replacement-profile.lock"), exclusive: exclusive, body)
        } catch RetainedFileReplacement.Failure.unresolved { throw Failure.busy }
    }
    static func verify(root: URL, owner: LocalVaultAccountRootOwnership.Owner, observe: (() throws -> Void)? = nil) throws {
        try verify(stateDirectory: LocalVaultDeviceState.directory(root: root), owner: owner,
            expectedRootHash: digest(Data(root.standardizedFileURL.resolvingSymlinksInPath().path.utf8)), observe: observe)
    }
    static func verify(stateDirectory: URL, owner: LocalVaultAccountRootOwnership.Owner, expectedRootHash rootHash: String, observe: (() throws -> Void)? = nil) throws {
        let stable = try withMigrationLease(stateDirectory: stateDirectory, exclusive: false) {
            try verifyContents(stateDirectory: stateDirectory, owner: owner, expectedRootHash: rootHash)
            let target = stateDirectory.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
            let retained = try RetainedFileReplacement.inspect(target) + RetainedFileReplacement.inspect(stateDirectory.appendingPathComponent("retained-replacement-profile/profile.json"))
            let stable = retained.allSatisfy { operation in
                operation.record.state == .completed && operation.record.preparedFingerprint != nil && operation.record.displacedFingerprint != nil &&
                    operation.record.preparedFingerprint == (try? RetainedFileReplacement.fingerprint(operation.prepared)) &&
                    operation.record.displacedFingerprint == (try? RetainedFileReplacement.fingerprint(operation.displaced))
            }
            if stable { try observe?() }
            return stable
        }
        if !stable {
            // Reconstruction changes the owner journal. Release the shared
            // read lease, acquire exclusive ownership, then verify again.
            try withMigrationLease(stateDirectory: stateDirectory) {
                try verifyUnlocked(stateDirectory: stateDirectory, owner: owner, expectedRootHash: rootHash)
                try observe?()
            }
        }
    }
#if TEXTTEXT_STRESS_ACTOR
    /// No migration lease, publication, classify, acknowledge, or repair. Only
    /// already-completed stable profile records can attest a private observer.
    static func stressObservation(stateDirectory: URL, owner: LocalVaultAccountRootOwnership.Owner, expectedRootHash rootHash: String) throws -> [String: String] {
        let target = stateDirectory.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let profile = stateDirectory.appendingPathComponent("retained-replacement-profile/profile.json")
        func snapshot() throws -> [String: String] {
            var result = [String: String]()
            if owner.version == 1 && hasRetainedProfile(stateDirectory: stateDirectory) { throw Failure.invalidProfile }
            if owner.version == 2 {
                try verifyContents(stateDirectory: stateDirectory, owner: owner, expectedRootHash: rootHash)
                for name in ["profile.json", "owner-v1.json", "profile-v1.json", "profile-v2.json", "profile-v3.json", "profile-v4.json"] {
                    let url = stateDirectory.appendingPathComponent("retained-replacement-profile/" + name)
                    var info = stat()
                    if lstat(url.path, &info) != 0 { guard errno == ENOENT else { throw Failure.invalidProfile }; continue }
                    result[name] = digest(try StableFileSnapshot.read(url, maximumBytes: 4096))
                }
            } else if hasRetainedProfile(stateDirectory: stateDirectory) { throw Failure.invalidProfile }
            for inspected in [target, profile] {
                if !FileManager.default.fileExists(atPath: inspected.deletingLastPathComponent().path) { continue }
                let layout = try RetainedFileReplacement.layout(target: inspected)
                let base = URL(fileURLWithPath: layout.basePath)
                if FileManager.default.fileExists(atPath: base.path) {
                    // layout.basePath already uses C realpath. Foundation may
                    // map /private/var back to /var; compare physical spellings
                    // using the same existing C convention, never follow a link.
                    var info = stat()
                    guard lstat(base.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                          let physical = realpath(base.path, nil) else { throw Failure.invalidProfile }
                    defer { free(physical) }
                    guard String(cString: physical) == layout.basePath,
                          try FileManager.default.contentsOfDirectory(atPath: base.path).count <= 64 else { throw Failure.invalidProfile }
                }
                for operation in try RetainedFileReplacement.inspect(inspected) {
                    guard operation.record.state == .completed,
                          let prepared = operation.record.preparedFingerprint, let displaced = operation.record.displacedFingerprint,
                          prepared == (try RetainedFileReplacement.fingerprint(operation.prepared)),
                          displaced == (try RetainedFileReplacement.fingerprint(operation.displaced)) else { throw Failure.invalidProfile }
                    let key = inspected.lastPathComponent + "/" + operation.record.operation.uuidString
                    result[key] = digest(try StableFileSnapshot.read(operation.directory.appendingPathComponent("manifest.json"), maximumBytes: 32 * 1024))
                }
            }
            return result
        }
        let first = try snapshot()
        guard try snapshot() == first else { throw Failure.invalidProfile }
        return first
    }
#endif
    private static func verifyUnlocked(stateDirectory: URL, owner: LocalVaultAccountRootOwnership.Owner, expectedRootHash rootHash: String) throws {
        try verifyContents(stateDirectory: stateDirectory, owner: owner, expectedRootHash: rootHash)
        let target = stateDirectory.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        for recovery in try RetainedFileReplacement.inspect(target) where recovery.record.state == .pending {
            let visible = try StableFileSnapshot.read(target, maximumBytes: 4096)
            let exchange = try StableFileSnapshot.read(recovery.displaced, maximumBytes: 4096)
            if digest(visible) == recovery.record.expectedHash, digest(exchange) == recovery.record.preparedHash {
                try RetainedFileReplacement.acknowledge(recovery, preparedHash: recovery.record.preparedHash, displacedHash: recovery.record.preparedHash)
            } else { _ = try RetainedFileReplacement.classify(recovery, target: target) }
        }
        try RetainedFileReplacement.assertReadable(target)
        let profile = stateDirectory.appendingPathComponent("retained-replacement-profile/profile.json")
        for recovery in try RetainedFileReplacement.inspect(profile) where recovery.record.state == .pending {
            let visible = try StableFileSnapshot.read(profile, maximumBytes: 4096)
            let exchange = try StableFileSnapshot.read(recovery.displaced, maximumBytes: 4096)
            if digest(visible) == recovery.record.expectedHash, digest(exchange) == recovery.record.preparedHash {
                try RetainedFileReplacement.acknowledge(recovery, preparedHash: recovery.record.preparedHash, displacedHash: recovery.record.preparedHash)
            } else { _ = try RetainedFileReplacement.classify(recovery, target: profile) }
        }
        try RetainedFileReplacement.assertReadable(profile)
    }
    private static func verifyContents(stateDirectory: URL, owner: LocalVaultAccountRootOwnership.Owner, expectedRootHash rootHash: String) throws {
        let folder = stateDirectory.appendingPathComponent("retained-replacement-profile", isDirectory: true)
        guard folder.resolvingSymlinksInPath().path == folder.path else { throw Failure.invalidProfile }
        let markerBytes = try StableFileSnapshot.read(folder.appendingPathComponent("profile.json"), maximumBytes: 4096)
        guard let fields = try JSONSerialization.jsonObject(with: markerBytes) as? [String: Any],
              Set(fields.keys) == Set(["version", "ownerVersion", "principalHash", "originalOwnerHash"]) else { throw Failure.invalidProfile }
        let marker = try JSONDecoder().decode(Marker.self, from: markerBytes)
        let before = try StableFileSnapshot.read(folder.appendingPathComponent("owner-v1.json"), maximumBytes: 4096)
        let original = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: before)
        guard (1...5).contains(marker.version), marker.ownerVersion == 2, original.version == 1,
              owner.rootHash == rootHash, original.rootHash == rootHash,
              marker.originalOwnerHash == digest(before),
              marker.principalHash == (try principalHash(owner)),
              marker.principalHash == (try principalHash(original)) else { throw Failure.invalidProfile }
        for version in 1..<marker.version {
            let preserved = try StableFileSnapshot.read(folder.appendingPathComponent("profile-v\(version).json"), maximumBytes: 4096)
            guard let priorFields = try JSONSerialization.jsonObject(with: preserved) as? [String: Any],
                  Set(priorFields.keys) == Set(["version", "ownerVersion", "principalHash", "originalOwnerHash"]) else { throw Failure.invalidProfile }
            let prior = try JSONDecoder().decode(Marker.self, from: preserved)
            guard prior == Marker(version: version, ownerVersion: marker.ownerVersion, principalHash: marker.principalHash,
                originalOwnerHash: marker.originalOwnerHash) else { throw Failure.invalidProfile }
        }
    }
    /// Publish a supported-old-reader refusal floor before directory mutation.
    /// Owner/principal binding is unchanged; local-only roots cannot opt in.
    static func prepareFolderCase(root: URL, observe: ((String) throws -> Void)? = nil) throws {
        let root = root.standardizedFileURL.resolvingSymlinksInPath(), state = LocalVaultDeviceState.directory(root: root)
        let ownerURL = state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        guard FileManager.default.fileExists(atPath: ownerURL.path) else { throw Failure.unsupportedOwner }
        try withMigrationLease(stateDirectory: state) {
            try prepareUnlocked(root: root, observe: nil)
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: StableFileSnapshot.read(ownerURL, maximumBytes: 4096))
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
            let profile = directory(root).appendingPathComponent("profile.json")
            let before = try StableFileSnapshot.read(profile, maximumBytes: 4096)
            let marker = try JSONDecoder().decode(Marker.self, from: before)
            if marker.version >= 2 { return }
            guard marker.version == 1 else { throw Failure.invalidProfile }
            try publishCreateOnly(before, target: directory(root).appendingPathComponent("profile-v1.json"))
            try observe?("folderProfilePreserved")
            let next = Marker(version: 2, ownerVersion: marker.ownerVersion, principalHash: marker.principalHash, originalOwnerHash: marker.originalOwnerHash)
            _ = try RetainedFileReplacement.replace(profile, expectedHash: digest(before), prepared: encoder().encode(next)) { stage in
                try observe?("folderProfile:" + stage)
            }
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
        }
    }
    /// Version two readers know local directory renames but not a queued
    /// server subtree operation. Refuse those readers before that intent exists.
    static func prepareFolderPropagation(root: URL, observe: ((String) throws -> Void)? = nil) throws {
        try prepareFolderCase(root: root)
        let root = root.standardizedFileURL.resolvingSymlinksInPath(), state = LocalVaultDeviceState.directory(root: root)
        try withMigrationLease(stateDirectory: state) {
            try prepareUnlocked(root: root, observe: nil)
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                from: StableFileSnapshot.read(state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName), maximumBytes: 4096))
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
            let profile = directory(root).appendingPathComponent("profile.json")
            let before = try StableFileSnapshot.read(profile, maximumBytes: 4096)
            let marker = try JSONDecoder().decode(Marker.self, from: before)
            if marker.version >= 3 { return }
            guard marker.version == 2 else { throw Failure.invalidProfile }
            try publishCreateOnly(before, target: directory(root).appendingPathComponent("profile-v2.json"))
            try observe?("folderPropagationProfilePreserved")
            let next = Marker(version: 3, ownerVersion: marker.ownerVersion, principalHash: marker.principalHash, originalOwnerHash: marker.originalOwnerHash)
            _ = try RetainedFileReplacement.replace(profile, expectedHash: digest(before), prepared: encoder().encode(next)) { stage in
                try observe?("folderPropagationProfile:" + stage)
            }
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
        }
    }
    private static func publishCreateOnly(_ bytes: Data, target: URL) throws {
        if FileManager.default.fileExists(atPath: target.path) {
            guard try StableFileSnapshot.read(target, maximumBytes: 4096) == bytes else { throw Failure.invalidProfile }
        } else { try RetainedFileReplacement.create(bytes, at: target) }
    }
    static func prepareLocalHandoff(root: URL, observe: ((String) throws -> Void)? = nil) throws {
        guard try LocalVaultDeviceState.supportsLocalHandoff(root: root) else { throw Failure.unsupportedOwner }
        // A completed floor needs verification, not another migration writer.
        // Stable verification shares the lease with other account readers; any
        // unfinished retained publication still takes the existing exclusive
        // recovery path before this callback may report readiness.
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
            from: StableFileSnapshot.read(LocalVaultDeviceState.directory(root: canonical)
                .appendingPathComponent(LocalVaultAccountRootOwnership.fileName), maximumBytes: 4096))
        var ready = false
        if owner.version == 2 {
            try verify(root: canonical, owner: owner) {
                let marker = try JSONDecoder().decode(Marker.self,
                    from: StableFileSnapshot.read(directory(canonical).appendingPathComponent("profile.json"), maximumBytes: 4096))
                ready = marker.version >= 4
            }
        }
        if ready { return }
        try prepareFolderPropagation(root: root)
        let root = root.standardizedFileURL.resolvingSymlinksInPath(), state = LocalVaultDeviceState.directory(root: root)
        try withMigrationLease(stateDirectory: state) {
            try prepareUnlocked(root: root, observe: nil)
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                from: StableFileSnapshot.read(state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName), maximumBytes: 4096))
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
            let profile = directory(root).appendingPathComponent("profile.json")
            let before = try StableFileSnapshot.read(profile, maximumBytes: 4096)
            let marker = try JSONDecoder().decode(Marker.self, from: before)
            if marker.version >= 4 { return }
            guard marker.version == 3 else { throw Failure.invalidProfile }
            try publishCreateOnly(before, target: directory(root).appendingPathComponent("profile-v3.json"))
            try observe?("localHandoffProfilePreserved")
            let next = Marker(version: 4, ownerVersion: marker.ownerVersion, principalHash: marker.principalHash, originalOwnerHash: marker.originalOwnerHash)
            _ = try RetainedFileReplacement.replace(profile, expectedHash: digest(before), prepared: encoder().encode(next)) { stage in
                try observe?("localHandoffProfile:" + stage)
            }
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
        }
    }
    /// Publish the private format floor before a durable shared rename map.
    /// This protects supported factories using this same device-state directory.
    static func prepareSharedRenames(root: URL, observe: ((String) throws -> Void)? = nil) throws {
        guard try LocalVaultDeviceState.supportsLocalHandoff(root: root) else { throw Failure.unsupportedOwner }
        let root = root.standardizedFileURL.resolvingSymlinksInPath(), state = LocalVaultDeviceState.directory(root: root)
        // Supported startup must finish legacy migration first. Publishing a
        // format floor never imports a late portable journal as a side effect.
        for name in ["sync", "shared-editing"] {
            let marker = state.appendingPathComponent(".legacy-\(name)-checked")
            guard (try? StableFileSnapshot.read(marker, maximumBytes: 1)) == Data() else { throw Failure.changed }
            let fd = Darwin.open(marker.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { throw Failure.changed }
            defer { Darwin.close(fd) }
            var info = stat()
            guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_size == 0, fsync(fd) == 0 else { throw Failure.changed }
        }
        try RetainedFileReplacement.flushDirectory(state)
        try observe?("sharedRenameMigrationReady")
        try prepareLocalHandoff(root: root)
        let existingOwner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
            from: StableFileSnapshot.read(state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName), maximumBytes: 4096))
        var ready = false
        try verify(root: root, owner: existingOwner) {
            ready = try JSONDecoder().decode(Marker.self,
                from: StableFileSnapshot.read(directory(root).appendingPathComponent("profile.json"), maximumBytes: 4096)).version == 5
        }
        if ready { return }
        try withMigrationLease(stateDirectory: state) {
            let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
                from: StableFileSnapshot.read(state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName), maximumBytes: 4096))
            guard owner.version == 2 else { throw Failure.unsupportedOwner }
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
            let profile = directory(root).appendingPathComponent("profile.json")
            let before = try StableFileSnapshot.read(profile, maximumBytes: 4096)
            let marker = try JSONDecoder().decode(Marker.self, from: before)
            if marker.version == 5 { return }
            guard marker.version == 4 else { throw Failure.invalidProfile }
            try observe?("sharedRenameProfileBeforeBackup")
            try publishCreateOnly(before, target: directory(root).appendingPathComponent("profile-v4.json"))
            try RetainedFileReplacement.flushDirectory(directory(root))
            try observe?("sharedRenameProfilePreserved")
            let next = Marker(version: 5, ownerVersion: marker.ownerVersion, principalHash: marker.principalHash, originalOwnerHash: marker.originalOwnerHash)
            _ = try RetainedFileReplacement.replace(profile, expectedHash: digest(before), prepared: encoder().encode(next)) { stage in
                try observe?("sharedRenameProfile:" + stage)
            }
            try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
            try observe?("sharedRenameProfileReady")
        }
    }
    /// Owned stores call this before projection mutation. Migration and its
    /// startup verification share one device-private root lease.
    static func prepare(root: URL, observe: ((String) throws -> Void)? = nil) throws {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        try LocalVaultAccountRootOwnership.requireNoAdoption(root: root)
        let ownerURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self,
            from: StableFileSnapshot.read(ownerURL, maximumBytes: 4096))
        if owner.version == 2 {
            try verify(root: root, owner: owner)
            return
        }
        try withMigrationLease(stateDirectory: LocalVaultDeviceState.directory(root: root)) {
            try prepareUnlocked(root: root, observe: observe)
        }
    }
    private static func prepareUnlocked(root: URL, observe: ((String) throws -> Void)?) throws {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        try LocalVaultAccountRootOwnership.requireNoAdoption(root: root)
        let state = LocalVaultDeviceState.directory(root: root)
        let ownerURL = state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        for recovery in try RetainedFileReplacement.inspect(ownerURL) where recovery.record.state == .pending {
            let visible = try StableFileSnapshot.read(ownerURL, maximumBytes: 4096)
            let exchange = try StableFileSnapshot.read(recovery.displaced, maximumBytes: 4096)
            if digest(visible) == recovery.record.expectedHash, digest(exchange) == recovery.record.preparedHash {
                // A crash before the swap never changed the owner. Verify the
                // prepared profile then retain/cancel this unstarted attempt.
                let current = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: visible)
                try verifyContents(stateDirectory: state, owner: current, expectedRootHash: digest(Data(root.path.utf8)))
                try RetainedFileReplacement.acknowledge(recovery, preparedHash: recovery.record.preparedHash, displacedHash: recovery.record.preparedHash)
            } else { _ = try RetainedFileReplacement.classify(recovery, target: ownerURL) }
        }
        try RetainedFileReplacement.assertReadable(ownerURL)
        let original = try StableFileSnapshot.read(ownerURL, maximumBytes: 4096)
        var owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: original)
        guard owner.rootHash == digest(Data(root.path.utf8)) else { throw Failure.invalidProfile }
        if owner.version == 2 { try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8))); return }
        guard owner.version == 1 else { throw Failure.unsupportedOwner }
        let marker = Marker(version: 1, ownerVersion: 2, principalHash: try principalHash(owner), originalOwnerHash: digest(original))
        let folder = directory(root)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard folder.resolvingSymlinksInPath().path == folder.path else { throw Failure.invalidProfile }
        try publishCreateOnly(original, target: folder.appendingPathComponent("owner-v1.json"))
        try observe?("ownerPreserved")
        try publishCreateOnly(encoder().encode(marker), target: folder.appendingPathComponent("profile.json"))
        try RetainedFileReplacement.flushDirectory(folder)
        try RetainedFileReplacement.flushDirectory(state)
        try observe?("profilePrepared")
        guard try StableFileSnapshot.read(ownerURL, maximumBytes: 4096) == original else { throw Failure.changed }
        owner.version = 2
        _ = try RetainedFileReplacement.replace(ownerURL, expectedHash: digest(original), prepared: encoder().encode(owner)) { stage in
            switch stage {
            case "prepared": try observe?("ownerStaged")
            case "beforeSwap": try observe?("ownerBeforePublish")
            case "swapped": try observe?("ownerSwapped")
            default: break
            }
        }
        try observe?("ownerPublished")
        try verifyUnlocked(stateDirectory: state, owner: owner, expectedRootHash: digest(Data(root.path.utf8)))
    }
}
