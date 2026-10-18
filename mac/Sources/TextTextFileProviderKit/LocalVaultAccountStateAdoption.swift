import Foundation
import CoreFoundation
import Darwin
import TextTextWorkspaceCore

/// Live actors hold a shared OS lease. An adoption needs the exclusive lease;
/// process death closes the descriptor without a stale lock-file reset.
final class LocalVaultAccountWriterLease: @unchecked Sendable {
    private let descriptor: Int32
    init(root: URL) throws {
        let directory = LocalVaultDeviceState.directory(root: root)
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw LocalVaultDocumentStore.Failure.invalidPath }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let fd = open(directory.appendingPathComponent("account-adoption.lock").path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        guard flock(fd, LOCK_SH | LOCK_NB) == 0 else { _ = close(fd); throw LocalVaultSyncFailure.busy }
        descriptor = fd
    }
    deinit { _ = flock(descriptor, LOCK_UN); _ = close(descriptor) }
}

/// Explicit review and retired writers are required. No network credential or
/// authority is accepted here; ordinary actors stay blocked by the intent.
public enum LocalVaultAccountStateAdoption {
    public struct Result { public let alreadyBound: Bool; public let recoveryDirectory: URL? }
    struct Entry: Codable { let path: String; let beforeHash: String; let afterHash: String }
    struct Intent: Codable { var version: Int; let owner: LocalVaultAccountRootOwnership.Owner; let directory: String; var entries: [Entry] }
    private static let active: Set<String> = ["checkpoint.json", "intent.json", "move-intent.json", "binary-intent.json"]
    private static let manager = FileManager.default
    private static func invalid() -> Error { LocalVaultSharedFailure.invalid }
    private static func safe(_ directory: URL, _ relative: String) throws -> URL {
        guard !relative.hasPrefix("/"), !relative.contains("\\"), !relative.contains(":"),
              relative.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !["", ".", ".."].contains(String($0)) }) else { throw invalid() }
        let target = directory.appendingPathComponent(relative).standardizedFileURL
        guard target.path.hasPrefix(directory.standardizedFileURL.path + "/"), target.resolvingSymlinksInPath().path == target.path else { throw invalid() }
        return target
    }
    private static func limit(_ path: String) -> Int {
        if path.hasPrefix("replacement-index/") { return 8192 }
        if path == "sync/state.json" { return 90 * 1024 * 1024 }
        if path == "workspace-capabilities.json" { return 8 * 1024 * 1024 }
        if path.hasSuffix("/intent.json") { return 9 * 1024 * 1024 }
        if path.hasSuffix("/binary-intent.json") { return 4096 }
        return 5 * 1024 * 1024
    }
    private static func read(_ target: URL, limit: Int) throws -> Data {
        guard target.resolvingSymlinksInPath().path == target.path else { throw invalid() }
        let values = try target.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) <= limit else { throw invalid() }
        let data = try Data(contentsOf: target); guard data.count <= limit else { throw invalid() }; return data
    }
    private static func encode(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: .sortedKeys) }
    private static func encoded<T: Encodable>(_ value: T) throws -> Data { let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys; return try encoder.encode(value) }
    private static func write(_ data: Data, to target: URL, replacing: Bool = true) throws {
        try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temporary = target.deletingLastPathComponent().appendingPathComponent(".adoption-" + UUID().uuidString + ".tmp")
        defer { try? manager.removeItem(at: temporary) }
        try data.write(to: temporary, options: .withoutOverwriting)
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        let handle = try FileHandle(forWritingTo: temporary); try handle.synchronize(); try handle.close()
        if replacing {
            guard rename(temporary.path, target.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        } else { try manager.moveItem(at: temporary, to: target) }
    }
    private static func version(_ object: [String: Any]) throws {
        guard let value = object["version"] else { return }
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == 1 else { throw invalid() }
    }
    private static func unbound(_ object: [String: Any], account: String) throws -> Bool {
        guard let saved = object["accountId"], !(saved is NSNull) else { return true }
        guard let id = saved as? String, id == account else { throw LocalVaultAccountRootOwnership.Failure.account }; return false
    }
    private static func allowed(_ path: String) -> Bool {
        if ["sync/state.json", "workspace-capabilities.json"].contains(path) { return true }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if parts.count == 2, parts[0] == "replacement-index", parts[1].hasSuffix(".json"),
           UUID(uuidString: String(parts[1].dropLast(5))) != nil { return true }
        return parts.count == 3 && parts[0] == "shared-editing" && (try? LocalVaultAccountIdentity.validate(parts[1])) != nil && active.contains(parts[2])
    }
    private static func bind(_ original: Data, path: String, root: URL, owner: LocalVaultAccountRootOwnership.Owner) throws -> (Data, Bool) {
        guard var object = try JSONSerialization.jsonObject(with: original) as? [String: Any] else { throw invalid() }
        try version(object)
        if path.hasPrefix("replacement-index/") {
            return try ReplacementRecoveryRegistry.bindForAdoption(original, path: path, root: root, owner: owner)
        }
        if path == "sync/state.json" {
            try LocalVaultSync.validateStateForAdoption(original, root: root, binding: owner.binding)
            let changed = try unbound(object, account: owner.accountId); object["accountId"] = owner.accountId
            return (try encode(object), changed)
        }
        if path == "workspace-capabilities.json" {
            struct Record: Decodable { let binding: LocalVaultSyncBinding; let capabilities: LocalVaultSyncCapabilities }
            let record = try JSONDecoder().decode(Record.self, from: original)
            guard try PortableWorkspaceBinding.normalized(record.binding) == owner.binding else { throw LocalVaultSyncFailure.invalidBinding }
            let changed = try unbound(object, account: owner.accountId); object["accountId"] = owner.accountId
            object["capabilities"] = ["fullAccess": false, "canCreateContent": false, "writableFolders": [], "writableItems": [], "knownPaths": [], "writablePaths": []] as [String: Any]
            return (try encode(object), changed)
        }
        if path.hasSuffix("/binary-intent.json") {
            guard object["itemId"] as? String == String(path.split(separator: "/")[1]), let file = object["path"] as? String else { throw invalid() }
            _ = try LocalVaultDocumentStore(root: root).url(for: file); return (original, false)
        }
        let nested = path.hasSuffix("/intent.json") || path.hasSuffix("/move-intent.json")
        guard var checkpoint = nested ? object["checkpoint"] as? [String: Any] : object else { throw invalid() }
        let cp = try JSONDecoder().decode(LocalVaultSharedCheckpoint.self, from: encode(checkpoint))
        try LocalVaultSharedEditingStore(root: root).validate(cp)
        guard cp.itemId == path.split(separator: "/")[1], var journal = try JSONSerialization.jsonObject(with: Data(cp.journal.utf8)) as? [String: Any] else { throw invalid() }
        try version(journal)
        let changed = try unbound(journal, account: owner.accountId); journal["accountId"] = owner.accountId
        checkpoint["journal"] = String(decoding: try encode(journal), as: UTF8.self)
        if nested { object["checkpoint"] = checkpoint } else { object = checkpoint }
        return (try encode(object), changed)
    }
    private static func paths(_ directory: URL) throws -> [String] {
        var result = ["sync/state.json"]
        if manager.fileExists(atPath: try safe(directory, "workspace-capabilities.json").path) { result.append("workspace-capabilities.json") }
        let shared = try safe(directory, "shared-editing")
        if manager.fileExists(atPath: shared.path) {
            for listedItem in try manager.contentsOfDirectory(at: shared, includingPropertiesForKeys: [.isDirectoryKey]) {
                let item = try safe(shared, listedItem.lastPathComponent)
                guard try item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw invalid() }
                for listedFile in try manager.contentsOfDirectory(at: item, includingPropertiesForKeys: [.isDirectoryKey]) {
                    let file = try safe(item, listedFile.lastPathComponent)
                    guard try file.resourceValues(forKeys: [.isDirectoryKey]).isDirectory != true else { throw invalid() }
                    if file.pathExtension.lowercased() != "json" || file.lastPathComponent.hasPrefix("archived-") { continue }
                    let relative = "shared-editing/" + item.lastPathComponent + "/" + file.lastPathComponent
                    guard allowed(relative), result.count < 2048 else { throw invalid() }; result.append(relative)
                }
            }
        }
        let replacements = try safe(directory, "replacement-index")
        if manager.fileExists(atPath: replacements.path) {
            for listed in try manager.contentsOfDirectory(at: replacements, includingPropertiesForKeys: [.isRegularFileKey]) {
                if listed.lastPathComponent.hasPrefix("."), UUID(uuidString: String(listed.lastPathComponent.dropFirst())) != nil { continue }
                let file = try safe(replacements, listed.lastPathComponent)
                guard try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true,
                      allowed("replacement-index/" + file.lastPathComponent) else { throw invalid() }
                result.append("replacement-index/" + file.lastPathComponent)
            }
        }
        return result.sorted()
    }
    private static func prepare(root: URL, directory: URL, owner: LocalVaultAccountRootOwnership.Owner, barrier: ((String) throws -> Void)?) throws -> Intent {
        var changes: [(String, Data, Data)] = [], needed = false, total = 0
        for path in try paths(directory) {
            let original = try read(safe(directory, path), limit: limit(path)), replacement = try bind(original, path: path, root: root, owner: owner)
            total += original.count + replacement.0.count; guard total <= 256 * 1024 * 1024 else { throw invalid() }
            needed = needed || replacement.1; changes.append((path, original, replacement.0))
        }
        if !needed { return Intent(version: 1, owner: owner, directory: "", entries: []) }
        let name = ".account-adoption-" + UUID().uuidString.lowercased(), transaction = try safe(directory, name)
        var entries: [Entry] = []
        for (path, original, replacement) in changes {
            try write(original, to: safe(transaction, "before/" + path), replacing: false)
            try write(replacement, to: safe(transaction, "after/" + path), replacing: false)
            entries.append(Entry(path: path, beforeHash: TextTextStableDigest.sha256Hex(original), afterHash: TextTextStableDigest.sha256Hex(replacement)))
            try barrier?("prepared:" + path)
        }
        let intent = Intent(version: 1, owner: owner, directory: name, entries: entries)
        try write(encoded(intent), to: safe(directory, LocalVaultAccountRootOwnership.pendingAdoption), replacing: false)
        try barrier?("intent"); return intent
    }
    private static func validate(_ intent: Intent, root: URL, directory: URL, expected: LocalVaultAccountRootOwnership.Owner) throws {
        guard intent.version == 1, intent.owner == expected, intent.directory.hasPrefix(".account-adoption-"),
              UUID(uuidString: String(intent.directory.dropFirst(".account-adoption-".count))) != nil,
              (1...2048).contains(intent.entries.count) else { throw invalid() }
        let transaction = try safe(directory, intent.directory)
        var seen: Set<String> = [], total = 0
        for entry in intent.entries {
            guard allowed(entry.path), seen.insert(entry.path).inserted else { throw invalid() }
            let original = try read(safe(transaction, "before/" + entry.path), limit: limit(entry.path))
            let replacement = try read(safe(transaction, "after/" + entry.path), limit: limit(entry.path))
            total += original.count + replacement.count
            guard total <= 256 * 1024 * 1024, TextTextStableDigest.sha256Hex(original) == entry.beforeHash,
                  TextTextStableDigest.sha256Hex(replacement) == entry.afterHash,
                  TextTextStableDigest.sha256Hex(try bind(original, path: entry.path, root: root, owner: expected).0) == entry.afterHash else { throw invalid() }
            _ = try bind(replacement, path: entry.path, root: root, owner: expected)
            let current = TextTextStableDigest.sha256Hex(try read(safe(directory, entry.path), limit: limit(entry.path)))
            guard current == entry.beforeHash || current == entry.afterHash else { throw LocalVaultSyncFailure.changed }
        }
    }
    public static func adoptAfterExplicitReview(root: URL, binding: LocalVaultSyncBinding, accountId: String, barrier: ((String) throws -> Void)? = nil) throws -> Result {
        _ = try LocalVaultAccountIdentity.validate(accountId)
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath(), directory = LocalVaultDeviceState.directory(root: canonical)
        let owner = LocalVaultAccountRootOwnership.Owner(version: 1, binding: try PortableWorkspaceBinding.normalized(binding), accountId: accountId, rootHash: TextTextStableDigest.sha256Hex(Data(canonical.path.utf8)))
        try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let lockURL = try safe(directory, "account-adoption.lock"), fd = open(lockURL.path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw invalid() }; defer { _ = close(fd) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { throw LocalVaultSyncFailure.busy }; defer { _ = flock(fd, LOCK_UN) }
        let marker = try safe(directory, LocalVaultAccountRootOwnership.fileName)
        if manager.fileExists(atPath: marker.path) { try LocalVaultAccountRootOwnership.verify(marker, expected: owner) }
        let pending = try safe(directory, LocalVaultAccountRootOwnership.pendingAdoption), resuming = manager.fileExists(atPath: pending.path)
        let intent = try resuming ? JSONDecoder().decode(Intent.self, from: read(pending, limit: 1024 * 1024)) : prepare(root: canonical, directory: directory, owner: owner, barrier: barrier)
        guard intent.version == 1 else { throw invalid() }
        guard intent.owner.accountId == accountId else { throw LocalVaultAccountRootOwnership.Failure.account }
        if intent.entries.isEmpty {
            guard !resuming, intent.owner == owner, intent.directory.isEmpty else { throw invalid() }
            try LocalVaultAccountRootOwnership.open(root: canonical, binding: binding, accountId: accountId); return Result(alreadyBound: true, recoveryDirectory: nil)
        }
        try validate(intent, root: canonical, directory: directory, expected: owner)
        let transaction = try safe(directory, intent.directory)
        for entry in intent.entries {
            let target = try safe(directory, entry.path), current = TextTextStableDigest.sha256Hex(try read(target, limit: limit(entry.path)))
            guard current == entry.beforeHash || current == entry.afterHash else { throw LocalVaultSyncFailure.changed }
            if current != entry.afterHash { try write(read(safe(transaction, "after/" + entry.path), limit: limit(entry.path)), to: target) }
            try barrier?("applied:" + entry.path)
        }
        try validate(intent, root: canonical, directory: directory, expected: owner)
        try LocalVaultAccountRootOwnership.publish(owner, root: canonical); try barrier?("owner")
        try write(encoded(intent), to: safe(transaction, "completed.json"))
        try manager.removeItem(at: pending); try barrier?("complete")
        return Result(alreadyBound: false, recoveryDirectory: transaction)
    }
}
