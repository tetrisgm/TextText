import Foundation
import Darwin

/// Captures one bounded regular-file version even when a noncoordinating tool
/// writes in place or atomically replaces its path. A later save still needs CAS.
enum StableFileSnapshot {
    private struct Fingerprint: Equatable {
        let device: Int32, inode: UInt64, size: Int64
        let modifiedSeconds: Int, modifiedNanos: Int, changedSeconds: Int, changedNanos: Int
        init(_ value: stat) {
            device = value.st_dev; inode = value.st_ino; size = value.st_size
            modifiedSeconds = value.st_mtimespec.tv_sec; modifiedNanos = value.st_mtimespec.tv_nsec
            changedSeconds = value.st_ctimespec.tv_sec; changedNanos = value.st_ctimespec.tv_nsec
        }
    }

    static func read(_ url: URL, maximumBytes: Int = 64 * 1024 * 1024, attempts: Int = 3,
        afterRead: (@Sendable (Int) throws -> Void)? = nil) throws -> Data {
        precondition(maximumBytes > 0 && maximumBytes < Int.max && (1...8).contains(attempts))
        for attempt in 0..<attempts {
            let descriptor = url.withUnsafeFileSystemRepresentation { path in
                path.map { Darwin.open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK) } ?? -1
            }
            guard descriptor >= 0 else {
                if errno == ENOENT { continue }
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
            defer { Darwin.close(descriptor) }
            var before = stat()
            guard Darwin.fstat(descriptor, &before) == 0 else { throw POSIXError(.EIO) }
            guard before.st_mode & S_IFMT == S_IFREG else { throw LocalVaultDocumentStore.Failure.invalidPath }
            guard before.st_size >= 0 && before.st_size <= maximumBytes else { throw LocalVaultDocumentStore.Failure.tooLarge }
            var bytes = Data(); bytes.reserveCapacity(Int(before.st_size))
            var buffer = [UInt8](repeating: 0, count: 64 * 1024)
            while true {
                let remaining = min(buffer.count, maximumBytes + 1 - bytes.count)
                let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, remaining) }
                if count < 0 {
                    if errno == EINTR { continue }
                    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                }
                if count == 0 { break }
                bytes.append(contentsOf: buffer.prefix(count))
                guard bytes.count <= maximumBytes else { throw LocalVaultDocumentStore.Failure.tooLarge }
            }
            try afterRead?(attempt)
            var after = stat(), current = stat()
            guard Darwin.fstat(descriptor, &after) == 0 else { throw POSIXError(.EIO) }
            let pathStatus = url.withUnsafeFileSystemRepresentation { path in path.map { Darwin.lstat($0, &current) } ?? -1 }
            guard pathStatus == 0, current.st_mode & S_IFMT == S_IFREG,
                  Fingerprint(before) == Fingerprint(after), Fingerprint(after) == Fingerprint(current),
                  bytes.count == Int(after.st_size) else { continue }
            return bytes
        }
        throw LocalVaultDocumentStore.Failure.changed
    }
}
