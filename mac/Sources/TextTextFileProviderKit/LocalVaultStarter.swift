import Darwin
import Foundation

/// Installs editable starter packs into a normal folder once. The journal is
/// deliberately independent of the app version: deleting a starter is an edit,
/// not a request to restore it at the next launch or update.
public enum LocalVaultStarter {
    public static let folders = ["Notes", "Reading", "Projects", "Tasks", "Journal", "Writing", "Gallery", "Presentations", "Templates"]
    public struct Preset: Sendable {
        public let id: String
        public let name: String
        public let example: String
    }
    public static let presets: [Preset] = [
        .init(id: "note", name: "Note", example: "Notes/Things I keep relearning.textpack"),
        .init(id: "bookmark", name: "Bookmark", example: "Reading/How Figma multiplayer works.textpack"),
        .init(id: "article", name: "Article", example: "Reading/The case for slow publishing.textpack"),
        .init(id: "brief", name: "Living brief", example: "Projects/Agentic writing launch brief.textpack"),
        .init(id: "casestudy", name: "Case study", example: "Writing/Rebuilding a studio around live service.textpack"),
        .init(id: "gallery", name: "Gallery", example: "Gallery/Nights and weather.textpack"),
        .init(id: "page", name: "Page", example: "Writing/How we decide what to build.textpack"),
        .init(id: "project", name: "Project", example: "Projects/Website relaunch.textpack"),
        .init(id: "talk", name: "Talk", example: "Presentations/Writing for people who will never meet you.textpack"),
        .init(id: "timeline", name: "Timeline", example: "Journal/Timeline.textpack"),
        .init(id: "todo", name: "To-do", example: "Tasks/Launch week.textpack")
    ]
    public struct Result: Sendable {
        public let createdPaths: [String]
        public let alreadyComplete: Bool
    }
    private struct State: Codable {
        var version = 1
        var processed: Set<String> = []
        var complete = false
    }
    public enum Failure: Error, LocalizedError {
        case unsafePath, invalidState, lockFailed
        public var errorDescription: String? {
            switch self {
            case .unsafePath: return "Starter folders must be ordinary folders inside this workspace."
            case .invalidState: return "The workspace setup record could not be read. Your files have not been replaced."
            case .lockFailed: return "Workspace setup is busy. Try opening the folder again."
            }
        }
    }

    /// Includes empty folders, with the same visibility boundary as pack listing.
    public static func listFolders(root: URL) throws -> [String] {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey, .isPackageKey]
        guard let entries = FileManager.default.enumerator(at: root,
            includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles, .skipsPackageDescendants]) else {
            throw CocoaError(.fileReadNoSuchFile)
        }
        var folders: [String] = []
        for case let item as URL in entries {
            let values = try item.resourceValues(forKeys: keys)
            if values.isSymbolicLink == true || values.isPackage == true {
                entries.skipDescendants(); continue
            }
            guard values.isDirectory == true else { continue }
            let path = item.standardizedFileURL.resolvingSymlinksInPath().path
            guard path.hasPrefix(root.path + "/") else { entries.skipDescendants(); continue }
            folders.append(String(path.dropFirst(root.path.count + 1)))
            if folders.count >= 20_000 { break }
        }
        return folders.sorted()
    }

    /// Called after the user chooses a workspace. Existing files are preserved,
    /// including a user's own file at a starter path. A failed run can resume.
    public static func seed(root: URL, presets source: URL) throws -> Result {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        let fm = FileManager.default
        guard try root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw Failure.unsafePath }
        func checked(_ relative: String, directory: Bool = false) throws -> URL {
            var item = root
            let components = relative.split(separator: "/")
            for (index, component) in components.enumerated() {
                item.appendPathComponent(String(component))
                guard item.standardizedFileURL.resolvingSymlinksInPath() == item,
                      item.path.hasPrefix(root.path + "/") else { throw Failure.unsafePath }
                // resourceValues also catches dangling links; fileExists alone does not.
                if let values = try? item.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey]) {
                    guard values.isSymbolicLink != true else { throw Failure.unsafePath }
                    if directory || index < components.count - 1 {
                        guard values.isDirectory == true else { throw Failure.unsafePath }
                    }
                }
            }
            return item
        }
        let metadata = try checked(".texttext", directory: true)
        if !fm.fileExists(atPath: metadata.path) {
            try fm.createDirectory(at: metadata, withIntermediateDirectories: false)
        }
        let lockURL = try checked(".texttext/starter.lock")
        let lock = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard lock >= 0 else { throw Failure.lockFailed }
        defer { _ = flock(lock, LOCK_UN); close(lock) }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw Failure.lockFailed }
        let stateURL = try checked(".texttext/starter-v1.json")
        var state = State()
        if fm.fileExists(atPath: stateURL.path) {
            let data = try Data(contentsOf: stateURL)
            guard data.count < 64 * 1024, let decoded = try? JSONDecoder().decode(State.self, from: data), decoded.version == 1 else {
                throw Failure.invalidState
            }
            state = decoded
        }
        if state.complete { return Result(createdPaths: [], alreadyComplete: true) }
        func save() throws {
            _ = try checked(".texttext/starter-v1.json")
            try JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
        }
        // Preflight all bundled inputs and destination paths before adding any
        // visible files. Never replace an occupied target or follow a symlink.
        for folder in folders { _ = try checked(folder, directory: true) }
        for preset in presets {
            let input = source.appendingPathComponent(preset.id + ".textpack")
            let values = try input.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true else { throw Failure.unsafePath }
            _ = try checked("Templates/\(preset.name).textpack")
            _ = try checked(preset.example)
        }
        for folder in folders where !state.processed.contains(folder + "/") {
            let target = try checked(folder, directory: true)
            if !fm.fileExists(atPath: target.path) {
                try fm.createDirectory(at: target, withIntermediateDirectories: false)
            }
            state.processed.insert(folder + "/")
            try save()
        }
        let store = LocalVaultDocumentStore(root: root)
        var created: [String] = []
        for preset in presets {
            for path in ["Templates/\(preset.name).textpack", preset.example] where !state.processed.contains(path) {
                let target = try checked(path)
                if !fm.fileExists(atPath: target.path) {
                    _ = try store.importFile(from: source.appendingPathComponent(preset.id + ".textpack"), newPath: path)
                    created.append(path)
                }
                state.processed.insert(path)
                try save()
            }
        }
        state.complete = true
        try save()
        return Result(createdPaths: created, alreadyComplete: false)
    }
}
