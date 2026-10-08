import Foundation
import TextTextFileProviderKit

/// Device-local UI permissions only. Uploads always obtain a fresh server manifest.
enum LocalVaultCapabilityCache {
    private struct Record: Codable { let binding: LocalVaultSyncBinding; let capabilities: LocalVaultSyncCapabilities }
    private static func url(_ root: URL) -> URL { LocalVaultDeviceState.directory(root: root).appendingPathComponent("workspace-capabilities.json") }
    static func read(root: URL, binding: LocalVaultSyncBinding) throws -> LocalVaultSyncCapabilities? {
        let target = url(root)
        guard FileManager.default.fileExists(atPath: target.path) else { return nil }
        let data = try Data(contentsOf: target)
        guard data.count <= 8 * 1024 * 1024 else { return nil }
        let record = try JSONDecoder().decode(Record.self, from: data)
        guard record.binding == binding else { return nil }
        return record.capabilities
    }
    static func write(_ capabilities: LocalVaultSyncCapabilities, root: URL, binding: LocalVaultSyncBinding) throws {
        let target = url(root)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(Record(binding: binding, capabilities: capabilities)).write(to: target, options: .atomic)
    }
}
