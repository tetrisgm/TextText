import Darwin
import Foundation

/// Keeps only parsed TextPack search content. Paths and query results are still
/// enumerated and evaluated on every request so external changes and ordering
/// continue to follow the filesystem's current state.
final class LocalDocumentSearchCache: @unchecked Sendable {
    struct Key: Hashable {
        let root: String
        let path: String
    }

    struct Content {
        let markdown: String
        let hash: String
    }

    struct Fingerprint: Equatable {
        let device: UInt64
        let inode: UInt64
        let size: Int64
        let mode: UInt64
        let owner: UInt64
        let group: UInt64
        let flags: UInt64
        let modifiedSeconds: Int64
        let modifiedNanoseconds: Int64
        let changedSeconds: Int64
        let changedNanoseconds: Int64

        static func read(from url: URL) -> Fingerprint? {
            var info = stat()
            let result = url.withUnsafeFileSystemRepresentation { path -> Int32 in
                guard let path else { return -1 }
                return Darwin.lstat(path, &info)
            }
            guard result == 0, info.st_mode & S_IFMT == S_IFREG else { return nil }
            return Fingerprint(
                device: UInt64(info.st_dev), inode: UInt64(info.st_ino), size: Int64(info.st_size),
                mode: UInt64(info.st_mode), owner: UInt64(info.st_uid), group: UInt64(info.st_gid),
                flags: UInt64(info.st_flags),
                modifiedSeconds: Int64(info.st_mtimespec.tv_sec), modifiedNanoseconds: Int64(info.st_mtimespec.tv_nsec),
                changedSeconds: Int64(info.st_ctimespec.tv_sec), changedNanoseconds: Int64(info.st_ctimespec.tv_nsec))
        }
    }

    private struct Entry {
        let fingerprint: Fingerprint
        let content: Content
        let estimatedCost: Int
        var lastUse: UInt64
    }

    static let shared = LocalDocumentSearchCache(maxEstimatedCost: 32 * 1024 * 1024, maximumEntries: 5_000)

    private let maxEstimatedCost: Int
    private let maximumEntries: Int
    private let lock = NSLock()
    private var entries: [Key: Entry] = [:]
    private var estimatedCost = 0
    private var accessSequence: UInt64 = 0

    init(maxEstimatedCost: Int, maximumEntries: Int) {
        self.maxEstimatedCost = max(0, maxEstimatedCost)
        self.maximumEntries = max(0, maximumEntries)
    }

    func content(for key: Key, matching fingerprint: Fingerprint) -> Content? {
        lock.lock()
        defer { lock.unlock() }
        guard var entry = entries[key] else { return nil }
        guard entry.fingerprint == fingerprint else {
            removeUnlocked(key)
            return nil
        }
        accessSequence &+= 1
        entry.lastUse = accessSequence
        entries[key] = entry
        return entry.content
    }

    func insert(_ content: Content, for key: Key, fingerprint: Fingerprint) {
        // Four bytes per UTF-16 code unit conservatively bounds String storage,
        // including non-ASCII content, plus room for keys and entry overhead.
        let cost = content.markdown.utf16.count * 4 + key.root.utf8.count + key.path.utf8.count
            + content.hash.utf8.count + 512
        guard cost <= maxEstimatedCost, maximumEntries > 0 else { return }

        lock.lock()
        defer { lock.unlock() }
        removeUnlocked(key)
        while !entries.isEmpty && (entries.count >= maximumEntries || estimatedCost > maxEstimatedCost - cost) {
            guard let oldest = entries.min(by: { $0.value.lastUse < $1.value.lastUse })?.key else { break }
            removeUnlocked(oldest)
        }
        accessSequence &+= 1
        entries[key] = Entry(fingerprint: fingerprint, content: content, estimatedCost: cost, lastUse: accessSequence)
        estimatedCost += cost
    }

    private func removeUnlocked(_ key: Key) {
        if let removed = entries.removeValue(forKey: key) {
            estimatedCost -= removed.estimatedCost
        }
    }
}
