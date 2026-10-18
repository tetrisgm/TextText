import Foundation
import Darwin
import TextTextWorkspaceCore

/// Private recovery journal for a replacement. Store integration must call
/// assertReadable before normal reads, writes and idempotent acknowledgement.
/// Caller must serialize operations for the target using its existing store
/// coordination. No artifact is automatically removed: an external descriptor may still
/// be writing the displaced inode after the exchange.
enum RetainedFileReplacement {
    private final class ManifestCache: @unchecked Sendable {
        let lock = NSLock()
        var values: [String: (String, Recovery)] = [:]
        var names: [String: String] = [:]
    }
    private static let cache = ManifestCache()
    enum State: String, Codable { case pending, conflict, completed, cancelled }
    struct Record: Codable, Equatable {
        let version: Int
        let operation: UUID
        let filename: String
        let expectedHash: String
        let preparedHash: String
        var state: State
        var preparedFingerprint: String? = nil
        var displacedFingerprint: String? = nil
        var acknowledgedDisplacedHash: String? = nil
        var kind: String? = nil
    }
    struct Recovery {
        let directory: URL
        let record: Record
        var storageTarget: URL?
        let prepared: URL
        let displaced: URL
        let directoryBasePath: String
        let storageBasePath: String?
        init(directory: URL, record: Record, storageTarget: URL? = nil) {
            self.directory = directory; self.record = record; self.storageTarget = storageTarget
            self.directoryBasePath = directory.deletingLastPathComponent().path
            self.storageBasePath = storageTarget.map { RetainedFileReplacement.base($0).path }
            self.prepared = directory.appendingPathComponent("prepared")
            self.displaced = directory.appendingPathComponent("exchange")
        }
    }
    struct Layout {
        let target: URL
        let canonicalTarget: URL
        let basePath: String
    }
    static func layout(target: URL) throws -> Layout {
        let targetPath = try physicalPath(target)
        return Layout(target: target, canonicalTarget: URL(fileURLWithPath: targetPath), basePath: (targetPath as NSString).deletingLastPathComponent + "/.texttext-replacements/" + nameHash(target.lastPathComponent))
    }
    enum Failure: Error, LocalizedError {
        case unresolved(URL), invalidJournal, unsupported(Int32), insufficientSpace
        var errorDescription: String? {
            switch self {
            case .insufficientSpace: return "There is not enough storage to preserve both file versions. Free space and retry."
            case .unresolved: return "A file replacement needs review. Open Recovery to inspect both saved versions."
            case .unsupported: return "This folder cannot safely retain both file versions during replacement."
            case .invalidJournal: return "The file recovery record is unavailable or needs a newer TextText version. Saved files are preserved."
            }
        }
    }

    private static func digest(_ bytes: Data) -> String { TextTextStableDigest.sha256Hex(bytes) }
    private static func nameHash(_ filename: String) -> String {
        cache.lock.lock()
        let known = cache.names[filename]
        cache.lock.unlock()
        if let known { return known }
        let hash = digest(Data(filename.utf8))
        cache.lock.lock()
        if cache.names.count >= 2048 { cache.names.removeAll(keepingCapacity: true) }
        cache.names[filename] = hash
        cache.lock.unlock()
        return hash
    }
    private static func validHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    static func fingerprint(_ url: URL) throws -> String { try fingerprint(path: url.path) }
    private static func fingerprint(path: String) throws -> String {
        var info = stat()
        guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { throw Failure.invalidJournal }
        return "\(info.st_dev):\(info.st_ino):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec):\(info.st_ctimespec.tv_sec):\(info.st_ctimespec.tv_nsec)"
    }
    static func physicalPath(_ url: URL) throws -> String {
        guard let parent = realpath(url.deletingLastPathComponent().path, nil) else { throw POSIXError(.ENOENT) }
        defer { free(parent) }
        return String(cString: parent) + "/" + url.lastPathComponent
    }
    private static func validateOperationDirectory(_ directory: URL, target: URL, operation: UUID) throws {
        guard let actual = realpath(directory.path, nil) else { throw Failure.invalidJournal }
        defer { free(actual) }
        let targetPath = try physicalPath(target)
        let parent = (targetPath as NSString).deletingLastPathComponent
        let expected = parent + "/.texttext-replacements/" + nameHash(target.lastPathComponent) + "/" + operation.uuidString
        guard String(cString: actual) == expected else { throw Failure.invalidJournal }
    }
    private static func base(_ target: URL) -> URL {
        target.deletingLastPathComponent().appendingPathComponent(".texttext-replacements", isDirectory: true)
            .appendingPathComponent(nameHash(target.lastPathComponent), isDirectory: true)
    }
    static func operationDirectory(target: URL, operation: UUID) -> URL {
        base(target).appendingPathComponent(operation.uuidString, isDirectory: true)
    }
    static func checkedDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        guard url.standardizedFileURL.path == url.resolvingSymlinksInPath().standardizedFileURL.path else { throw Failure.invalidJournal }
    }
    static func flushDirectory(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw POSIXError(.EIO) }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    }
    static func create(_ bytes: Data, at url: URL) throws {
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { close(fd) }
        try bytes.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw POSIXError(.EIO) }
                offset += count
            }
        }
        guard fsync(fd) == 0 else { throw POSIXError(.EIO) }
    }
    private static func stageExchange(prepared: URL, exchange: URL, bytes: Data) throws {
        if clonefile(try physicalPath(prepared), try physicalPath(exchange), UInt32(CLONE_NOFOLLOW)) == 0 {
            let handle = try FileHandle(forWritingTo: exchange)
            defer { try? handle.close() }
            try handle.synchronize()
            return
        }
        let code = errno
        guard [ENOTSUP, EXDEV, EINVAL, ENOSYS].contains(code) else { throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO) }
        try create(bytes, at: exchange)
    }
    static func available(_ target: URL) throws -> Int64 {
        let values = try target.deletingLastPathComponent().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey])
        guard let capacity = values.volumeAvailableCapacityForImportantUsage ?? values.volumeAvailableCapacity.map(Int64.init) else { throw POSIXError(.EIO) }
        return capacity
    }
    private static func preserveMetadata(from target: URL, to exchange: URL, preparedHash: String) throws {
        let source = open(target.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard source >= 0 else { throw POSIXError(.EIO) }
        defer { close(source) }
        var sourceInfo = stat()
        guard fstat(source, &sourceInfo) == 0, sourceInfo.st_mode & S_IFMT == S_IFREG else { throw Failure.invalidJournal }
        let destination = open(exchange.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
        guard destination >= 0 else { throw POSIXError(.EIO) }
        defer { close(destination) }
        guard fcopyfile(source, destination, nil, copyfile_flags_t(COPYFILE_METADATA)) == 0,
              fsync(destination) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        guard digest(try StableFileSnapshot.read(exchange)) == preparedHash else { throw Failure.invalidJournal }
    }
    static func save(_ record: Record, in directory: URL) throws {
        let temporary = directory.appendingPathComponent("manifest-" + UUID().uuidString)
        try create(JSONEncoder().encode(record), at: temporary)
        guard rename(temporary.path, directory.appendingPathComponent("manifest.json").path) == 0 else { throw POSIXError(.EIO) }
        try flushDirectory(directory)
    }

    /// Inspection never changes the document or retries a replacement. Unknown
    /// or partially written operation directories fail closed.
    static func inspect(_ target: URL) throws -> [Recovery] {
        let directory = base(target)
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else { throw Failure.invalidJournal }
        let operations = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        return try operations.map { operation in
            guard let id = UUID(uuidString: operation.lastPathComponent) else { throw Failure.invalidJournal }
            return try recovery(target: target, operation: id)
        }
    }
    static func recovery(target: URL, operation: UUID, layout knownLayout: Layout? = nil) throws -> Recovery {
            let layout = try knownLayout ?? Self.layout(target: target)
            guard layout.target.path == target.path else { throw Failure.invalidJournal }
            let directoryPath = layout.basePath + "/" + operation.uuidString
            guard let actual = realpath(directoryPath, nil) else { throw Failure.invalidJournal }
            defer { free(actual) }
            guard String(cString: actual) == directoryPath else { throw Failure.invalidJournal }
            let manifestPath = directoryPath + "/manifest.json"
            let stamp = try fingerprint(path: manifestPath)
            cache.lock.lock()
            let cached = cache.values[manifestPath]
            cache.lock.unlock()
            if let cached, cached.0 == stamp { return cached.1 }
            let directory = URL(fileURLWithPath: directoryPath, isDirectory: true)
            let manifest = URL(fileURLWithPath: manifestPath)
            let bytes = try StableFileSnapshot.read(manifest, maximumBytes: 4096)
            guard stamp == (try fingerprint(path: manifestPath)) else { throw Failure.invalidJournal }
            let record = try JSONDecoder().decode(Record.self, from: bytes)
            guard record.version == 1, record.filename == target.lastPathComponent,
                  record.operation == operation,
                  validHash(record.expectedHash), validHash(record.preparedHash),
                  record.acknowledgedDisplacedHash.map(validHash) ?? true,
                  (record.kind == nil || record.kind == "removal"),
                  (record.state != .cancelled || record.kind == "removal") else { throw Failure.invalidJournal }
            let result = Recovery(directory: directory, record: record, storageTarget: layout.canonicalTarget)
            cache.lock.lock()
            if cache.values.count >= 2048 { cache.values.removeAll(keepingCapacity: true) }
            cache.values[manifestPath] = (stamp, result)
            cache.lock.unlock()
            return result
    }
    static func assertReadable(_ target: URL) throws {
        for recovery in try inspect(target) {
            let checked = recovery.record.state == .completed ? try classify(recovery, target: target) : recovery
            if checked.record.state != .completed && checked.record.state != .cancelled { throw Failure.unresolved(checked.directory) }
        }
    }

    /// Reconstruct after a process interruption. Only exact retained bytes plus
    /// exact current projection prove completion. All other cases stay fenced.
    @discardableResult static func classify(_ recovery: Recovery, target: URL) throws -> Recovery {
        guard recovery.directoryBasePath == (recovery.storageBasePath ?? base(target).path),
              recovery.record.filename == target.lastPathComponent else { throw Failure.invalidJournal }
        guard recovery.record.state != .conflict else { return recovery }
        var record = recovery.record
        if record.kind == "removal" && (record.state == .pending || record.state == .cancelled) {
            var actual = stat()
            let noExchange = lstat(recovery.displaced.path, &actual) != 0 && errno == ENOENT
            if record.state == .cancelled {
                guard noExchange, digest(try StableFileSnapshot.read(recovery.prepared)) == record.preparedHash else { throw Failure.invalidJournal }
                return recovery
            }
            if noExchange {
                guard digest(try StableFileSnapshot.read(recovery.prepared)) == record.preparedHash else { throw Failure.invalidJournal }
                if let current = try? StableFileSnapshot.read(target), digest(current) == record.expectedHash {
                    record.state = .cancelled
                    try save(record, in: recovery.directory)
                    return Recovery(directory: recovery.directory, record: record, storageTarget: recovery.storageTarget)
                }
                // No capture occurred. Keep refusing without sealing an
                // irreversible conflict; exact restoration may cancel safely.
                return recovery
            }
        }
        let preparedBefore = try fingerprint(recovery.prepared)
        let displacedBefore = try? fingerprint(recovery.displaced)
        if record.state == .completed, record.preparedFingerprint == preparedBefore,
           record.displacedFingerprint != nil, record.displacedFingerprint == displacedBefore { return recovery }
        let prepared = try StableFileSnapshot.read(recovery.prepared)
        guard digest(prepared) == record.preparedHash,
              preparedBefore == (try fingerprint(recovery.prepared)) else { throw Failure.invalidJournal }
        record.preparedFingerprint = preparedBefore
        let displaced = try? StableFileSnapshot.read(recovery.displaced)
        let displacedAfter = try? fingerprint(recovery.displaced)
        guard displacedBefore != nil, displacedBefore == displacedAfter else {
            record.state = .conflict
            try save(record, in: recovery.directory)
            return Recovery(directory: recovery.directory, record: record, storageTarget: recovery.storageTarget)
        }
        record.displacedFingerprint = displacedAfter
        if record.state == .completed {
            // A descriptor opened before the swap can keep editing this inode.
            // Do not require the target to retain this operation's bytes: later
            // legitimate saves may already have advanced the visible document.
            if displaced.map(digest) == (record.acknowledgedDisplacedHash ?? record.expectedHash) {
                try save(record, in: recovery.directory)
                return Recovery(directory: recovery.directory, record: record, storageTarget: recovery.storageTarget)
            }
            record.state = .conflict
            try save(record, in: recovery.directory)
            return Recovery(directory: recovery.directory, record: record, storageTarget: recovery.storageTarget)
        }
        let current = try? StableFileSnapshot.read(target)
        var targetInfo = stat()
        let absent = lstat(target.path, &targetInfo) != 0 && errno == ENOENT
        if displaced.map(digest) == record.expectedHash && (record.kind == "removal" ? absent : current.map(digest) == record.preparedHash) {
            record.state = .completed
        } else {
            record.state = .conflict
        }
        try save(record, in: recovery.directory)
        return Recovery(directory: recovery.directory, record: record, storageTarget: recovery.storageTarget)
    }

    /// Explicit consent follows retained-copy export and exact observed hashes.
    /// Persist the attested retained version so a later save can proceed while
    /// any subsequent old-descriptor write still reopens the fence.
    static func acknowledge(_ recovery: Recovery, preparedHash: String, displacedHash: String) throws {
        let preparedStamp = try fingerprint(recovery.prepared), displacedStamp = try fingerprint(recovery.displaced)
        guard recovery.record.preparedHash == preparedHash,
              digest(try StableFileSnapshot.read(recovery.prepared)) == preparedHash,
              digest(try StableFileSnapshot.read(recovery.displaced)) == displacedHash,
              preparedStamp == (try fingerprint(recovery.prepared)),
              displacedStamp == (try fingerprint(recovery.displaced)) else { throw Failure.invalidJournal }
        var record = recovery.record
        record.acknowledgedDisplacedHash = displacedHash
        record.preparedFingerprint = preparedStamp
        record.displacedFingerprint = displacedStamp
        record.state = .completed
        try save(record, in: recovery.directory)
    }

    /// The target must already exist. Missing targets and unsupported swap
    /// capability refuse without an overwrite fallback. Hook models process
    /// interruption, including the window after the atomic swap.
    static func replace(_ target: URL, expectedHash: String, prepared: Data,
                        operation: UUID = UUID(),
                        recoveryRoot: URL? = nil,
                        availableBytes: (() throws -> Int64)? = nil,
                        observe: ((String) throws -> Void)? = nil) throws -> Recovery {
        try assertReadable(target)
        guard prepared.count <= 64 * 1024 * 1024,
              digest(try StableFileSnapshot.read(target)) == expectedHash else { throw LocalVaultDocumentStore.Failure.changed }
        // Reserve conservative full-copy fallback space plus room for recovery
        // journals before staging. APFS clones usually share data blocks.
        guard try (availableBytes?() ?? available(target)) >= Int64(prepared.count) * 2 + 64 * 1024 * 1024 else { throw Failure.insufficientSpace }
        let storageTarget = recoveryRoot?.appendingPathComponent(target.lastPathComponent) ?? target
        let directory = operationDirectory(target: storageTarget, operation: operation)
        try checkedDirectory(directory)
        // Cross-volume exchange cannot preserve the original inode atomically.
        // Reject before staging or touching the visible target.
        var sourceInfo = stat(), stagingInfo = stat()
        let sourceFD = open(target.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard sourceFD >= 0 else { throw Failure.invalidJournal }
        defer { close(sourceFD) }
        guard fstat(sourceFD, &sourceInfo) == 0, lstat(directory.path, &stagingInfo) == 0,
              sourceInfo.st_dev == stagingInfo.st_dev else { throw Failure.unsupported(EXDEV) }
        let record = Record(version: 1, operation: operation, filename: target.lastPathComponent,
                            expectedHash: expectedHash, preparedHash: digest(prepared), state: .pending)
        try create(prepared, at: directory.appendingPathComponent("prepared"))
        try stageExchange(prepared: directory.appendingPathComponent("prepared"), exchange: directory.appendingPathComponent("exchange"), bytes: prepared)
        try preserveMetadata(from: target, to: directory.appendingPathComponent("exchange"), preparedHash: record.preparedHash)
        try save(record, in: directory)
        try flushDirectory(directory.deletingLastPathComponent())
        try flushDirectory(directory.deletingLastPathComponent().deletingLastPathComponent())
        try flushDirectory(target.deletingLastPathComponent())
        try observe?("prepared")
        guard digest(try StableFileSnapshot.read(target)) == expectedHash else { throw Failure.unresolved(directory) }
        try observe?("beforeSwap")
        let exchange = directory.appendingPathComponent("exchange")
        guard renamex_np(try physicalPath(exchange), try physicalPath(target), UInt32(RENAME_SWAP | RENAME_NOFOLLOW_ANY)) == 0 else {
            throw Failure.unsupported(errno)
        }
        try flushDirectory(target.deletingLastPathComponent())
        try flushDirectory(directory)
        try observe?("swapped")
        let result = try classify(Recovery(directory: directory, record: record, storageTarget: storageTarget), target: target)
        guard result.record.state == .completed else { throw Failure.unresolved(directory) }
        return result
    }
}
