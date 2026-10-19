import Foundation
import TextTextWorkspaceCore

/// Values stored inside the existing sync State, never a second journal owner.
/// The caller holds the workspace lease and commits through persist(restoring:).
enum LocalVaultSharedRename {
    enum Failure: Error { case invalid, changed, archive }
    enum Phase: String, Codable, Sendable { case pending, terminalRejected = "terminal-rejected", stopped }
    /// JSONDecoder's keyed containers discard duplicate keys. These raw entry
    /// points must run before decoding a stored record/map or complete State.
    private struct RawJSON {
        let bytes: [UInt8]
        var index = 0, tokens = 0
        mutating func whitespace() { while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 } }
        mutating func parse() throws { whitespace(); guard index < bytes.count, bytes[index] == 123 else { throw Failure.invalid }; try value(depth: 0); whitespace(); guard index == bytes.count else { throw Failure.invalid } }
        mutating func value(depth: Int) throws {
            whitespace(); tokens += 1
            guard depth <= 32, tokens <= 1_000_000, index < bytes.count else { throw Failure.invalid }
            switch bytes[index] {
            case 123:
                index += 1; whitespace(); var names = Set<String>()
                if take(125) { return }
                while true {
                    whitespace(); let name = try string(key: true)
                    guard names.insert(name).inserted else { throw Failure.invalid }
                    whitespace(); guard take(58) else { throw Failure.invalid }
                    try value(depth: depth + 1); whitespace()
                    if take(125) { return }; guard take(44) else { throw Failure.invalid }
                }
            case 91:
                index += 1; whitespace(); if take(93) { return }
                while true { try value(depth: depth + 1); whitespace(); if take(93) { return }; guard take(44) else { throw Failure.invalid } }
            case 34: _ = try string(key: false)
            case 116: try literal([116, 114, 117, 101])
            case 102: try literal([102, 97, 108, 115, 101])
            case 110: try literal([110, 117, 108, 108])
            default: try number()
            }
        }
        mutating func take(_ byte: UInt8) -> Bool { guard index < bytes.count, bytes[index] == byte else { return false }; index += 1; return true }
        mutating func literal(_ value: [UInt8]) throws {
            guard index + value.count <= bytes.count, Array(bytes[index..<(index + value.count)]) == value else { throw Failure.invalid }; index += value.count
        }
        mutating func hexadecimal() throws -> UInt16 {
            guard index + 4 <= bytes.count else { throw Failure.invalid }; var value: UInt16 = 0
            for _ in 0..<4 {
                let byte = bytes[index]; index += 1; let digit: UInt16
                if (48...57).contains(byte) { digit = UInt16(byte - 48) }
                else if (65...70).contains(byte) { digit = UInt16(byte - 55) }
                else if (97...102).contains(byte) { digit = UInt16(byte - 87) }
                else { throw Failure.invalid }; value = value * 16 + digit
            }
            return value
        }
        mutating func string(key: Bool) throws -> String {
            let start = index; guard take(34) else { throw Failure.invalid }
            while index < bytes.count {
                let byte = bytes[index]; index += 1
                if byte == 34 { return key ? try JSONDecoder().decode(String.self, from: Data(bytes[start..<index])) : "" }
                guard byte >= 32 else { throw Failure.invalid }
                if byte == 92 {
                    guard index < bytes.count else { throw Failure.invalid }
                    let escaped = bytes[index]; index += 1
                    if escaped == 117 {
                        let code = try hexadecimal()
                        if (0xd800...0xdbff).contains(code) {
                            guard take(92), take(117), (0xdc00...0xdfff).contains(try hexadecimal()) else { throw Failure.invalid }
                        } else if (0xdc00...0xdfff).contains(code) { throw Failure.invalid }
                    } else { guard [34, 47, 92, 98, 102, 110, 114, 116].contains(escaped) else { throw Failure.invalid } }
                }
            }
            throw Failure.invalid
        }
        mutating func number() throws {
            _ = take(45)
            guard index < bytes.count else { throw Failure.invalid }
            if !take(48) {
                guard (49...57).contains(bytes[index]) else { throw Failure.invalid }; index += 1
                while index < bytes.count && (48...57).contains(bytes[index]) { index += 1 }
            }
            if take(46) {
                let start = index; while index < bytes.count && (48...57).contains(bytes[index]) { index += 1 }
                guard index > start else { throw Failure.invalid }
            }
            if take(101) || take(69) {
                if !take(43) { _ = take(45) }
                let start = index; while index < bytes.count && (48...57).contains(bytes[index]) { index += 1 }
                guard index > start else { throw Failure.invalid }
            }
        }
    }
    private static func raw(_ data: Data, maximum: Int) throws {
        guard !data.isEmpty, data.count <= maximum, String(data: data, encoding: .utf8) != nil else { throw Failure.invalid }
        var parser = RawJSON(bytes: Array(data)); try parser.parse()
    }
    static func decodeRecord(_ data: Data, context: Context) throws -> Record {
        try raw(data, maximum: 32768)
        let record = try JSONDecoder().decode(Record.self, from: data)
        try validate(record, rootHash: context.rootHash, scope: context.scope); return record
    }
    static func decodeMap(_ data: Data, context: Context) throws -> [String: Record] {
        try raw(data, maximum: 32 * 1024 * 1024)
        let result = try JSONDecoder().decode([String: Record].self, from: data)
        try validateMap(result, rootHash: context.rootHash, scope: context.scope); return result
    }
    static func validateStateBytes(_ data: Data) throws { try raw(data, maximum: 90 * 1024 * 1024) }
    private struct Key: CodingKey { let stringValue: String; var intValue: Int? { nil }; init?(stringValue: String) { self.stringValue = stringValue }; init?(intValue: Int) { return nil } }
    private static func keys(_ decoder: Decoder, _ expected: [String]) throws {
        let values = try decoder.container(keyedBy: Key.self)
        guard Set(values.allKeys.map(\.stringValue)) == Set(expected) else { throw Failure.invalid }
    }
    private static func request(_ decoder: Decoder) throws -> LocalVaultProtectedRenameRequest {
        try LocalVaultSharedRename.keys(decoder, ["operationId", "itemId", "source", "destination", "baseRevision"])
        return try LocalVaultProtectedRenameRequest(from: decoder)
    }
    private static func scope(_ decoder: Decoder) throws -> LocalVaultProtectedRenameScope {
        try LocalVaultSharedRename.keys(decoder, ["origin", "workspaceId", "accountId"])
        return try LocalVaultProtectedRenameScope(from: decoder)
    }
    struct Receipt: Codable, Equatable, Sendable {
        let request: LocalVaultProtectedRenameRequest
        let scope: LocalVaultProtectedRenameScope
        let status: String, relativePath: String
        let revision: String?
        let deleted: Bool
        init(_ value: LocalVaultProtectedRenameReceipt) { request = value.request; scope = value.scope; status = value.status; relativePath = value.relativePath; revision = value.revision; deleted = value.deleted }
        private enum CodingKeys: String, CodingKey { case request, scope, status, relativePath, revision, deleted }
        init(from decoder: Decoder) throws {
            try LocalVaultSharedRename.keys(decoder, ["request", "scope", "status", "relativePath", "revision", "deleted"])
            let c = try decoder.container(keyedBy: CodingKeys.self)
            request = try LocalVaultSharedRename.request(c.superDecoder(forKey: .request))
            scope = try LocalVaultSharedRename.scope(c.superDecoder(forKey: .scope))
            status = try c.decode(String.self, forKey: .status); relativePath = try c.decode(String.self, forKey: .relativePath)
            revision = try c.decodeIfPresent(String.self, forKey: .revision); deleted = try c.decode(Bool.self, forKey: .deleted)
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(request, forKey: .request); try c.encode(scope, forKey: .scope)
            try c.encode(status, forKey: .status); try c.encode(relativePath, forKey: .relativePath)
            if let revision { try c.encode(revision, forKey: .revision) } else { try c.encodeNil(forKey: .revision) }
            try c.encode(deleted, forKey: .deleted)
        }
    }
    struct Resolution: Codable, Equatable, Sendable {
        let localPath: String, remotePath: String
        let localGeneration: LocalVaultGeneration, remoteGeneration: LocalVaultGeneration
        let typed: Bool
        var localLifecycle: String? { localGeneration.lifecycle }
        var remoteLifecycle: String? { remoteGeneration.lifecycle }
        init(localPath: String, remotePath: String, localLifecycle: String, remoteLifecycle: String) {
            self.localPath = localPath; self.remotePath = remotePath
            localGeneration = .present(localLifecycle); remoteGeneration = .present(remoteLifecycle); typed = false
        }
        init(localPath: String, remotePath: String, localGeneration: LocalVaultGeneration, remoteGeneration: LocalVaultGeneration) {
            self.localPath = localPath; self.remotePath = remotePath
            self.localGeneration = localGeneration; self.remoteGeneration = remoteGeneration; typed = true
        }
        private enum CodingKeys: String, CodingKey { case localPath, remotePath, localLifecycle, remoteLifecycle, localGeneration, remoteGeneration }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            typed = c.contains(.localGeneration) || c.contains(.remoteGeneration)
            try LocalVaultSharedRename.keys(decoder, typed ? ["localPath", "remotePath", "localGeneration", "remoteGeneration"] : ["localPath", "remotePath", "localLifecycle", "remoteLifecycle"])
            localPath = try c.decode(String.self, forKey: .localPath); remotePath = try c.decode(String.self, forKey: .remotePath)
            localGeneration = typed ? try c.decode(LocalVaultGeneration.self, forKey: .localGeneration) : .present(try c.decode(String.self, forKey: .localLifecycle))
            remoteGeneration = typed ? try c.decode(LocalVaultGeneration.self, forKey: .remoteGeneration) : .present(try c.decode(String.self, forKey: .remoteLifecycle))
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(localPath, forKey: .localPath); try c.encode(remotePath, forKey: .remotePath)
            if typed { try c.encode(localGeneration, forKey: .localGeneration); try c.encode(remoteGeneration, forKey: .remoteGeneration) }
            else { try c.encode(localLifecycle, forKey: .localLifecycle); try c.encode(remoteLifecycle, forKey: .remoteLifecycle) }
        }
    }
    struct Record: Codable, Equatable, Sendable {
        let version: Int
        let rootHash: String
        let request: LocalVaultProtectedRenameRequest
        let scope: LocalVaultProtectedRenameScope
        let baselineHash: String
        let generation: LocalVaultGeneration
        var lifecycle: String? { generation.lifecycle }
        let phase: Phase
        let receipt: Receipt?
        let resolution: Resolution?
        init(rootHash: String, request: LocalVaultProtectedRenameRequest, scope: LocalVaultProtectedRenameScope, baselineHash: String, lifecycle: String? = nil, generation: LocalVaultGeneration? = nil, phase: Phase = .pending, receipt: Receipt? = nil, resolution: Resolution? = nil) {
            version = generation == nil ? 1 : 2; self.rootHash = rootHash; self.request = request; self.scope = scope; self.baselineHash = baselineHash; self.generation = generation ?? lifecycle.map(LocalVaultGeneration.present) ?? .unknown; self.phase = phase; self.receipt = receipt; self.resolution = resolution
        }
        private enum CodingKeys: String, CodingKey { case version, rootHash, request, scope, baselineHash, lifecycle, generation, phase, receipt, resolution }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            version = try c.decode(Int.self, forKey: .version)
            try LocalVaultSharedRename.keys(decoder, ["version", "rootHash", "request", "scope", "baselineHash", version == 1 ? "lifecycle" : "generation", "phase", "receipt", "resolution"])
            rootHash = try c.decode(String.self, forKey: .rootHash)
            request = try LocalVaultSharedRename.request(c.superDecoder(forKey: .request)); scope = try LocalVaultSharedRename.scope(c.superDecoder(forKey: .scope))
            baselineHash = try c.decode(String.self, forKey: .baselineHash)
            generation = version == 1 ? .present(try c.decode(String.self, forKey: .lifecycle)) : try c.decode(LocalVaultGeneration.self, forKey: .generation)
            phase = try c.decode(Phase.self, forKey: .phase); receipt = try c.decodeIfPresent(Receipt.self, forKey: .receipt); resolution = try c.decodeIfPresent(Resolution.self, forKey: .resolution)
            try LocalVaultSharedRename.validate(self, rootHash: rootHash, scope: scope)
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(version, forKey: .version); try c.encode(rootHash, forKey: .rootHash); try c.encode(request, forKey: .request); try c.encode(scope, forKey: .scope)
            try c.encode(baselineHash, forKey: .baselineHash)
            if version == 1 { try c.encode(lifecycle, forKey: .lifecycle) } else { try c.encode(generation, forKey: .generation) }
            try c.encode(phase, forKey: .phase)
            if let receipt { try c.encode(receipt, forKey: .receipt) } else { try c.encodeNil(forKey: .receipt) }
            if let resolution { try c.encode(resolution, forKey: .resolution) } else { try c.encodeNil(forKey: .resolution) }
        }
    }
    enum Result: Equatable { case moved(String), rejected(Record) }
    struct Context { let rootHash: String; let scope: LocalVaultProtectedRenameScope }
    struct ReplacementObservation {
        let rootHash: String
        let scope: LocalVaultProtectedRenameScope
        let localPath: String, remotePath: String
        let localLifecycle: String?, remoteLifecycle: String?
        let remoteRevision: String, checkpointPath: String
        let checkpointReady: Bool, localUnique: Bool, organizePermitted: Bool
        var localGeneration: LocalVaultGeneration? = nil
        var remoteGeneration: LocalVaultGeneration? = nil
    }
    struct ArchiveProof {
        let operationId: String, rootHash: String, scope: LocalVaultProtectedRenameScope, recordHash: String
        let durable: Bool
    }
    private static func hash(_ value: String) -> Bool { value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
    private static func text(_ value: String, maximum: Int) -> Bool { !value.isEmpty && value.utf8.count <= maximum && !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 } }
    private static func path(_ value: String) -> Bool {
        guard text(value, maximum: 1024), !value.contains("\\"), !value.contains(":"), value.lowercased().hasSuffix(".textpack"),
              !value.hasPrefix("/"), !(value.count >= 2 && value[value.index(after: value.startIndex)] == ":") else { return false }
        return value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    static func validate(_ record: Record, rootHash: String, scope: LocalVaultProtectedRenameScope) throws {
        guard (record.version == 1 || record.version == 2), record.generation.known, (record.version != 1 || record.lifecycle != nil), hash(rootHash), record.rootHash == rootHash, record.scope == scope,
              let account = scope.accountId, text(account, maximum: 256),
              scope.workspaceId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\z", options: .regularExpression) != nil,
              let origin = URL(string: scope.origin),
              try PortableWorkspaceBinding.normalized(.init(origin: origin, workspaceId: scope.workspaceId)).origin.absoluteString == scope.origin,
              (record.lifecycle == nil || text(record.lifecycle!, maximum: 512)), hash(record.baselineHash), hash(record.request.baseRevision),
              let operation = UUID(uuidString: record.request.operationId), operation.uuidString.lowercased() == record.request.operationId,
              record.request.itemId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\z", options: .regularExpression) != nil,
              path(record.request.source), path(record.request.destination), record.request.source != record.request.destination else { throw Failure.invalid }
        _ = try LocalVaultAccountIdentity.validate(account)
        switch record.phase {
        case .pending: guard record.receipt == nil, record.resolution == nil else { throw Failure.invalid }
        case .terminalRejected, .stopped:
            guard let receipt = record.receipt, receipt.request == record.request, receipt.scope == scope, receipt.status == "conflict", path(receipt.relativePath), receipt.revision == nil || hash(receipt.revision!) else { throw Failure.invalid }
            if record.phase == .terminalRejected { guard record.resolution == nil else { throw Failure.invalid } }
            else {
                guard let resolution = record.resolution, !receipt.deleted, receipt.revision != nil, path(resolution.localPath), path(resolution.remotePath), resolution.remotePath == receipt.relativePath,
                      resolution.typed == (record.version == 2), resolution.localGeneration.matches(record.generation), resolution.remoteGeneration.matches(record.generation) else { throw Failure.invalid }
            }
        }
    }
    static func validateMap(_ records: [String: Record], rootHash: String, scope: LocalVaultProtectedRenameScope) throws {
        guard records.count <= 1000 else { throw Failure.invalid }
        var operations = Set<String>()
        for (item, record) in records {
            guard item == record.request.itemId, operations.insert(record.request.operationId).inserted else { throw Failure.invalid }
            try validate(record, rootHash: rootHash, scope: scope)
        }
    }
    static func consume(_ value: LocalVaultProtectedRenameReceipt, for record: Record) throws -> Result {
        try validate(record, rootHash: record.rootHash, scope: record.scope)
        guard record.phase == .pending, value.request == record.request, value.scope == record.scope else { throw Failure.changed }
        if value.status == "moved" {
            guard value.relativePath == record.request.destination, value.revision == record.request.baseRevision, !value.deleted else { throw Failure.invalid }
            return .moved(record.request.baseRevision)
        }
        guard value.status == "conflict" else { throw Failure.invalid }
        let rejected = Record(rootHash: record.rootHash, request: record.request, scope: record.scope, baselineHash: record.baselineHash, lifecycle: record.lifecycle, generation: record.version == 2 ? record.generation : nil, phase: .terminalRejected, receipt: Receipt(value))
        try validate(rejected, rootHash: record.rootHash, scope: record.scope)
        return .rejected(rejected)
    }
    static func stopped(_ record: Record, resolution: Resolution) throws -> Record {
        guard record.phase == .terminalRejected else { throw Failure.changed }
        let result = Record(rootHash: record.rootHash, request: record.request, scope: record.scope, baselineHash: record.baselineHash, lifecycle: record.lifecycle, generation: record.version == 2 ? record.generation : nil, phase: .stopped, receipt: record.receipt, resolution: resolution)
        try validate(result, rootHash: record.rootHash, scope: record.scope); return result
    }
    // A fact-consistency guard for a later packaged policy decision, never a
    // native scheduling fallback. No revision/hash is an input to this guard.
    static func matchesStoppedFacts(_ record: Record, localPath: String, remotePath: String, localLifecycle: String?, remoteLifecycle: String?, unique: Bool,
        localGeneration: LocalVaultGeneration? = nil, remoteGeneration: LocalVaultGeneration? = nil) -> Bool {
        do { try validate(record, rootHash: record.rootHash, scope: record.scope) } catch { return false }
        guard record.phase == .stopped, let resolution = record.resolution, unique else { return false }
        return resolution.localPath == localPath && resolution.remotePath == remotePath &&
            resolution.localGeneration.matches(localGeneration ?? localLifecycle.map(LocalVaultGeneration.present) ?? .unknown) &&
            resolution.remoteGeneration.matches(remoteGeneration ?? remoteLifecycle.map(LocalVaultGeneration.present) ?? .unknown)
    }
    static func archiveBytes(_ record: Record) throws -> Data {
        try validate(record, rootHash: record.rootHash, scope: record.scope)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; return try encoder.encode(record)
    }
    /// No file is written here. writeState commits the complete State through
    /// the existing actor writer; an archive callback uses its immutable recovery
    /// writer and the original operation ID as deterministic create-only identity.
    static func commit(context: Context, current: [String: Record], itemId: String, expected: Record?, replacement: Record?, completion: LocalVaultProtectedRenameReceipt? = nil,
        observation: ReplacementObservation? = nil, archive: ((Record, Data) throws -> ArchiveProof)? = nil, writeState: ([String: Record]) throws -> Void) throws -> [String: Record] {
        guard current[itemId] == expected, let basis = expected ?? replacement else { throw Failure.changed }
        try validate(basis, rootHash: context.rootHash, scope: context.scope)
        try validateMap(current, rootHash: context.rootHash, scope: context.scope)
        if let replacement { try validate(replacement, rootHash: context.rootHash, scope: context.scope) }
        if expected == replacement { return current }
        if let expected, let replacement {
            if expected.request == replacement.request {
                guard expected.version == replacement.version, expected.rootHash == replacement.rootHash, expected.scope == replacement.scope, expected.baselineHash == replacement.baselineHash, expected.generation == replacement.generation,
                      (expected == replacement || expected.phase == .pending && replacement.phase == .terminalRejected || expected.phase == .terminalRejected && replacement.phase == .stopped && expected.receipt == replacement.receipt) else { throw Failure.changed }
            } else {
                guard expected.phase == .stopped, replacement.phase == .pending, expected.request.operationId != replacement.request.operationId,
                      expected.scope == replacement.scope, expected.rootHash == replacement.rootHash, expected.request.itemId == replacement.request.itemId,
                      expected.generation == replacement.generation, let resolution = expected.resolution, let observation,
                      observation.rootHash == expected.rootHash, observation.scope == expected.scope,
                      observation.localPath != resolution.localPath, observation.localPath == replacement.request.destination,
                      observation.remotePath == resolution.remotePath, observation.remotePath == replacement.request.source,
                      (observation.localGeneration ?? observation.localLifecycle.map(LocalVaultGeneration.present) ?? .unknown).matches(expected.generation),
                      (observation.remoteGeneration ?? observation.remoteLifecycle.map(LocalVaultGeneration.present) ?? .unknown).matches(expected.generation),
                      observation.remoteRevision == replacement.request.baseRevision, observation.checkpointPath == observation.localPath,
                      observation.checkpointReady, observation.localUnique, observation.organizePermitted, let archive else { throw Failure.changed }
                let bytes = try archiveBytes(expected), proof = try archive(expected, bytes)
                guard proof.durable, proof.operationId == expected.request.operationId, proof.rootHash == expected.rootHash, proof.scope == expected.scope,
                      proof.recordHash == TextTextStableDigest.sha256Hex(bytes) else { throw Failure.archive }
            }
        } else if let expected {
            guard let completion, case .moved = try consume(completion, for: expected) else { throw Failure.changed }
        } else { guard replacement?.phase == .pending else { throw Failure.changed } }
        var next = current; next[itemId] = replacement
        try validateMap(next, rootHash: context.rootHash, scope: context.scope)
        try writeState(next)
        return next
    }
}
