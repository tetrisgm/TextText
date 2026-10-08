import Foundation
import TextTextFileProviderKit

/// Workspace identities come from authenticated discovery, never a caller-supplied path.
enum LocalVaultWorkspaceSelection {
    static func prepareFolder(_ root: URL, binding: LocalVaultSyncBinding) throws {
        let manager = FileManager.default
        if manager.fileExists(atPath: root.path) {
            let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { throw LocalVaultSyncFailure.invalidBinding }
            if let stored = try LocalVaultSync.binding(root: root) {
                guard try PortableWorkspaceBinding.normalized(stored) == PortableWorkspaceBinding.normalized(binding) else { throw LocalVaultSyncFailure.invalidBinding }
            } else if let portable = try PortableWorkspaceBinding.read(root: root) {
                guard try portable == PortableWorkspaceBinding.normalized(binding) else { throw LocalVaultSyncFailure.invalidBinding }
            } else {
                guard try manager.contentsOfDirectory(atPath: root.path).isEmpty else { throw LocalVaultSyncFailure.invalidBinding }
            }
        } else { try manager.createDirectory(at: root, withIntermediateDirectories: false) }
    }
}
