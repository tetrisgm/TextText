import Foundation
import Darwin
import TextTextWorkspaceCore

/// Exclusive rename never discards the raced source: it remains visible at the
/// destination. Immutable before/observed snapshots and a durable intent fence
/// prevent that different inode from being acknowledged as the expected file.
enum RetainedFileMove {
    private static func digest(_ bytes: Data) -> String { TextTextStableDigest.sha256Hex(bytes) }
    private static func readIfPresent(_ target: URL) throws -> Data? {
        var info = stat()
        if lstat(target.path, &info) != 0 {
            guard errno == ENOENT else { throw RetainedFileReplacement.Failure.invalidJournal }
            return nil
        }
        guard info.st_mode & S_IFMT == S_IFREG else { throw RetainedFileReplacement.Failure.invalidJournal }
        return try StableFileSnapshot.read(target)
    }
    private static func store(_ record: RetainedFileReplacement.Record, recovery: RetainedFileReplacement.Recovery) throws -> RetainedFileReplacement.Recovery {
        try RetainedFileReplacement.save(record, in: recovery.directory)
        return .init(directory: recovery.directory, record: record, storageTarget: recovery.storageTarget)
    }
    private static func snapshot(_ bytes: Data, recovery: RetainedFileReplacement.Recovery) throws {
        let temporary = recovery.directory.appendingPathComponent("observed-" + UUID().uuidString)
        try RetainedFileReplacement.create(bytes, at: temporary)
        let source = try RetainedFileReplacement.physicalPath(temporary)
        let destination = try RetainedFileReplacement.physicalPath(recovery.displaced)
        guard renamex_np(source, destination, UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY)) == 0 else { throw RetainedFileReplacement.Failure.unsupported(errno) }
        try RetainedFileReplacement.flushDirectory(recovery.directory)
    }
    static func classify(_ recovery: RetainedFileReplacement.Recovery, source: URL, destination: URL) throws -> RetainedFileReplacement.Recovery {
        guard recovery.record.kind == "move" else { throw RetainedFileReplacement.Failure.invalidJournal }
        let prepared = try StableFileSnapshot.read(recovery.prepared)
        guard digest(prepared) == recovery.record.preparedHash else { throw RetainedFileReplacement.Failure.invalidJournal }
        if recovery.record.state == .completed {
            return try RetainedFileReplacement.classify(recovery, target: recovery.storageTarget ?? source)
        }
        if recovery.record.state == .cancelled { return recovery }
        if recovery.record.state == .conflict { return recovery }
        let original = try readIfPresent(source), current = try readIfPresent(destination)
        var record = recovery.record
        var displaced = try readIfPresent(recovery.displaced)
        if displaced == nil, original.map(digest) == record.expectedHash, current == nil {
            record.state = .cancelled
            return try store(record, recovery: recovery)
        }
        if displaced == nil, let current {
            try snapshot(current, recovery: recovery)
            displaced = current
        }
        guard let displaced else { return recovery }
        record.preparedFingerprint = try RetainedFileReplacement.fingerprint(recovery.prepared)
        record.displacedFingerprint = try RetainedFileReplacement.fingerprint(recovery.displaced)
        record.state = original == nil && displaced == prepared && current == prepared ? .completed : .conflict
        return try store(record, recovery: recovery)
    }
    static func acceptCurrentState(_ recovery: RetainedFileReplacement.Recovery, displacedHash: String?) throws {
        guard recovery.record.kind == "move", digest(try StableFileSnapshot.read(recovery.prepared)) == recovery.record.preparedHash else { throw RetainedFileReplacement.Failure.invalidJournal }
        if let displacedHash {
            try RetainedFileReplacement.acknowledge(recovery, preparedHash: recovery.record.preparedHash, displacedHash: displacedHash)
        } else {
            var info = stat()
            guard lstat(recovery.displaced.path, &info) != 0, errno == ENOENT else { throw RetainedFileReplacement.Failure.invalidJournal }
            var record = recovery.record
            record.state = .cancelled
            _ = try store(record, recovery: recovery)
        }
    }
    static func move(_ source: URL, to destination: URL, expectedHash: String, recoveryRoot: URL, operation: UUID, lease: URL,
                     observe: ((String) throws -> Void)? = nil) throws -> RetainedFileReplacement.Recovery {
        try RetainedFileRemoval.withLease(at: lease) {
            let sourcePath = try RetainedFileReplacement.physicalPath(source)
            let destinationPath = try RetainedFileReplacement.physicalPath(destination)
            guard let before = try readIfPresent(source), digest(before) == expectedHash else { throw LocalVaultDocumentStore.Failure.changed }
            guard try readIfPresent(destination) == nil else { throw CocoaError(.fileWriteFileExists) }
            guard try RetainedFileReplacement.available(source) >= Int64(before.count) * 2 + 64 * 1024 * 1024 else { throw RetainedFileReplacement.Failure.insufficientSpace }
            let storageTarget = recoveryRoot.appendingPathComponent(source.lastPathComponent)
            let directory = RetainedFileReplacement.operationDirectory(target: storageTarget, operation: operation)
            guard !FileManager.default.fileExists(atPath: directory.path) else { throw RetainedFileReplacement.Failure.invalidJournal }
            try RetainedFileReplacement.checkedDirectory(directory)
            var sourceInfo = stat(), destinationInfo = stat(), stagingInfo = stat()
            guard lstat(sourcePath, &sourceInfo) == 0, lstat(destination.deletingLastPathComponent().path, &destinationInfo) == 0,
                  lstat(directory.path, &stagingInfo) == 0, sourceInfo.st_dev == destinationInfo.st_dev,
                  sourceInfo.st_dev == stagingInfo.st_dev else { throw RetainedFileReplacement.Failure.unsupported(EXDEV) }
            var record = RetainedFileReplacement.Record(version: 1, operation: operation, filename: source.lastPathComponent,
                expectedHash: expectedHash, preparedHash: expectedHash, state: .pending)
            record.kind = "move"
            try RetainedFileReplacement.create(before, at: directory.appendingPathComponent("prepared"))
            try RetainedFileReplacement.save(record, in: directory)
            try RetainedFileReplacement.flushDirectory(directory.deletingLastPathComponent())
            try RetainedFileReplacement.flushDirectory(directory.deletingLastPathComponent().deletingLastPathComponent())
            try observe?("prepared")
            guard try readIfPresent(source).map(digest) == expectedHash else { throw RetainedFileReplacement.Failure.unresolved(directory) }
            try observe?("beforeRename")
            guard renamex_np(sourcePath, destinationPath, UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY)) == 0 else {
                if errno == EEXIST { throw CocoaError(.fileWriteFileExists) }
                throw RetainedFileReplacement.Failure.unsupported(errno)
            }
            try RetainedFileReplacement.flushDirectory(source.deletingLastPathComponent())
            try RetainedFileReplacement.flushDirectory(destination.deletingLastPathComponent())
            try observe?("moveCaptured")
            let recovery = RetainedFileReplacement.Recovery(directory: directory, record: record, storageTarget: storageTarget)
            let result = try classify(recovery, source: source, destination: destination)
            guard result.record.state == .completed else { throw RetainedFileReplacement.Failure.unresolved(directory) }
            return result
        }
    }
}
