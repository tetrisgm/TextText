import Foundation
import Darwin

/// The app and CLI share a selected ordinary directory. Content stays in that
/// directory; this small preference only remembers where to open it.
public struct LocalVaultConfiguration: Codable, Sendable, Equatable {
    public let rootPath: String
    public let bookmarkData: Data?
    public var root: URL { URL(fileURLWithPath: rootPath, isDirectory: true) }

    public func resolvingRoot() throws -> URL {
        guard let bookmarkData else { return root }
        var stale = false
        return try URL(resolvingBookmarkData: bookmarkData, options: [.withSecurityScope],
                       relativeTo: nil, bookmarkDataIsStale: &stale)
    }

    public static func configurationURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL {
        if let path = environment["TEXTTEXT_VAULT_CONFIG"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        return fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TextText/vault.json")
    }

    public static func load(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> Self? {
        let url: URL
        if let override = environment["TEXTTEXT_VAULT_CONFIG"], !override.isEmpty {
            url = URL(fileURLWithPath: override)
            guard fileManager.fileExists(atPath: url.path) else { return nil }
        } else {
            // The signed app may have a sandbox home while the bundled CLI runs
            // in the user's shell. Read both known locations; the last explicit
            // selection wins. A missing selected folder is an error, never a
            // reason to quietly select an older vault or remote workspace.
            let home = getpwuid(getuid()).map { URL(fileURLWithPath: String(cString: $0.pointee.pw_dir)) }
                ?? fileManager.homeDirectoryForCurrentUser
            let candidates = [
                configurationURL(environment: environment, fileManager: fileManager),
                home.appendingPathComponent("Library/Application Support/TextText/vault.json"),
                home.appendingPathComponent("Library/Containers/app.texttext.mac/Data/Library/Application Support/TextText/vault.json"),
            ]
            let existing = candidates.compactMap { candidate -> (URL, Date)? in
                guard let attributes = try? fileManager.attributesOfItem(atPath: candidate.path),
                      let modified = attributes[.modificationDate] as? Date else { return nil }
                return (candidate, modified)
            }.sorted { $0.1 > $1.1 }
            guard let selected = existing.first else { return nil }
            url = selected.0
        }
        let configuration = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        let resolved = try configuration.resolvingRoot()
        let scoped = resolved.startAccessingSecurityScopedResource()
        defer { if scoped { resolved.stopAccessingSecurityScopedResource() } }
        try validate(resolved, fileManager: fileManager)
        return configuration
    }

    @discardableResult
    public static func open(
        root: URL,
        bookmarkData: Data? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> Self {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        try fileManager.createDirectory(at: canonical, withIntermediateDirectories: true)
        try validate(canonical, fileManager: fileManager)
        let configuration = Self(rootPath: canonical.path, bookmarkData: bookmarkData)
        let url = configurationURL(environment: environment, fileManager: fileManager)
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(configuration).write(to: url, options: .atomic)
        return configuration
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
