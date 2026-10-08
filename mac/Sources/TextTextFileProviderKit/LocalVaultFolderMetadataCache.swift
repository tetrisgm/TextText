import Foundation
import Darwin
import ZIPFoundation

/// Metadata and negative lookups only. Archive bytes never survive a read.
enum LocalVaultFolderMetadataCache {
    private struct Entry { let fingerprint: String; let value: [String: String]?; let cost: Int }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var entries: [String: Entry] = [:]
    nonisolated(unsafe) private static var order: [String] = []
    nonisolated(unsafe) private static var cost = 0
    nonisolated(unsafe) private static var reads = 0
    static var archiveReads: Int { lock.lock(); defer { lock.unlock() }; return reads }
    private static func fingerprint(_ url: URL) throws -> String {
        var info = stat()
        guard lstat(url.path, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { throw LocalVaultDocumentStore.Failure.invalidPath }
        guard info.st_size <= 64 * 1024 * 1024 else { throw LocalVaultDocumentStore.Failure.tooLarge }
        return "\(info.st_dev):\(info.st_ino):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec):\(info.st_ctimespec.tv_sec):\(info.st_ctimespec.tv_nsec)"
    }
    static func read(_ url: URL) throws -> [String: String]? {
        lock.lock(); defer { lock.unlock() }
        let key = url.path, stamp = try fingerprint(url)
        if let entry = entries[key], entry.fingerprint == stamp { return entry.value }
        let bytes = try Data(contentsOf: url)
        guard bytes.count <= 64 * 1024 * 1024 else { throw LocalVaultDocumentStore.Failure.tooLarge }
        reads += 1
        var value: [String: String]?
        if let archive = try? Archive(data: bytes, accessMode: .read) {
            var selected: [String: Data] = [:], expanded: UInt64 = 0
            for entry in archive where ["document.json", "template.json"].contains((entry.path as NSString).lastPathComponent) {
                expanded += entry.uncompressedSize
                guard expanded <= 4 * 1024 * 1024, selected[entry.path] == nil else { throw LocalVaultDocumentStore.Failure.tooLarge }
                var data = Data()
                _ = try archive.extract(entry) { data.append($0) }
                selected[entry.path] = data
            }
            let documents = selected.keys.filter { ($0 as NSString).lastPathComponent == "document.json" }
            if documents.count == 1, let documentKey = documents.first, let raw = selected[documentKey],
               let document = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
               let content = document["content"] as? [String: Any], let fields = content["fields"] as? [String: Any],
               fields["texttextFolderView"] != nil {
                value = ["hash": TextTextStableDigest.sha256Hex(bytes), "documentJSON": String(decoding: raw, as: UTF8.self)]
                if let template = selected[String(documentKey.dropLast("document.json".count)) + "template.json"] { value?["templateJSON"] = String(decoding: template, as: UTF8.self) }
            }
        }
        guard try fingerprint(url) == stamp else { throw LocalVaultDocumentStore.Failure.changed }
        let size = (value?.values.reduce(0) { $0 + $1.utf8.count } ?? 0) + key.utf8.count + stamp.utf8.count
        if let old = entries.removeValue(forKey: key) { cost -= old.cost; order.removeAll { $0 == key } }
        while !order.isEmpty && (entries.count >= 16_384 || cost + size > 16 * 1024 * 1024) {
            let oldest = order.removeFirst(); if let old = entries.removeValue(forKey: oldest) { cost -= old.cost }
        }
        if size <= 16 * 1024 * 1024 { entries[key] = Entry(fingerprint: stamp, value: value, cost: size); order.append(key); cost += size }
        return value
    }
}
