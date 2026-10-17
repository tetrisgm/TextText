import Foundation
import TextTextFileProviderKit

/// Device-local UI permissions only. Uploads always obtain a fresh server manifest.
enum LocalVaultCapabilityCache {
    private struct Record: Codable { var version: Int? = 1; let binding: LocalVaultSyncBinding; var accountId: String? = nil; let capabilities: LocalVaultSyncCapabilities }
    private static func url(_ root: URL) -> URL { LocalVaultDeviceState.directory(root: root).appendingPathComponent("workspace-capabilities.json") }
    static func read(root: URL, binding: LocalVaultSyncBinding, accountId: String? = nil) throws -> LocalVaultSyncCapabilities? {
        if let accountId { _ = try LocalVaultAccountIdentity.validate(accountId) }
        let target = url(root)
        guard FileManager.default.fileExists(atPath: target.path) else { return nil }
        let data = try Data(contentsOf: target)
        guard data.count <= 8 * 1024 * 1024 else { return nil }
        let record = try JSONDecoder().decode(Record.self, from: data)
        guard record.version == nil || record.version == 1 else { throw LocalVaultAccountRootOwnership.Failure.future }
        guard record.binding == binding, record.accountId == accountId else { return nil }
        return record.capabilities
    }
    static func write(_ capabilities: LocalVaultSyncCapabilities, root: URL, binding: LocalVaultSyncBinding, accountId: String? = nil) throws {
        if let accountId { _ = try LocalVaultAccountIdentity.validate(accountId) }
        let target = url(root)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(Record(binding: binding, accountId: accountId, capabilities: capabilities)).write(to: target, options: .atomic)
    }
}
