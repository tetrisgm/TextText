import Foundation
import TextTextWorkspaceCore

/// All on-disk app state, partyparty-faithful:
///   <app group container>/TextText/           (0700)
///     credentials.json  (0600)  the linked token
///     account.json               cached workspace (offline reuse)
///     index.json                 the sync index
///     trash/                     server-deleted files land here, never rm'd
/// The group container is used because it is the one place both the Developer
/// ID and the Mac App Store editions can read; see AppGroupContainer. Without
/// one (a development build with the placeholder unsubstituted) this falls back
/// to ~/Library/Application Support/TextText, which is where every install kept
/// its state before the two editions were made to agree.
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

    init(fileManager: FileManager = .default,
         groupContainer: URL? = AppGroupContainer.resolve()) {
        let fm = fileManager
        let legacyDir = Self.legacyBaseDir(fileManager: fm)
        var migrateFromLegacy = false

        if let override = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"], !override.isEmpty {
            baseDir = URL(fileURLWithPath: (override as NSString).expandingTildeInPath, isDirectory: true)
        } else if let groupContainer {
            // The group container is the only directory both editions can read,
            // so state lives there whenever there is one.
            baseDir = groupContainer.appendingPathComponent("TextText", isDirectory: true)
            migrateFromLegacy = baseDir != legacyDir
        } else {
            baseDir = legacyDir
        }

        try? fm.createDirectory(at: baseDir, withIntermediateDirectories: true,
                                attributes: [.posixPermissions: 0o700])
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: baseDir.path)
        try? fm.createDirectory(at: trashDir, withIntermediateDirectories: true)

        if migrateFromLegacy {
            Self.adoptLegacyState(from: legacyDir, into: baseDir, fileManager: fm)
        }
    }

    /// Where state lived before the two editions were made to agree: the
    /// Developer ID build's real ~/Library/Application Support/TextText, and the
    /// Store build's sandbox-redirected copy of that same path.
    static func legacyBaseDir(fileManager fm: FileManager = .default) -> URL {
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return support.appendingPathComponent("TextText", isDirectory: true)
    }

    /// Carry state forward the first time this app runs against the group
    /// container, so nobody is signed out by an update.
    ///
    /// Copies, never moves: if this build is rolled back, the old location is
    /// still intact. Anything already present in the container wins, so a second
    /// run cannot overwrite newer state with the stale copy left behind.
    ///
    /// Only the non-sandboxed edition can read the legacy directory at all; the
    /// sandboxed one finds nothing here and moves on, which is why the Store
    /// build has to be signed in once by hand the first time.
    private static func adoptLegacyState(from legacy: URL, into destination: URL,
                                         fileManager fm: FileManager) {
        guard fm.fileExists(atPath: legacy.path) else { return }
        // Already carrying state: leave it entirely alone.
        guard !fm.fileExists(atPath: destination.appendingPathComponent("credentials.json").path) else {
            return
        }
        guard let entries = try? fm.contentsOfDirectory(
            at: legacy, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
        ) else { return }
        for entry in entries {
            let target = destination.appendingPathComponent(entry.lastPathComponent)
            guard !fm.fileExists(atPath: target.path) else { continue }
            try? fm.copyItem(at: entry, to: target)
        }
        let credentials = destination.appendingPathComponent("credentials.json")
        if fm.fileExists(atPath: credentials.path) {
            try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: credentials.path)
        }
    }

    /// The carry-forward is the part that decides whether an update signs you
    /// out, so it is reachable from the tests without a real home directory.
    static func adoptLegacyStateForTesting(from legacy: URL, into destination: URL,
                                           fileManager fm: FileManager = .default) {
        adoptLegacyState(from: legacy, into: destination, fileManager: fm)
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
