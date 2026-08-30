import Foundation

/// All on-disk app state, partyparty-faithful:
///   <app group container>/TextText/           (0700)
///     credentials.json  (0600)  the linked token
///     account.json               cached workspace (offline reuse)
/// The group container is used because it is the one place both the Developer
/// ID and the Mac App Store editions can read; see AppGroupContainer. Without
/// one (a development build with the placeholder unsubstituted) this falls back
/// to ~/Library/Application Support/TextText, which is where every install kept
/// its state before the two editions were made to agree.
/// TEXTTEXT_STATE_DIR overrides the base dir (headless/CI isolation).
final class StateStore {
    let baseDir: URL
    private let cliCredentialsURL: URL?

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
         groupContainer: URL? = AppGroupContainer.resolve(),
         cliCredentialsURL: URL? = StateStore.defaultCLICredentialsURL()) {
        let fm = fileManager
        let legacyDir = Self.legacyBaseDir(fileManager: fm)
        var migrateFromLegacy = false

        self.cliCredentialsURL = cliCredentialsURL

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

    /// The standalone app hands its current device credential to the bundled
    /// CLI at one stable, private path. The CLI cannot read the app-group
    /// container from an ordinary shell process. Store builds do not ship the
    /// CLI, so they must not create this handoff file.
    static func defaultCLICredentialsURL(
        fileManager fm: FileManager = .default
    ) -> URL? {
        #if TEXTTEXT_STORE
        return nil
        #else
        let environment = ProcessInfo.processInfo.environment
        if let explicit = environment["TEXTTEXT_CREDENTIALS_PATH"], !explicit.isEmpty {
            return URL(fileURLWithPath: (explicit as NSString).expandingTildeInPath)
        }
        // An isolated state directory is used by tests and headless tooling.
        // It must never leak a fixture credential into the signed-in user's
        // real Application Support directory.
        if let isolatedState = environment["TEXTTEXT_STATE_DIR"], !isolatedState.isEmpty {
            return nil
        }
        return legacyBaseDir(fileManager: fm).appendingPathComponent("credentials.json")
        #endif
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

    // MARK: Credentials

    func loadCredentials() -> Credentials? {
        guard let data = try? Data(contentsOf: credentialsURL),
              let credentials = try? decoder.decode(Credentials.self, from: data) else {
            return nil
        }
        // Upgrades must work without forcing a sign-out/relink. Existing users
        // may already have the current credential only in the app-group state
        // directory, so refresh the standalone CLI handoff whenever the app
        // successfully reads its authoritative credential.
        mirrorCredentialsForCLI(data)
        return credentials
    }

    func saveCredentials(_ credentials: Credentials) {
        guard let data = try? encoder.encode(credentials) else { return }
        try? data.write(to: credentialsURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600],
                                               ofItemAtPath: credentialsURL.path)
        mirrorCredentialsForCLI(data)
    }

    /// Sign out: the credential goes; the local folder and its files stay.
    /// (Server-side revoke is best effort and may not exist yet.)
    func deleteCredentials() {
        try? FileManager.default.removeItem(at: credentialsURL)
        if let cliCredentialsURL,
           cliCredentialsURL.standardizedFileURL != credentialsURL.standardizedFileURL {
            try? FileManager.default.removeItem(at: cliCredentialsURL)
        }
        try? FileManager.default.removeItem(at: accountURL)
    }

    private func mirrorCredentialsForCLI(_ data: Data) {
        guard let cliCredentialsURL,
              cliCredentialsURL.standardizedFileURL != credentialsURL.standardizedFileURL else {
            return
        }
        let fm = FileManager.default
        let directory = cliCredentialsURL.deletingLastPathComponent()
        do {
            try fm.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            try data.write(to: cliCredentialsURL, options: .atomic)
            try fm.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: cliCredentialsURL.path
            )
        } catch {
            // Never leave a previous device token behind after relinking. The
            // app remains linked through its authoritative state store, while
            // the CLI fails closed until a later successful handoff.
            try? fm.removeItem(at: cliCredentialsURL)
        }
    }

    // MARK: Workspace cache (offline reuse)

    func cacheWorkspace(_ data: Data) {
        try? data.write(to: accountURL, options: .atomic)
    }

    func cachedWorkspace() -> Workspace? {
        guard let data = try? Data(contentsOf: accountURL) else { return nil }
        return try? decoder.decode(Workspace.self, from: data)
    }

}
