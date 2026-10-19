#if TEXTTEXT_STRESS_ACTOR
import Foundation
import CoreFoundation
import Darwin
import CryptoKit
import ZIPFoundation
import TextTextWorkspaceCore

/// Private readonly producer. Full schema authority comes exclusively from the
/// product live inspection API; this helper only inspects original archive bytes.
enum NativeStressAssetProof {
    final class NavigationCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var value: UInt64 = 0
        func changed() { lock.lock(); value += 1; lock.unlock() }
        func snapshot() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    }
    static func refusal() -> NSError {
        NSError(domain: "NativeStressAssetProof", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Readonly asset observation is unavailable or changed."])
    }
    static func hash(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
    static func request(_ value: Any) throws -> String {
        guard let value = value as? [String: Any], Set(value.keys) == ["version", "sampleId"],
              let version = value["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              let sample = value["sampleId"] as? String, UUID(uuidString: sample)?.uuidString.lowercased() == sample else { throw refusal() }
        return sample
    }
    static func safePath(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 1024 && !value.hasPrefix("/") &&
        !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 || "\\:<>\"|?*".unicodeScalars.contains($0) } &&
        value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    struct Pack {
        let archiveHash: String
        let canonicalDocument: Data
        let assets: [String: String]
    }
    /// Validate raw ZIP32 names before a library can replace malformed UTF8 or
    /// select a legacy filename encoding. Unsupported ZIP64/encryption refuses.
    private static func rawNames(_ data: Data) throws -> Set<String> {
        let bytes = [UInt8](data)
        func number(_ offset: Int, _ size: Int) throws -> Int {
            guard offset >= 0, offset <= bytes.count - size else { throw refusal() }
            return (0..<size).reduce(0) { $0 | Int(bytes[offset + $1]) << (8 * $1) }
        }
        guard bytes.count >= 22 else { throw refusal() }
        var end: Int?
        for offset in stride(from: bytes.count - 22, through: max(0, bytes.count - 65_557), by: -1) {
            if try number(offset, 4) == 0x06054b50, offset + 22 + (try number(offset + 20, 2)) == bytes.count { end = offset; break }
        }
        guard let end, try number(end + 4, 2) == 0, try number(end + 6, 2) == 0 else { throw refusal() }
        let count = try number(end + 10, 2), size = try number(end + 12, 4), start = try number(end + 16, 4)
        guard count > 0, count <= 10_000, try number(end + 8, 2) == count, start + size == end else { throw refusal() }
        var cursor = start, names = Set<String>()
        for _ in 0..<count {
            guard try number(cursor, 4) == 0x02014b50 else { throw refusal() }
            let flags = try number(cursor + 8, 2), method = try number(cursor + 10, 2)
            let length = try number(cursor + 28, 2), extra = try number(cursor + 30, 2), comment = try number(cursor + 32, 2)
            let local = try number(cursor + 42, 4), compressed = try number(cursor + 20, 4)
            guard flags & 1 == 0, [0, 8].contains(method), length > 0, cursor + 46 + length + extra + comment <= end,
                  let name = String(bytes: bytes[(cursor + 46)..<(cursor + 46 + length)], encoding: .utf8),
                  (flags & 0x800 != 0 || name.utf8.allSatisfy({ $0 < 128 })), names.insert(name).inserted,
                  try number(cursor + 34, 2) == 0, try number(local, 4) == 0x04034b50,
                  try number(local + 6, 2) == flags, try number(local + 8, 2) == method,
                  try number(local + 26, 2) == length else { throw refusal() }
            let localExtra = try number(local + 28, 2)
            guard local + 30 + length + localExtra + compressed <= start,
                  bytes[(local + 30)..<(local + 30 + length)].elementsEqual(name.utf8) else { throw refusal() }
            cursor += 46 + length + extra + comment
        }
        guard cursor == end else { throw refusal() }
        return names
    }
    private static func entries(_ bytes: Data) throws -> [String: Data] {
        guard !bytes.isEmpty, bytes.count <= 64 * 1024 * 1024 else { throw refusal() }
        let names = try rawNames(bytes)
        let archive = try Archive(data: bytes, accessMode: .read)
        var entries = [String: Data](), count = 0, total: UInt64 = 0
        for entry in archive {
            count += 1; total += entry.uncompressedSize
            let name = entry.path.hasSuffix("/") ? String(entry.path.dropLast()) : entry.path
            guard count <= 10_000, total <= 64 * 1024 * 1024, safePath(name), entry.type != .symlink,
                  entries[entry.path] == nil else { throw refusal() }
            var data = Data()
            let checksum = try archive.extract(entry) { chunk in
                guard data.count <= 64 * 1024 * 1024 - chunk.count else { throw refusal() }
                data.append(chunk)
            }
            guard data.count == entry.uncompressedSize, checksum == entry.checksum else { throw refusal() }
            entries[entry.path] = data
        }
        guard Set(entries.keys) == names else { throw refusal() }
        return entries
    }
    static func inspect(_ bytes: Data, itemId: String) throws -> Pack {
        let entries = try entries(bytes)
        let roots = entries.keys.filter { $0 == "text.md" || $0.range(of: "^[^/]+/text\\.md$", options: .regularExpression) != nil }
            .map { String($0.dropLast(7)) }.filter { entries[$0 + "document.json"] != nil }
        guard roots.count == 1, let prefix = roots.first,
              let markdown = entries[prefix + "text.md"], let text = String(data: markdown, encoding: .utf8),
              MarkdownIdentityCodec.extract(from: text)?.itemId == itemId,
              let document = entries[prefix + "document.json"], document.count <= 262_144 else { throw refusal() }
        // Do not normalize or claim a second schema validator. The caller MUST
        // compare this complete canonical value with two genuine live API reads.
        let canonical = try NativeStressLeafMove.canonicalDocument(document)
        guard let raw = try JSONSerialization.jsonObject(with: document) as? [String: Any],
              let content = raw["content"] as? [String: Any], let body = content["body"] as? String else { throw refusal() }
        let projection = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        let regex = try NSRegularExpression(pattern: "^---\\r?\\n[\\s\\S]*?\\r?\\n---[ \t]*\\r?\\n(?:\\r?\\n)?([\\s\\S]*)$")
        let match = regex.firstMatch(in: projection, range: NSRange(projection.startIndex..., in: projection))
        let projectedBody = match.flatMap { Range($0.range(at: 1), in: projection) }.map { String(projection[$0]) } ?? projection
        guard projectedBody == body else { throw refusal() }
        let headerPattern = try NSRegularExpression(pattern: "^---\\r?\\n([\\s\\S]*?)\\r?\\n---[ \t]*(?:\\r?\\n|$)")
        if let headerMatch = headerPattern.firstMatch(in: projection, range: NSRange(projection.startIndex..., in: projection)),
           let range = Range(headerMatch.range(at: 1), in: projection) {
            let header = String(projection[range])
            let titlePattern = try NSRegularExpression(pattern: "^title:[ \t]*(.*?)[ \t]*$", options: [.anchorsMatchLines])
            let titles = titlePattern.matches(in: header, range: NSRange(header.startIndex..., in: header))
            guard titles.count <= 1 else { throw refusal() }
            if let titleMatch = titles.first, let valueRange = Range(titleMatch.range(at: 1), in: header) {
                let value = String(header[valueRange])
                let title: String
                if value.hasPrefix("\"") {
                    guard let decoded = try JSONSerialization.jsonObject(with: Data(value.utf8), options: [.fragmentsAllowed]) as? String else { throw refusal() }
                    title = decoded
                } else { title = value }
                guard content["title"] as? String == title else { throw refusal() }
            }
        }
        let assets = entries.filter { $0.key.hasPrefix(prefix + "assets/") && !$0.key.hasSuffix("/") }
        guard (1...32).contains(assets.count) else { throw refusal() }
        return Pack(archiveHash: hash(bytes), canonicalDocument: canonical,
                    assets: Dictionary(uniqueKeysWithValues: assets.map { (String($0.key.dropFirst(prefix.count)), hash($0.value)) }))
    }
    private static func stamp(_ path: String) throws -> String {
        var s = stat()
        guard lstat(path, &s) == 0, s.st_mode & S_IFMT != S_IFLNK else { throw refusal() }
        return "\(s.st_dev):\(s.st_ino):\(s.st_mode):\(s.st_nlink):\(s.st_size):\(s.st_mtimespec.tv_sec):\(s.st_mtimespec.tv_nsec):\(s.st_ctimespec.tv_sec):\(s.st_ctimespec.tv_nsec)"
    }
    static func requireUnique(root: URL, itemId: String, relativePath: String) throws {
        var visited = 0, bytesRead = 0, matches = [String]()
        func scan(_ directory: URL, _ prefix: String) throws {
            let before = try stamp(directory.path)
            for name in try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted() {
                if prefix.isEmpty && name == ".texttext" { continue }
                visited += 1; guard visited <= 10_000 else { throw refusal() }
                let path = prefix.isEmpty ? name : prefix + "/" + name
                let url = directory.appendingPathComponent(name)
                var type = stat(); guard lstat(url.path, &type) == 0, type.st_mode & S_IFMT != S_IFLNK else { throw refusal() }
                if type.st_mode & S_IFMT == S_IFDIR { try scan(url, path) }
                else if name.lowercased().hasSuffix(".textpack") {
                    let bytes = try read(root: root, relativePath: path)
                    bytesRead += bytes.count; guard bytesRead <= 256 * 1024 * 1024 else { throw refusal() }
                    let values = try entries(bytes)
                    let roots = values.keys.filter { $0 == "text.md" || $0.range(of: "^[^/]+/text\\.md$", options: .regularExpression) != nil }
                        .map { String($0.dropLast(7)) }.filter { values[$0 + "document.json"] != nil }
                    guard roots.count == 1, let prefix = roots.first, let markdown = values[prefix + "text.md"],
                          let text = String(data: markdown, encoding: .utf8), let identity = MarkdownIdentityCodec.extract(from: text)?.itemId else { throw refusal() }
                    if identity == itemId { matches.append(path) }
                }
            }
            guard try stamp(directory.path) == before else { throw refusal() }
        }
        try scan(root, "")
        guard matches == [relativePath] else { throw refusal() }
    }
    static func read(root: URL, relativePath: String) throws -> Data {
        guard safePath(relativePath), relativePath.hasSuffix(".textpack") else { throw refusal() }
        var url = root, ancestors = [(String, String)]()
        for component in relativePath.split(separator: "/") {
            ancestors.append((url.path, try stamp(url.path)))
            var directory = stat(); guard lstat(url.path, &directory) == 0, directory.st_mode & S_IFMT == S_IFDIR else { throw refusal() }
            url.appendPathComponent(String(component))
        }
        let before = try stamp(url.path), fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw refusal() }; defer { close(fd) }
        var held = stat(), named = stat()
        guard fstat(fd, &held) == 0, lstat(url.path, &named) == 0,
              held.st_mode & S_IFMT == S_IFREG, held.st_nlink == 1, held.st_size > 0, held.st_size <= 64 * 1024 * 1024,
              held.st_dev == named.st_dev, held.st_ino == named.st_ino else { throw refusal() }
        let data = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).read(upToCount: 64 * 1024 * 1024 + 1) ?? Data()
        var after = stat()
        guard fstat(fd, &after) == 0, after.st_size == held.st_size, after.st_mtimespec.tv_sec == held.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == held.st_mtimespec.tv_nsec,
              after.st_ctimespec.tv_sec == held.st_ctimespec.tv_sec, after.st_ctimespec.tv_nsec == held.st_ctimespec.tv_nsec, data.count == held.st_size, try stamp(url.path) == before,
              try ancestors.allSatisfy({ try stamp($0.0) == $0.1 }) else { throw refusal() }
        return data
    }
}
#endif
