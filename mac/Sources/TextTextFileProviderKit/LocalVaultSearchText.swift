import CryptoKit
import Foundation
import ZIPFoundation

extension LocalVaultDocumentStore {
    /// Search reads only Markdown and package metadata. Attachments are never
    /// inflated, and a search never adds a revision to the recovery history.
    public func searchText(path: String, maximumTextBytes: Int = 2 * 1024 * 1024) throws -> (markdown: String, hash: String) {
        let source = try url(for: path)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".textpack")
        defer { try? FileManager.default.removeItem(at: temporary) }
        var result: Result<Void, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { source in
            result = Result {
                let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                guard FileManager.default.createFile(atPath: temporary.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
                let input = try FileHandle(forReadingFrom: source)
                let output = try FileHandle(forWritingTo: temporary)
                defer { try? input.close(); try? output.close() }
                var copied = 0
                while let bytes = try input.read(upToCount: 64 * 1024), !bytes.isEmpty {
                    copied += bytes.count
                    guard copied <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                    try output.write(contentsOf: bytes)
                }
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw CocoaError(.fileReadUnknown) }
        try result.get()
        let archive = try Archive(url: temporary, accessMode: .read)
        var markdownEntries: [Entry] = []
        var entryCount = 0
        for entry in archive {
            entryCount += 1
            let parts = entry.path.split(separator: "/", omittingEmptySubsequences: true)
            guard entryCount <= TextTextTextBundlePackage.maximumEntryCount, entry.type != .symlink,
                  !entry.path.hasPrefix("/"), !entry.path.contains("\\"),
                  !parts.contains(where: { $0 == "." || $0 == ".." }) else { throw Failure.invalidPath }
            if parts.count <= 2 && parts.last == "text.md" {
                markdownEntries.append(entry)
            }
        }
        let roots = markdownEntries.filter { $0.path == "text.md" }
        let candidates = roots.isEmpty ? markdownEntries : roots
        guard candidates.count == 1, let entry = candidates.first, entry.type == .file else { throw Failure.invalidPath }
        guard entry.uncompressedSize <= UInt64(max(0, maximumTextBytes)) else { throw Failure.tooLarge }
        let infoPath = String(entry.path.dropLast("text.md".count)) + "info.json"
        guard let infoEntry = archive[infoPath], infoEntry.type == .file,
              infoEntry.uncompressedSize <= 256 * 1024 else { throw Failure.invalidPath }
        var metadata = Data()
        _ = try archive.extract(infoEntry) { chunk in
            guard metadata.count <= 256 * 1024 - chunk.count else { throw Failure.tooLarge }
            metadata.append(chunk)
        }
        let info = try JSONDecoder().decode(TextTextTextBundleInfo.self, from: metadata)
        guard info.version == 2, info.type == "net.daringfireball.markdown" else { throw Failure.invalidPath }
        var text = Data()
        _ = try archive.extract(entry) { chunk in
            guard text.count <= maximumTextBytes - chunk.count else { throw Failure.tooLarge }
            text.append(chunk)
        }
        guard let markdown = String(data: text, encoding: .utf8) else { throw Failure.invalidPath }
        let handle = try FileHandle(forReadingFrom: temporary)
        defer { try? handle.close() }
        var digest = SHA256()
        var total = 0
        while let bytes = try handle.read(upToCount: 64 * 1024), !bytes.isEmpty {
            total += bytes.count
            guard total <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
            digest.update(data: bytes)
        }
        return (markdown, digest.finalize().map { String(format: "%02x", $0) }.joined())
    }
}
