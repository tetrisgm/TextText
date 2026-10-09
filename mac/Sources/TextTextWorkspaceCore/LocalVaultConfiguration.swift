import Foundation
import Darwin

/// The app and CLI share a selected ordinary directory. Content stays in that
/// directory; this small preference only remembers where to open it.
public struct LocalVaultConfiguration: Codable, Sendable, Equatable {
    public let rootPath: String
    public let bookmarkData: Data?
    public var root: URL { URL(fileURLWithPath: rootPath, isDirectory: true) }

    public init(rootPath: String, bookmarkData: Data?) {
        self.rootPath = rootPath
        self.bookmarkData = bookmarkData
    }

    public func resolvingRoot() throws -> URL {
        guard let bookmarkData else { return root }
        var stale = false
        return try URL(resolvingBookmarkData: bookmarkData, options: [.withSecurityScope],
                       relativeTo: nil, bookmarkDataIsStale: &stale)
    }

    public static func configurationURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        applicationSupportDirectory: URL? = nil
    ) -> URL {
        if let path = environment["TEXTTEXT_VAULT_CONFIG"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        let support = applicationSupportDirectory
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support.appendingPathComponent("TextText/vault.json")
    }

    /// Read the container's current config first. The one pre-container
    /// location is considered only when the current config is absent; it is
    /// copied, never moved or deleted. Explicit overrides are exact paths and
    /// never fall through to migration or another location.
    public static func load(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        applicationSupportDirectory: URL? = nil,
        legacyConfigurationURL: URL? = nil,
        allowUnscopedRootFallback: Bool = false,
        readData: (URL) throws -> Data = { try Data(contentsOf: $0) },
        resolveBookmark: BookmarkResolver = defaultBookmarkResolver,
        makeBookmark: BookmarkMaker = defaultBookmarkMaker
    ) throws -> Self? {
        let hasExplicitOverride = environment["TEXTTEXT_VAULT_CONFIG"].map { !$0.isEmpty } ?? false
        let currentURL = configurationURL(
            environment: environment,
            fileManager: fileManager,
            applicationSupportDirectory: applicationSupportDirectory
        )

        do {
            let data = try readData(currentURL)
            let (configuration, refreshed) = try validatedConfiguration(
                from: data, at: currentURL, fileManager: fileManager,
                resolveBookmark: resolveBookmark, makeBookmark: makeBookmark,
                allowUnscopedRootFallback: allowUnscopedRootFallback
            )
            if refreshed { try write(configuration, to: currentURL, fileManager: fileManager) }
            return configuration
        } catch {
            if !isMissing(error) {
                if error is LocalVaultConfigurationError { throw error }
                throw LocalVaultConfigurationError.unreadable(currentURL, error.localizedDescription)
            }
        }

        guard !hasExplicitOverride else { return nil }
        let legacyURL = legacyConfigurationURL ?? hostGlobalLegacyConfigurationURL(fileManager: fileManager)
        guard legacyURL.standardizedFileURL != currentURL.standardizedFileURL else { return nil }

        let legacyData: Data
        do {
            legacyData = try readData(legacyURL)
        } catch {
            // A sandboxed process commonly cannot read this old host-global
            // path. Leave it untouched and let a fresh install choose a folder.
            // The current container path above remains authoritative.
            return nil
        }

        let (configuration, _) = try validatedConfiguration(
            from: legacyData, at: legacyURL, fileManager: fileManager,
            resolveBookmark: resolveBookmark, makeBookmark: makeBookmark,
            allowUnscopedRootFallback: allowUnscopedRootFallback
        )
        try write(configuration, to: currentURL, fileManager: fileManager)
        return configuration
    }

    @discardableResult
    public static func open(
        root: URL,
        bookmarkData: Data? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        replacingUnreadableConfiguration: Bool = false
    ) throws -> Self {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        try fileManager.createDirectory(at: canonical, withIntermediateDirectories: true)
        try validate(canonical, fileManager: fileManager)
        let configuration = Self(rootPath: canonical.path, bookmarkData: bookmarkData)
        let url = configurationURL(environment: environment, fileManager: fileManager)
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

        var recoveryBackup: URL?
        let existingData: Data?
        do {
            existingData = try Data(contentsOf: url)
        } catch {
            if isMissing(error) {
                // A new selection may create its first configuration.
            } else {
                guard replacingUnreadableConfiguration else {
                    throw LocalVaultConfigurationError.recoveryRequired(url, error.localizedDescription)
                }
                recoveryBackup = try preserveForRecovery(url, fileManager: fileManager)
            }
            existingData = nil
        }
        if let existingData {
            do {
                _ = try JSONDecoder().decode(Self.self, from: existingData)
            } catch {
                guard replacingUnreadableConfiguration else {
                    throw LocalVaultConfigurationError.recoveryRequired(url, error.localizedDescription)
                }
                recoveryBackup = try preserveForRecovery(url, fileManager: fileManager)
            }
        }

        do {
            try write(configuration, to: url, fileManager: fileManager)
        } catch {
            if let recoveryBackup, !fileManager.fileExists(atPath: url.path) {
                try? fileManager.moveItem(at: recoveryBackup, to: url)
            }
            throw error
        }
        return configuration
    }

    /// A dismissed chooser has no side effects on the saved folder setting.
    /// The app uses this same path for its cancellation branch.
    @discardableResult
    public static func openSelection(
        root: URL?,
        bookmarkData: Data? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        replacingUnreadableConfiguration: Bool = false
    ) throws -> Self? {
        guard let root else { return nil }
        return try open(
            root: root,
            bookmarkData: bookmarkData,
            environment: environment,
            fileManager: fileManager,
            replacingUnreadableConfiguration: replacingUnreadableConfiguration
        )
    }

    public typealias BookmarkResolver = (_ data: Data, _ isStale: inout Bool) throws -> URL
    public typealias BookmarkMaker = (_ root: URL) throws -> Data

    public static let defaultBookmarkResolver: BookmarkResolver = { data, stale in
        try URL(resolvingBookmarkData: data, options: [.withSecurityScope], relativeTo: nil,
                bookmarkDataIsStale: &stale)
    }
    public static let defaultBookmarkMaker: BookmarkMaker = { root in
        try root.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    private static func validatedConfiguration(
        from data: Data,
        at url: URL,
        fileManager: FileManager,
        resolveBookmark: BookmarkResolver,
        makeBookmark: BookmarkMaker,
        allowUnscopedRootFallback: Bool
    ) throws -> (Self, Bool) {
        let original: Self
        do {
            original = try JSONDecoder().decode(Self.self, from: data)
        } catch {
            throw LocalVaultConfigurationError.corrupt(url, error.localizedDescription)
        }

        let resolved: URL
        var stale = false
        var usedUnscopedRoot = false
        do {
            if let bookmarkData = original.bookmarkData {
                resolved = try resolveBookmark(bookmarkData, &stale)
            } else {
                resolved = original.root
            }
        } catch {
            // The unentitled CLI can read a user-selected folder even when it
            // cannot resolve the app's security-scoped bookmark. Never use this
            // fallback in the sandboxed app, and never rewrite its bookmark.
            guard allowUnscopedRootFallback,
                  fileManager.isReadableFile(atPath: original.root.path),
                  (try? validate(original.root, fileManager: fileManager)) != nil else {
                throw LocalVaultConfigurationError.folderUnavailable(original.root, error.localizedDescription)
            }
            resolved = original.root
            usedUnscopedRoot = true
        }

        let scoped = resolved.startAccessingSecurityScopedResource()
        defer { if scoped { resolved.stopAccessingSecurityScopedResource() } }
        do {
            try validate(resolved, fileManager: fileManager)
        } catch {
            throw LocalVaultConfigurationError.folderUnavailable(resolved, error.localizedDescription)
        }

        if usedUnscopedRoot {
            return (Self(rootPath: resolved.standardizedFileURL.path, bookmarkData: nil), false)
        }
        guard stale else { return (original, false) }
        do {
            let refreshed = try makeBookmark(resolved)
            return (Self(rootPath: resolved.standardizedFileURL.path, bookmarkData: refreshed), true)
        } catch {
            throw LocalVaultConfigurationError.bookmarkRefreshFailed(url, error.localizedDescription)
        }
    }

    private static func hostGlobalLegacyConfigurationURL(fileManager: FileManager) -> URL {
        let home = getpwuid(getuid()).map { URL(fileURLWithPath: String(cString: $0.pointee.pw_dir)) }
            ?? fileManager.homeDirectoryForCurrentUser
        return home.appendingPathComponent("Library/Application Support/TextText/vault.json")
    }

    private static func write(_ configuration: Self, to url: URL, fileManager: FileManager) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(configuration).write(to: url, options: .atomic)
    }

    private static func preserveForRecovery(_ url: URL, fileManager: FileManager) throws -> URL {
        let backup = url.deletingLastPathComponent()
            .appendingPathComponent("\(url.lastPathComponent).recovery-\(UUID().uuidString).bak")
        do {
            try fileManager.moveItem(at: url, to: backup)
            return backup
        } catch {
            throw LocalVaultConfigurationError.recoveryBackupFailed(url, error.localizedDescription)
        }
    }

    private static func isMissing(_ error: Error) -> Bool {
        let value = error as NSError
        if value.domain == NSCocoaErrorDomain {
            return value.code == NSFileReadNoSuchFileError || value.code == NSFileNoSuchFileError
        }
        return value.domain == NSPOSIXErrorDomain && value.code == Int(ENOENT)
    }

    private static func validate(_ root: URL, fileManager: FileManager) throws {
        var isDirectory: ObjCBool = false
        guard root.path.hasPrefix("/"),
              fileManager.fileExists(atPath: root.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            throw CocoaError(.fileReadNoSuchFile, userInfo: [NSFilePathErrorKey: root.path])
        }
    }
}

public enum LocalVaultConfigurationError: Error, LocalizedError {
    case unreadable(URL, String)
    case corrupt(URL, String)
    case recoveryRequired(URL, String)
    case recoveryBackupFailed(URL, String)
    case folderUnavailable(URL, String)
    case bookmarkRefreshFailed(URL, String)

    public var errorDescription: String? {
        switch self {
        case .unreadable(let url, let reason):
            return "TextText couldn't read its saved folder settings at \(url.path): \(reason)"
        case .corrupt(let url, let reason):
            return "TextText found unreadable saved folder settings at \(url.path): \(reason)"
        case .recoveryRequired(let url, let reason):
            return "TextText found damaged or unreadable folder settings at \(url.path): \(reason)"
        case .recoveryBackupFailed(let url, let reason):
            return "TextText couldn't preserve the existing settings at \(url.path): \(reason)"
        case .folderUnavailable(let url, let reason):
            return "TextText couldn't access the saved folder at \(url.path): \(reason)"
        case .bookmarkRefreshFailed(let url, let reason):
            return "TextText couldn't refresh folder access saved in \(url.path): \(reason)"
        }
    }
}
