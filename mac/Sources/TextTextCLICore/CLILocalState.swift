import Foundation
import TextTextFileProviderKit

/// Explicit local CLI work is an ordinary offline file writer. Its private
/// state is separate from app-group account authority and provider content.
public enum CLILocalState {
    public static func baseDirectory(root: URL, environment: [String: String] = ProcessInfo.processInfo.environment,
        applicationSupportDirectory: URL? = nil, fileManager: FileManager = .default) throws -> URL {
        let support = applicationSupportDirectory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let parent = environment["TEXTTEXT_STATE_DIR"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? support.appendingPathComponent("TextText", isDirectory: true)
        let base = parent.appendingPathComponent("CLI", isDirectory: true).standardizedFileURL
        var ancestor = base
        while !fileManager.fileExists(atPath: ancestor.path), ancestor.path != "/" {
            ancestor.deleteLastPathComponent()
        }
        guard try ancestor.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
            throw legacyState()
        }
        let canonical = base.resolvingSymlinksInPath()
        let workspace = root.standardizedFileURL.resolvingSymlinksInPath().path
        guard canonical.path == base.path, canonical.path != workspace,
              !canonical.path.hasPrefix(workspace + "/"), !LocalVaultDeviceState.isCloudManaged(root: canonical) else {
            throw TextTextCLIError.invalidDocument("CLI private state must be outside the workspace and cloud provider folders")
        }
        return base
    }
    public static func requireNoLegacyGuards(root: URL, fileManager: FileManager = .default) throws {
        func inspect(_ directory: URL) throws {
            if fileManager.fileExists(atPath: directory.appendingPathComponent(".texttext-replacements").path) { throw legacyState() }
            let metadata = directory.appendingPathComponent(".texttext", isDirectory: true)
            guard fileManager.fileExists(atPath: metadata.path) else { return }
            let values = try metadata.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard values.isSymbolicLink != true, values.isDirectory == true else { throw legacyState() }
            let allowed = Set(["workspace-binding.json", "history", "conflicts", "trash", "cli-creation-content", ".DS_Store"])
            for entry in try fileManager.contentsOfDirectory(at: metadata, includingPropertiesForKeys: [.isSymbolicLinkKey]) {
                guard allowed.contains(entry.lastPathComponent), try entry.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw legacyState() }
            }
        }
        try inspect(root)
        var failure: Error?, count = 0
        guard let entries = fileManager.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants], errorHandler: { _, error in failure = error; return false }) else { throw legacyState() }
        for case let entry as URL in entries {
            let values = try entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values.isSymbolicLink == true { entries.skipDescendants(); continue }
            if values.isDirectory == true {
                count += 1
                guard count <= 20_000 else { throw TextTextCLIError.invalidDocument("workspace exceeds the bounded legacy-state inspection") }
                try inspect(entry)
            }
        }
        if failure != nil { throw legacyState() }
    }
    private static func legacyState() -> TextTextCLIError {
        .invalidDocument("this folder has legacy or unverified local recovery state; keep it intact and review it in TextText or use the connected account commands")
    }
    @discardableResult
    public static func configure(root: URL, environment: [String: String] = ProcessInfo.processInfo.environment,
        applicationSupportDirectory: URL? = nil, fileManager: FileManager = .default) throws -> URL {
        try requireNoLegacyGuards(root: root, fileManager: fileManager)
        let base = try baseDirectory(root: root, environment: environment, applicationSupportDirectory: applicationSupportDirectory, fileManager: fileManager)
        try fileManager.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard base.resolvingSymlinksInPath().path == base.path else { throw legacyState() }
        LocalVaultDeviceState.configure(base: base)
        return base
    }
}
