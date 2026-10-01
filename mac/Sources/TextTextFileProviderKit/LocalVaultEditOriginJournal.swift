import Foundation

/// Records revisions saved through the native editor. The file is local
/// metadata, not part of a TextPack or an assertion supplied by web content.
/// Sync and the editor use the same lock so staging cannot observe a native
/// save before its revision has been recorded.
public struct LocalVaultEditOriginJournal: Sendable {
    private static let lock = NSRecursiveLock()
    private let root: URL
    private let directory: URL
    private let file: URL

    public init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        directory = self.root.appendingPathComponent(".texttext/sync", isDirectory: true)
        file = directory.appendingPathComponent("native-edits.json")
    }

    public func withLock<T>(_ body: () throws -> T) rethrows -> T {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        return try body()
    }

    /// The marker identifies the final saved revision, not every edit that
    /// contributed to it before the next sync pass.
    public func recordingNativeSave(
        _ save: () throws -> LocalVaultDocumentStore.Document
    ) throws -> LocalVaultDocumentStore.Document {
        try withLock {
            let document = try save()
            try validate(path: document.path, hash: document.hash)
            var entries = try read()
            entries[document.path] = document.hash
            try write(entries)
            return document
        }
    }

    /// Called while holding `withLock` around the exact bytes being staged.
    public func isNativeSave(path: String, hash: String) throws -> Bool {
        try validate(path: path, hash: hash)
        return try read()[path] == hash
    }

    private func validate(path: String, hash: String) throws {
        _ = try LocalVaultDocumentStore(root: root).url(for: path)
        guard hash.count == 64, hash.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else {
            throw LocalVaultSyncFailure.invalidResponse
        }
    }

    private func read() throws -> [String: String] {
        guard directory.resolvingSymlinksInPath().path == directory.path,
              file.resolvingSymlinksInPath().path == file.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
        let data = try Data(contentsOf: file)
        guard data.count <= 4 * 1024 * 1024 else { throw LocalVaultSyncFailure.invalidResponse }
        return try JSONDecoder().decode([String: String].self, from: data)
    }

    private func write(_ entries: [String: String]) throws {
        guard entries.count <= 20_000,
              directory.resolvingSymlinksInPath().path == directory.path,
              file.resolvingSymlinksInPath().path == file.path else { throw LocalVaultSyncFailure.invalidResponse }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(entries)
        guard data.count <= 4 * 1024 * 1024 else { throw LocalVaultSyncFailure.invalidResponse }
        try data.write(to: file, options: .atomic)
        let handle = try FileHandle(forWritingTo: file)
        try handle.synchronize()
        try handle.close()
    }
}
