import Foundation
import Darwin

/// Device-local descriptor ownership, never a timestamp or a synchronized file.
/// Keep the inode in place: process death releases flock without deleting it.
final class LocalVaultDocumentLease: @unchecked Sendable {
    private let descriptor: Int32
    init(root: URL, itemId: String) throws {
        guard itemId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\z", options: .regularExpression) != nil else { throw LocalVaultSharedFailure.invalid }
        let directory = LocalVaultDeviceState.directory(root: root)
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let fd = open(directory.appendingPathComponent("document-" + itemId + ".lock").path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { _ = close(fd); throw LocalVaultSyncFailure.busy }
        descriptor = fd
    }
    deinit { _ = flock(descriptor, LOCK_UN); _ = close(descriptor) }
}
