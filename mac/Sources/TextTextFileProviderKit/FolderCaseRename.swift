import Foundation
import Darwin
import TextTextWorkspaceCore

/// Directory case changes preserve every visible directory. Darwin anchors the
/// parent, not the source inode; the durable intent fences a raced foreign move.
struct FolderCaseRename {
    struct Identity: Codable, Equatable {
        let device: UInt64, inode: UInt64
        var token: String { "\(device):\(inode)" }
    }
    struct Endpoint: Codable, Equatable {
        let present: Bool
        let identity: String?
    }
    struct Consent: Codable, Equatable { let inspection: String }
    struct Record: Codable {
        let version: Int
        let operation: UUID
        let rootHash: String
        let ownerHash: String
        let sourcePath: String
        let destinationPath: String
        let sourceIdentity: Identity
        let parentIdentity: Identity
        var state: String
        var explicitResolution: Consent?
    }
    struct Inspection {
        let record: Record, from: Endpoint, to: Endpoint
        let digest: String, summary: String, blocked: String?
    }
    enum Failure: Error, LocalizedError {
        case invalid, unresolved, changed
        var errorDescription: String? {
            switch self {
            case .invalid: return "This workspace's folder recovery record could not be verified. Update TextText or return to its original account."
            case .unresolved: return "A folder rename needs review. Open Recovery and inspect the current folder paths before continuing."
            case .changed: return "These folders changed during review. Inspect their current paths again."
            }
        }
    }
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath() }
    private func digest(_ data: Data) -> String { TextTextStableDigest.sha256Hex(data) }
    private var state: URL { LocalVaultDeviceState.directory(root: root) }
    private var directory: URL { state.appendingPathComponent("folder-case-renames", isDirectory: true) }
    private var lease: URL { state.appendingPathComponent("folder-case-renames.lock") }
    private func validate(_ path: String) throws {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty, path.utf8.count <= 1024,
              parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") && !$0.contains("\\") && !$0.contains(":") && !$0.hasSuffix(".") && !$0.hasSuffix(" ") && !$0.lowercased().hasSuffix(".textpack") }) else { throw Failure.invalid }
    }
    private func identity(_ url: URL) throws -> Identity {
        var info = stat()
        guard lstat(url.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw Failure.invalid }
        return Identity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
    }
    private func principal() throws -> String {
        let ownerURL = state.appendingPathComponent(LocalVaultAccountRootOwnership.fileName)
        let bytes = try StableFileSnapshot.read(ownerURL, maximumBytes: 4096)
        let owner = try JSONDecoder().decode(LocalVaultAccountRootOwnership.Owner.self, from: bytes)
        guard owner.version == 2, owner.rootHash == digest(Data(root.path.utf8)) else { throw Failure.invalid }
        try RetainedReplacementProfile.verify(root: root, owner: owner)
        let profile = try StableFileSnapshot.read(state.appendingPathComponent("retained-replacement-profile/profile.json"), maximumBytes: 4096)
        guard let fields = try JSONSerialization.jsonObject(with: profile) as? [String: Any],
              let version = fields["version"] as? Int, version == 2 || version == 3 || version == 4 else { throw Failure.invalid }
        return try RetainedReplacementProfile.principalHash(owner)
    }
    private func encode(_ record: Record) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(record)
    }
    private func save(_ record: Record) throws {
        let temporary = directory.appendingPathComponent(".staged-" + UUID().uuidString)
        try RetainedFileReplacement.create(encode(record), at: temporary)
        guard Darwin.rename(temporary.path, directory.appendingPathComponent(record.operation.uuidString + ".json").path) == 0 else { throw POSIXError(.EIO) }
        try RetainedFileReplacement.flushDirectory(directory)
    }
    private func forEachRecord(_ body: (Record) throws -> Void) throws {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalid }
        let principal = try principal()
        var enumerationError: Error?
        guard let entries = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil,
            options: [.skipsSubdirectoryDescendants, .skipsPackageDescendants], errorHandler: { _, error in
                enumerationError = error; return false
            }) else { throw Failure.invalid }
        for case let entry as URL in entries {
            let name = entry.lastPathComponent
            if name.hasPrefix(".staged-") {
                guard UUID(uuidString: String(name.dropFirst(8))) != nil else { throw Failure.invalid }
                continue
            }
            guard name.hasSuffix(".json"), let id = UUID(uuidString: String(name.dropLast(5))) else { throw Failure.invalid }
            let bytes = try StableFileSnapshot.read(directory.appendingPathComponent(name), maximumBytes: 16_384)
            guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  Set(object.keys).isSubset(of: Set(["version","operation","rootHash","ownerHash","sourcePath","destinationPath","sourceIdentity","parentIdentity","state","explicitResolution"])) else { throw Failure.invalid }
            for key in ["sourceIdentity", "parentIdentity"] {
                guard let fields = object[key] as? [String: Any], Set(fields.keys) == Set(["device", "inode"]) else { throw Failure.invalid }
            }
            if let consent = object["explicitResolution"] as? [String: Any] {
                guard Set(consent.keys) == Set(["inspection"]), let hash = consent["inspection"] as? String,
                    hash.utf8.count == 64, hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw Failure.invalid }
            }
            let record = try JSONDecoder().decode(Record.self, from: bytes)
            try validate(record.sourcePath); try validate(record.destinationPath)
            let source = root.appendingPathComponent(record.sourcePath), destination = root.appendingPathComponent(record.destinationPath)
            guard record.version == 1, record.operation == id, record.rootHash == digest(Data(root.path.utf8)), record.ownerHash == principal,
                  ["pending","completed","conflict","cancelled"].contains(record.state),
                  source.deletingLastPathComponent() == destination.deletingLastPathComponent(),
                  source.lastPathComponent != destination.lastPathComponent,
                  source.lastPathComponent.lowercased() == destination.lastPathComponent.lowercased(),
                  record.explicitResolution == nil || record.state == "completed" else { throw Failure.invalid }
            try body(record)
        }
        if let enumerationError { throw enumerationError }
    }
    private func endpoint(_ path: String) throws -> Endpoint {
        let components = path.split(separator: "/")
        var current = root
        for (index, component) in components.enumerated() {
            current.appendPathComponent(String(component))
            guard try RetainedFileMove.exactLeafExists(current) else { return Endpoint(present: false, identity: nil) }
            var info = stat()
            guard lstat(current.path, &info) == 0 else { throw Failure.invalid }
            if index < components.count - 1, info.st_mode & S_IFMT != S_IFDIR { throw Failure.invalid }
            if index == components.count - 1 {
                return Endpoint(present: true, identity: Identity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino)).token)
            }
        }
        throw Failure.invalid
    }
    private func classify(_ original: Record) throws -> Record {
        guard original.state == "pending" else { return original }
        var record = original
        let from = try endpoint(record.sourcePath), to = try endpoint(record.destinationPath)
        if from.identity == record.sourceIdentity.token && !to.present { record.state = "cancelled" }
        else if !from.present && to.identity == record.sourceIdentity.token { record.state = "completed" }
        else { record.state = "conflict" }
        try save(record)
        return record
    }
    func assertReadable() throws {
        guard FileManager.default.fileExists(atPath: directory.path) else { return }
        try RetainedFileRemoval.withLease(at: lease) {
            try forEachRecord { record in
                let checked = try classify(record)
                guard checked.state == "completed" || checked.state == "cancelled" else { throw Failure.unresolved }
            }
        }
    }
    private func openParent(_ sourcePath: String) throws -> Int32 {
        var descriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw Failure.invalid }
        do {
            for component in sourcePath.split(separator: "/").dropLast() {
                let next = String(component).withCString { openat(descriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC) }
                guard next >= 0 else { throw Failure.invalid }
                close(descriptor); descriptor = next
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }
    /// Case-only mutation for one existing directory component. Callers validate
    /// the complete authoritative catalog before invoking this primitive.
    func rename(sourcePath: String, destinationPath: String, observe: ((String) throws -> Void)? = nil) throws {
        try validate(sourcePath); try validate(destinationPath)
        let source = root.appendingPathComponent(sourcePath), destination = root.appendingPathComponent(destinationPath)
        let initialSource = try identity(source), initialParent = try identity(source.deletingLastPathComponent())
        guard source.deletingLastPathComponent() == destination.deletingLastPathComponent(),
              source.lastPathComponent != destination.lastPathComponent,
              source.lastPathComponent.lowercased() == destination.lastPathComponent.lowercased(),
              try RetainedFileMove.exactRelativeExists(root: root, path: sourcePath),
              try !RetainedFileMove.exactRelativeExists(root: root, path: destinationPath),
              initialSource == (try identity(destination)) else { throw Failure.changed }
        try observe?("folderBeforeProfile")
        try RetainedReplacementProfile.prepareFolderCase(root: root)
        try RetainedFileRemoval.withLease(at: lease) {
            try forEachRecord { prior in let checked = try classify(prior); guard checked.state != "conflict" else { throw Failure.unresolved } }
            let parentInfo = initialParent, expected = initialSource
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard directory.resolvingSymlinksInPath().path == directory.path else { throw Failure.invalid }
            try RetainedFileReplacement.flushDirectory(state)
            var record = Record(version: 1, operation: UUID(), rootHash: digest(Data(root.path.utf8)), ownerHash: try principal(),
                sourcePath: sourcePath, destinationPath: destinationPath, sourceIdentity: expected, parentIdentity: parentInfo, state: "pending")
            guard !FileManager.default.fileExists(atPath: directory.appendingPathComponent(record.operation.uuidString + ".json").path) else { throw Failure.invalid }
            try save(record)
            try observe?("folderBeforeParentPin")
            let fd: Int32
            do { fd = try openParent(sourcePath) }
            catch { record.state = "conflict"; try save(record); throw error }
            defer { close(fd) }
            var info = stat()
            guard fstat(fd, &info) == 0, parentInfo == Identity(device: UInt64(info.st_dev), inode: UInt64(info.st_ino)),
                  try endpoint(sourcePath).identity == expected.token, try !endpoint(destinationPath).present else {
                record.state = "conflict"; try save(record); throw Failure.changed
            }
            try observe?("folderPrepared")
            // No expected-inode argument exists on Darwin. Always inspect the
            // actual result; a foreign leaf remains visible and fences retries.
            let result = source.lastPathComponent.withCString { old in destination.lastPathComponent.withCString { new in
                renameatx_np(fd, old, fd, new, UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY))
            } }
            guard result == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            guard fsync(fd) == 0 else { throw POSIXError(.EIO) }
            try observe?("folderRenamed")
            record = try classify(record)
            guard record.state == "completed" else { throw Failure.unresolved }
        }
    }
    private func inspect(_ record: Record) throws -> Inspection {
        var blocked: String?, count = 0, metadataBytes = 0
        func probe(_ path: String) -> Endpoint {
            do { return try endpoint(path) }
            catch {
                blocked = "A folder path has an unsafe or unreadable parent. Its presence could not be verified."
                return Endpoint(present: true, identity: nil)
            }
        }
        let from = probe(record.sourcePath), to = probe(record.destinationPath)
        var lines = ["from:\(from.present):\(from.identity ?? "")", "to:\(to.present):\(to.identity ?? "")"]
        for path in [record.sourcePath, record.destinationPath] {
            let endpoint = path == record.sourcePath ? from : to
            guard endpoint.present, endpoint.identity != nil else { continue }
            let base = root.appendingPathComponent(path)
            var rootInfo = stat()
            guard lstat(base.path, &rootInfo) == 0 else { blocked = "A folder path could not be inspected."; continue }
            lines.append("endpoint:\(path):\(rootInfo.st_mode):\(rootInfo.st_dev):\(rootInfo.st_ino):\(rootInfo.st_size):\(rootInfo.st_mtimespec.tv_sec):\(rootInfo.st_mtimespec.tv_nsec):\(rootInfo.st_ctimespec.tv_sec):\(rootInfo.st_ctimespec.tv_nsec)")
            if rootInfo.st_mode & S_IFMT == S_IFLNK { blocked = "A folder path is a symbolic link."; continue }
            if rootInfo.st_mode & S_IFMT != S_IFDIR { continue }
            guard let enumerator = FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil,
                options: [], errorHandler: { _, _ in blocked = "A folder could not be completely inspected."; return false }) else { blocked = "A folder could not be inspected."; continue }
            for case let file as URL in enumerator {
                count += 1
                if count > 10_000 { blocked = "These folders exceed the inspection limit."; break }
                var info = stat()
                guard lstat(file.path, &info) == 0, info.st_mode & S_IFMT != S_IFLNK else { blocked = "A folder contains an unreadable entry or symbolic link."; break }
                lines.append("\(file.path.dropFirst(root.path.count + 1)):\(info.st_mode):\(info.st_dev):\(info.st_ino):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec):\(info.st_ctimespec.tv_sec):\(info.st_ctimespec.tv_nsec)")
                metadataBytes += lines.last?.utf8.count ?? 0
                if metadataBytes > 4 * 1024 * 1024 { blocked = "These folders exceed the inspection limit."; break }
            }
        }
        let bytes = Data(lines.sorted().joined(separator: "\n").utf8)
        return Inspection(record: record, from: from, to: to, digest: digest(bytes), summary: "Inspected \(min(count, 10_000)) directory entries. No file contents were copied.", blocked: blocked)
    }
    func list() throws -> [Inspection] {
        var result: [Inspection] = []
        try forEachRecord { record in
            if record.state == "pending" || record.state == "conflict" || record.explicitResolution != nil {
                guard result.count < 40_000 else { throw Failure.invalid }
                result.append(try inspect(record))
            }
        }
        return result.sorted { $0.record.operation.uuidString < $1.record.operation.uuidString }
    }
    func read(id: String) throws -> Inspection {
        guard let operation = UUID(uuidString: id) else { throw Failure.invalid }
        var matching: Record?
        try forEachRecord { if $0.operation == operation { matching = $0 } }
        guard let matching else { throw Failure.invalid }
        return try inspect(matching)
    }
    func resolve(id: String, fromPath: String, toPath: String, inspection: String, beforeAcknowledge: (() throws -> Void)?) throws {
        try RetainedFileRemoval.withLease(at: lease) {
            let observed = try read(id: id)
            guard observed.record.sourcePath == fromPath, observed.record.destinationPath == toPath,
                  observed.digest == inspection, observed.blocked == nil else { throw Failure.changed }
            try beforeAcknowledge?()
            let current = try read(id: id)
            guard current.digest == inspection, current.blocked == nil else { throw Failure.changed }
            // The bridge callback is a pure authority check. Repeat it after
            // potentially long inspection so revoked scope cannot authorize it.
            try beforeAcknowledge?()
            var record = current.record; record.explicitResolution = Consent(inspection: inspection); record.state = "completed"
            try save(record)
        }
    }
}

public struct FolderRenameRecoveryEndpoint: Sendable {
    public let present: Bool
    public let identity: String?
}
public struct FolderRenameRecoveryEntry: Sendable {
    public let id: String, fromPath: String, toPath: String, expectedIdentity: String
    public let from: FolderRenameRecoveryEndpoint, to: FolderRenameRecoveryEndpoint
    public let inspection: String, summary: String
    public let resolutionBlocked: String?
    public let resolved: Bool
}
extension LocalVaultDocumentStore {
    private func folderEntry(_ value: FolderCaseRename.Inspection) -> FolderRenameRecoveryEntry {
        FolderRenameRecoveryEntry(id: value.record.operation.uuidString, fromPath: value.record.sourcePath, toPath: value.record.destinationPath,
            expectedIdentity: value.record.sourceIdentity.token, from: .init(present: value.from.present, identity: value.from.identity),
            to: .init(present: value.to.present, identity: value.to.identity), inspection: value.digest, summary: value.summary,
            resolutionBlocked: value.blocked, resolved: value.record.explicitResolution != nil)
    }
    public func folderRenameRecoveryList() throws -> [FolderRenameRecoveryEntry] { try FolderCaseRename(root: root).list().map(folderEntry) }
    public func folderRenameRecoveryRead(id: String) throws -> FolderRenameRecoveryEntry { try folderEntry(FolderCaseRename(root: root).read(id: id)) }
    public func resolveFolderRename(id: String, fromPath: String, toPath: String, inspection: String,
        beforeAcknowledge: (() throws -> Void)? = nil) throws {
        try FolderCaseRename(root: root).resolve(id: id, fromPath: fromPath, toPath: toPath, inspection: inspection, beforeAcknowledge: beforeAcknowledge)
    }
}
