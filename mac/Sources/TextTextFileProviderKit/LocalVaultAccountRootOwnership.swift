import Foundation
import TextTextWorkspaceCore

/// Device-private ownership, deliberately separate from portable workspace ID.
public enum LocalVaultAccountRootOwnership {
    public static let fileName = "account-owner.json"
    public static let pendingAdoption = "account-adoption.json"
    public struct Owner: Codable, Equatable {
        public var version: Int
        public let binding: LocalVaultSyncBinding
        public let accountId: String
        public let rootHash: String
    }
    public enum Failure: Error, LocalizedError {
        case adoption, account, future
        public var errorDescription: String? {
            switch self {
            case .adoption: return "Review this folder's saved work before keeping it with the signed-in account. Original files remain on this device."
            case .account: return "Return to the original account to continue this folder's saved work."
            case .future: return "Update TextText to open this workspace. Saved work is unchanged."
            }
        }
    }
    private static func read(_ target: URL, limit: Int) throws -> Data {
        guard target.resolvingSymlinksInPath().path == target.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        let values = try target.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) <= limit else { throw Failure.future }
        let bytes = try Data(contentsOf: target)
        guard bytes.count <= limit else { throw Failure.future }
        return bytes
    }
    public static func requireNoAdoption(root: URL) throws {
        let pending = LocalVaultDeviceState.directory(root: root).appendingPathComponent(pendingAdoption)
        guard !FileManager.default.fileExists(atPath: pending.path) else { throw Failure.adoption }
    }
    public static func open(root: URL, binding: LocalVaultSyncBinding, accountId: String) throws {
        _ = try LocalVaultAccountIdentity.validate(accountId)
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        let directory = LocalVaultDeviceState.directory(root: canonical)
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        try requireNoAdoption(root: canonical)
        let expected = Owner(version: 1, binding: try PortableWorkspaceBinding.normalized(binding), accountId: accountId,
            rootHash: TextTextStableDigest.sha256Hex(Data(canonical.path.utf8)))
        let marker = directory.appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: marker.path) { try verify(marker, expected: expected); return }
        let stateURL = directory.appendingPathComponent("sync/state.json")
        if FileManager.default.fileExists(atPath: stateURL.path) {
            struct StateOwner: Decodable { let version: Int?; let binding: LocalVaultSyncBinding; let accountId: String? }
            let state = try JSONDecoder().decode(StateOwner.self, from: read(stateURL, limit: 90 * 1024 * 1024))
            guard state.version == nil || state.version == 1 else { throw Failure.future }
            guard let owner = state.accountId else { throw Failure.adoption }
            guard owner == accountId, try PortableWorkspaceBinding.normalized(state.binding) == expected.binding else { throw Failure.account }
        } else {
            let entries = try FileManager.default.contentsOfDirectory(at: canonical, includingPropertiesForKeys: nil)
            guard entries.allSatisfy({ $0.lastPathComponent == ".texttext" }) else { throw Failure.adoption }
            let shared = directory.appendingPathComponent("shared-editing")
            if FileManager.default.fileExists(atPath: shared.path),
               !(try FileManager.default.contentsOfDirectory(at: shared, includingPropertiesForKeys: nil)).isEmpty { throw Failure.adoption }
        }
        try publish(expected, root: canonical)
    }
    static func verify(_ target: URL, expected: Owner) throws {
        let actual = try JSONDecoder().decode(Owner.self, from: read(target, limit: 4096))
        guard actual.version == 1 else { throw Failure.future }
        guard actual == expected else { throw Failure.account }
    }
    // Explicit legacy adoption publishes this only after its durable migration
    // completes. Ordinary open must pass the ownership proof above first.
    static func publish(_ owner: Owner, root: URL) throws {
        let directory = LocalVaultDeviceState.directory(root: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let marker = directory.appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: marker.path) { try verify(marker, expected: owner); return }
        let temporary = directory.appendingPathComponent(".account-owner-" + UUID().uuidString + ".tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try JSONEncoder().encode(owner).write(to: temporary, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        let handle = try FileHandle(forWritingTo: temporary)
        try handle.synchronize(); try handle.close()
        do { try FileManager.default.moveItem(at: temporary, to: marker) }
        catch { if FileManager.default.fileExists(atPath: marker.path) { try verify(marker, expected: owner) } else { throw error } }
    }
}
