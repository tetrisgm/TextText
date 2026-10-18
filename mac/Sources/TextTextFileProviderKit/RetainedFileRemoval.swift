import Foundation
import Darwin
import TextTextWorkspaceCore

/// A deletion retains the actual inode with an exclusive same-volume rename.
/// Nothing is unlinked and a recreated visible path is never rolled back.
enum RetainedFileRemoval {
    static func capture(_ target: URL, expectedHash: String, recoveryRoot: URL, operation: UUID,
                        observe: ((String) throws -> Void)? = nil) throws -> RetainedFileReplacement.Recovery {
        let before = try StableFileSnapshot.read(target)
        guard try RetainedFileReplacement.available(target) >= Int64(before.count) + 64 * 1024 * 1024 else { throw RetainedFileReplacement.Failure.insufficientSpace }
        guard TextTextStableDigest.sha256Hex(before) == expectedHash else { throw LocalVaultDocumentStore.Failure.changed }
        let storageTarget = recoveryRoot.appendingPathComponent(target.lastPathComponent)
        let directory = RetainedFileReplacement.operationDirectory(target: storageTarget, operation: operation)
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw RetainedFileReplacement.Failure.invalidJournal }
        try RetainedFileReplacement.checkedDirectory(directory)
        var source = stat(), destination = stat()
        let fd = open(target.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw RetainedFileReplacement.Failure.invalidJournal }
        defer { close(fd) }
        guard fstat(fd, &source) == 0, lstat(directory.path, &destination) == 0, source.st_dev == destination.st_dev else {
            throw RetainedFileReplacement.Failure.unsupported(EXDEV)
        }
        var record = RetainedFileReplacement.Record(version: 1, operation: operation, filename: target.lastPathComponent,
            expectedHash: expectedHash, preparedHash: expectedHash, state: .pending)
        record.kind = "removal"
        try RetainedFileReplacement.create(before, at: directory.appendingPathComponent("prepared"))
        try RetainedFileReplacement.save(record, in: directory)
        try RetainedFileReplacement.flushDirectory(directory.deletingLastPathComponent())
        try RetainedFileReplacement.flushDirectory(directory.deletingLastPathComponent().deletingLastPathComponent())
        try RetainedFileReplacement.flushDirectory(target.deletingLastPathComponent())
        try observe?("prepared")
        guard TextTextStableDigest.sha256Hex(try StableFileSnapshot.read(target)) == expectedHash else {
            throw RetainedFileReplacement.Failure.unresolved(directory)
        }
        try observe?("beforeCapture")
        let displaced = directory.appendingPathComponent("exchange")
        guard renamex_np(try RetainedFileReplacement.physicalPath(target), try RetainedFileReplacement.physicalPath(displaced),
            UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY)) == 0 else { throw RetainedFileReplacement.Failure.unsupported(errno) }
        try RetainedFileReplacement.flushDirectory(directory)
        try RetainedFileReplacement.flushDirectory(target.deletingLastPathComponent())
        try observe?("captured")
        let recovery = RetainedFileReplacement.Recovery(directory: directory, record: record, storageTarget: storageTarget)
        let classified = try RetainedFileReplacement.classify(recovery, target: target)
        guard classified.record.state == .completed else { throw RetainedFileReplacement.Failure.unresolved(directory) }
        return classified
    }
}
