import Foundation
import TextTextWorkspaceCore

/// All on-disk app state, partyparty-faithful:
///   ~/Library/Application Support/TextText/   (0700)
///     credentials.json  (0600)  the linked token
///     account.json               cached workspace (offline reuse)
///     index.json                 the sync index
///     trash/                     server-deleted files land here, never rm'd
/// TEXTTEXT_STATE_DIR overrides the base dir (headless/CI isolation).
final class StateStore {
    let baseDir: URL

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init() {
        let fm = FileManager.default
        if let override = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"], !override.isEmpty {
            baseDir = URL(fileURLWithPath: (override as NSString).expandingTildeInPath, isDirectory: true)
        } else {
            let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
            baseDir = support.appendingPathComponent("TextText", isDirectory: true)
        }
        try? fm.createDirectory(at: baseDir, withIntermediateDirectories: true,
                                attributes: [.posixPermissions: 0o700])
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: baseDir.path)
        try? fm.createDirectory(at: trashDir, withIntermediateDirectories: true)
    }

    var credentialsURL: URL { baseDir.appendingPathComponent("credentials.json") }
    var accountURL: URL { baseDir.appendingPathComponent("account.json") }
    var indexURL: URL { baseDir.appendingPathComponent("index.json") }
    var trashDir: URL { baseDir.appendingPathComponent("trash", isDirectory: true) }

    // MARK: Credentials

    func loadCredentials() -> Credentials? {
        guard let data = try? Data(contentsOf: credentialsURL) else { return nil }
        return try? decoder.decode(Credentials.self, from: data)
    }

    func saveCredentials(_ credentials: Credentials) {
        guard let data = try? encoder.encode(credentials) else { return }
        try? data.write(to: credentialsURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600],
                                               ofItemAtPath: credentialsURL.path)
    }

    /// Sign out: the credential goes; the local folder and its files stay.
    /// (Server-side revoke is best effort and may not exist yet.)
    func deleteCredentials() {
        try? FileManager.default.removeItem(at: credentialsURL)
        try? FileManager.default.removeItem(at: accountURL)
    }

    // MARK: Workspace cache (offline reuse)

    func cacheWorkspace(_ data: Data) {
        try? data.write(to: accountURL, options: .atomic)
    }

    func cachedWorkspace() -> Workspace? {
        guard let data = try? Data(contentsOf: accountURL) else { return nil }
        return try? decoder.decode(Workspace.self, from: data)
    }

    // MARK: Sync index

    func loadIndex() -> SyncIndex {
        guard let data = try? Data(contentsOf: indexURL),
              let index = try? decoder.decode(SyncIndex.self, from: data) else {
            return SyncIndex()
        }
        return index
    }

    func saveIndex(_ index: SyncIndex) {
        guard let data = try? encoder.encode(index) else { return }
        if let existing = try? Data(contentsOf: indexURL), existing == data { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    func clearIndex() {
        saveIndex(SyncIndex())
    }

    /// Move a file into the state trash under a timestamped name; never lose
    /// user bytes to a server-side delete.
    @discardableResult
    func moveToTrash(_ url: URL, mover: ((URL, URL) throws -> Void)? = nil) -> URL? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return nil }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = df.string(from: Date())
        var target = trashDir.appendingPathComponent("\(stamp)-\(url.lastPathComponent)")
        var n = 2
        while fm.fileExists(atPath: target.path) {
            target = trashDir.appendingPathComponent("\(stamp)-\(n)-\(url.lastPathComponent)")
            n += 1
        }
        do {
            if let mover {
                try mover(url, target)
            } else {
                try fm.moveItem(at: url, to: target)
            }
            return target
        } catch {
            return nil
        }
    }
}
