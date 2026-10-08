import Foundation
import Darwin

/// Portable identity only. Tokens, cursors and recovery journals stay on the device.
public enum PortableWorkspaceBinding {
    private struct Marker: Codable { let version: Int; let origin: String; let workspaceId: String }
    private struct LegacyMarker: Decodable { let Version: Int; let Origin: String; let WorkspaceId: String }
    public static func normalized(_ binding: LocalVaultSyncBinding) throws -> LocalVaultSyncBinding {
        var parts = URLComponents(url: binding.origin, resolvingAgainstBaseURL: false)!
        parts.scheme = parts.scheme?.lowercased(); parts.host = parts.host?.lowercased(); parts.path = ""
        if parts.scheme == "https" && parts.port == 443 || parts.scheme == "http" && parts.port == 80 { parts.port = nil }
        guard let origin = parts.url else { throw LocalVaultSyncFailure.invalidBinding }
        return try LocalVaultSyncBinding(origin: origin, workspaceId: binding.workspaceId)
    }
    private static func location(_ root: URL) throws -> URL {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        let directory = root.appendingPathComponent(".texttext", isDirectory: true)
        let file = directory.appendingPathComponent("workspace-binding.json")
        guard directory.resolvingSymlinksInPath().path == directory.path, file.resolvingSymlinksInPath().path == file.path else { throw LocalVaultSyncFailure.invalidBinding }
        // An evicted iCloud file is not an absent identity that can be replaced.
        if FileManager.default.fileExists(atPath: directory.appendingPathComponent(".workspace-binding.json.icloud").path) { throw LocalVaultSyncFailure.invalidBinding }
        return file
    }
    public static func read(root: URL) throws -> LocalVaultSyncBinding? {
        let file = try location(root)
        let data: Data
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular,
                  let size = attributes[.size] as? NSNumber, size.intValue <= 4096 else { throw LocalVaultSyncFailure.invalidBinding }
            let handle = try FileHandle(forReadingFrom: file)
            defer { try? handle.close() }
            data = try handle.read(upToCount: 4097) ?? Data()
        }
        catch {
            let error = error as NSError
            if error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return nil }
            throw error
        }
        guard data.count <= 4096 else { throw LocalVaultSyncFailure.invalidBinding }
        let marker: Marker
        if let current = try? JSONDecoder().decode(Marker.self, from: data) { marker = current }
        else { let old = try JSONDecoder().decode(LegacyMarker.self, from: data); marker = Marker(version: old.Version, origin: old.Origin, workspaceId: old.WorkspaceId) }
        guard marker.version == 1, let origin = URL(string: marker.origin) else { throw LocalVaultSyncFailure.invalidBinding }
        return try normalized(LocalVaultSyncBinding(origin: origin, workspaceId: marker.workspaceId))
    }
    /// Call only after the account's workspace identity has been verified by the server.
    public static func bindVerified(root: URL, binding: LocalVaultSyncBinding) throws {
        let binding = try normalized(binding)
        if let existing = try read(root: root) {
            guard existing == binding else { throw LocalVaultSyncFailure.invalidBinding }
            return
        }
        let file = try location(root), directory = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        _ = try location(root)
        let temporary = directory.appendingPathComponent(".workspace-binding-\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let data = try JSONEncoder().encode(Marker(version: 1, origin: binding.origin.absoluteString, workspaceId: binding.workspaceId))
        try data.write(to: temporary, options: .withoutOverwriting)
        let handle = try FileHandle(forWritingTo: temporary); try handle.synchronize(); try handle.close()
        // RENAME_EXCL provides atomic publication without replacing a concurrent binding.
        if renamex_np(temporary.path, file.path, UInt32(RENAME_EXCL)) != 0 {
            guard errno == EEXIST, try read(root: root) == binding else { throw LocalVaultSyncFailure.invalidBinding }
        }
    }
}
