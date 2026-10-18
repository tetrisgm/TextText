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
            let retained = try RetainedFileReplacement.inspect(target)
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
        guard marker.version == 1, marker.ownerVersion == 2, original.version == 1,
              owner.rootHash == rootHash, original.rootHash == rootHash,
              marker.originalOwnerHash == digest(before),
              marker.principalHash == (try principalHash(owner)),
              marker.principalHash == (try principalHash(original)) else { throw Failure.invalidProfile }
    }
    private static func publishCreateOnly(_ bytes: Data, target: URL) throws {
        if FileManager.default.fileExists(atPath: target.path) {
            guard try StableFileSnapshot.read(target, maximumBytes: 4096) == bytes else { throw Failure.invalidProfile }
        } else { try RetainedFileReplacement.create(bytes, at: target) }
    }
    /// Owned stores call this before projection mutation. Migration and its
    /// startup verification share one device-private root lease.
    static func prepare(root: URL, observe: ((String) throws -> Void)? = nil) throws {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
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
