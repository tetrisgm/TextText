import Foundation
import Darwin
import TextTextWorkspaceCore

/// Device-private observed directory identity and immutable server command.
/// This helper never renames, recreates, deletes or writes synchronized files.
struct LocalVaultFolderCaseSync {
    struct Identity: Codable, Sendable, Equatable { let path: String; let device: UInt64; let inode: UInt64 }
    struct Baseline: Codable, Sendable { let version: Int; let rootHash: String; let accountId: String; let manifestRevision: String; let folders: [String]; let items: [LocalVaultFolderCaseItem]; let identities: [Identity] }
    struct Command: Codable, Sendable { let version: Int; let rootHash: String; let accountId: String; let request: LocalVaultFolderCaseRequest; let identity: Identity; var conflicted: Bool = false }
    static func validateSerializedState(_ data: Data) throws {
        guard let state = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw LocalVaultSyncFailure.invalidResponse }
        func object(_ value: Any?, _ fields: Set<String>) throws -> [String: Any]? {
            guard let value, !(value is NSNull) else { return nil }
            guard let result = value as? [String: Any], Set(result.keys) == fields else { throw LocalVaultSyncFailure.invalidResponse }
            return result
        }
        func items(_ value: Any?) throws {
            guard let rows = value as? [[String: Any]], rows.allSatisfy({ Set($0.keys) == Set(["itemId", "relativePath", "revision"]) }) else { throw LocalVaultSyncFailure.invalidResponse }
        }
        if let baseline = try object(state["folderCaseBaseline"], ["version", "rootHash", "accountId", "manifestRevision", "folders", "items", "identities"]) {
            try items(baseline["items"])
            guard let rows = baseline["identities"] as? [[String: Any]], rows.allSatisfy({ Set($0.keys) == Set(["path", "device", "inode"]) }) else { throw LocalVaultSyncFailure.invalidResponse }
        }
        if let command = try object(state["folderCaseCommand"], ["version", "rootHash", "accountId", "request", "identity", "conflicted"]) {
            guard let request = try object(command["request"], ["operationId", "source", "destination", "baseManifestRevision", "folders", "items"]),
                  try object(command["identity"], ["path", "device", "inode"]) != nil else { throw LocalVaultSyncFailure.invalidResponse }
            try items(request["items"])
        }
    }
    static func digest(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    static func within(_ value: String, _ parent: String) -> Bool { value == parent || value.hasPrefix(parent + "/") }
    static func rebase(_ value: String, _ source: String, _ destination: String) -> String { destination + value.dropFirst(source.count) }
    static func canonical(_ value: String) -> String { value.precomposedStringWithCanonicalMapping.lowercased() }
    static func folderURL(root: URL, path: String) throws -> URL {
        try LocalVaultDocumentStore(root: root).validateFolderCatalog([path])
        let url = root.appendingPathComponent(path).standardizedFileURL
        guard url.path.hasPrefix(root.path + "/") else { throw LocalVaultSyncFailure.invalidResponse }
        return url
    }
    static func identity(root: URL, path: String) throws -> Identity {
        guard try RetainedFileMove.exactRelativeExists(root: root, path: path) else { throw LocalVaultSyncFailure.changed }
        let url = try folderURL(root: root, path: path)
        var info = stat(); guard lstat(url.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw LocalVaultSyncFailure.changed }
        return .init(path: path, device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
    }
    static func hasUnbaselinedAlias(root: URL, path: String) throws -> Bool {
        guard try !RetainedFileMove.exactRelativeExists(root: root, path: path) else { return false }
        let parent = path.split(separator: "/").dropLast().joined(separator: "/")
        if !parent.isEmpty, try !RetainedFileMove.exactRelativeExists(root: root, path: parent) { return false }
        let url = try folderURL(root: root, path: path)
        return try FileManager.default.contentsOfDirectory(atPath: url.deletingLastPathComponent().path).contains { canonical($0) == canonical(url.lastPathComponent) }
    }
    static func changed(root: URL, identity original: Identity) throws -> String? {
        if try RetainedFileMove.exactRelativeExists(root: root, path: original.path) { return nil }
        let url = try folderURL(root: root, path: original.path), parent = url.deletingLastPathComponent()
        let parentPath = original.path.split(separator: "/").dropLast().joined(separator: "/")
        if !parentPath.isEmpty, try !RetainedFileMove.exactRelativeExists(root: root, path: parentPath) { return nil }
        let candidates = try FileManager.default.contentsOfDirectory(atPath: parent.path).filter { canonical($0) == canonical(url.lastPathComponent) }
        guard !candidates.isEmpty else { return nil }
        guard candidates.count == 1 else { throw LocalVaultSyncFailure.changed }
        let destination = parentPath.isEmpty ? candidates[0] : parentPath + "/" + candidates[0]
        let observed = try identity(root: root, path: destination)
        guard observed.device == original.device, observed.inode == original.inode else { throw LocalVaultSyncFailure.changed }
        return destination
    }
    static func validate(root: URL, accountId: String?, baseline: Baseline?, command: Command?) throws {
        let store = LocalVaultDocumentStore(root: root)
        if let baseline {
            guard baseline.version == 1, baseline.accountId == accountId, baseline.rootHash == TextTextStableDigest.sha256Hex(Data(root.path.utf8)), digest(baseline.manifestRevision), baseline.folders.count <= 20_000, baseline.items.count <= 20_000,
                  Set(baseline.folders).count == baseline.folders.count, Set(baseline.items.map(\.itemId)).count == baseline.items.count, Set(baseline.items.map(\.relativePath)).count == baseline.items.count,
                  baseline.identities.count == baseline.folders.count, Set(baseline.identities.map(\.path)) == Set(baseline.folders) else { throw LocalVaultSyncFailure.invalidResponse }
            try store.validateFolderCatalog(baseline.folders)
            for item in baseline.items { _ = try store.url(for: item.relativePath); guard digest(item.revision) else { throw LocalVaultSyncFailure.invalidResponse } }
        }
        if let command {
            let r = command.request
            guard command.version == 1, accountId == command.accountId, command.rootHash == TextTextStableDigest.sha256Hex(Data(root.path.utf8)), UUID(uuidString: r.operationId) != nil,
                  digest(r.baseManifestRevision), r.source != r.destination, canonical(r.source) == canonical(r.destination),
                  (r.source as NSString).deletingLastPathComponent == (r.destination as NSString).deletingLastPathComponent,
                  r.folders.contains(r.source), Set(r.folders).count == r.folders.count, Set(r.items.map(\.itemId)).count == r.items.count, Set(r.items.map(\.relativePath)).count == r.items.count,
                  r.folders.count <= 20_000, r.items.count <= 20_000, command.identity.path == r.source else { throw LocalVaultSyncFailure.invalidResponse }
            try store.validateFolderCatalog(r.folders)
            try store.validateFolderCatalog([r.destination])
            guard r.folders.allSatisfy({ within($0, r.source) }), r.items.allSatisfy({ within($0.relativePath, r.source) && digest($0.revision) }) else { throw LocalVaultSyncFailure.invalidResponse }
            for item in r.items { _ = try store.url(for: item.relativePath) }
        }
    }
    static func verifyMovedTree(root: URL, command: Command) throws {
        let r = command.request
        guard try !RetainedFileMove.exactRelativeExists(root: root, path: r.source) else { throw LocalVaultSyncFailure.changed }
        let observed = try identity(root: root, path: r.destination)
        guard observed.device == command.identity.device, observed.inode == command.identity.inode else { throw LocalVaultSyncFailure.changed }
        let folders = Set(r.folders.map { rebase($0, r.source, r.destination) })
        let items = Dictionary(uniqueKeysWithValues: r.items.map { (rebase($0.relativePath, r.source, r.destination), $0.itemId) })
        guard items.count == r.items.count else { throw LocalVaultSyncFailure.invalidResponse }
        var actualFolders = Set([r.destination]), actualItems = Set<String>(), stack = [r.destination], count = 0
        while let directory = stack.popLast() {
            for name in try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(directory).path) {
                count += 1; guard count <= 60_000 else { throw LocalVaultSyncFailure.invalidResponse }
                let path = directory + "/" + name, url = root.appendingPathComponent(path); var info = stat()
                guard lstat(url.path, &info) == 0 else { throw LocalVaultSyncFailure.changed }
                if info.st_mode & S_IFMT == S_IFDIR { _ = try identity(root: root, path: path); actualFolders.insert(path); stack.append(path) }
                else if info.st_mode & S_IFMT == S_IFREG {
                    guard let id = items[path], let actual = MarkdownIdentityCodec.extract(from: try LocalVaultDocumentStore(root: root).readMetadata(path: path).contents.markdown)?.itemId, actual == id else { throw LocalVaultSyncFailure.changed }
                    actualItems.insert(path)
                } else { throw LocalVaultSyncFailure.changed }
            }
        }
        guard actualFolders == folders, actualItems == Set(items.keys) else { throw LocalVaultSyncFailure.changed }
    }
}
