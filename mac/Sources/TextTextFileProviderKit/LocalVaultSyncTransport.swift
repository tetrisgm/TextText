import Foundation
import CoreFoundation

/// The immutable command and transport binding travel with every typed reply.
/// A generic HTTP conflict is deliberately not a terminal rename receipt.
public struct LocalVaultProtectedRenameRequest: Codable, Sendable, Equatable {
    public let operationId: String, itemId: String, source: String, destination: String, baseRevision: String
    public init(operationId: String, itemId: String, source: String, destination: String, baseRevision: String) {
        self.operationId = operationId; self.itemId = itemId; self.source = source; self.destination = destination; self.baseRevision = baseRevision
    }
}
public struct LocalVaultProtectedRenameScope: Codable, Sendable, Equatable {
    public let origin: String, workspaceId: String
    public let accountId: String?
}
public struct LocalVaultProtectedRenameReceipt: Codable, Sendable, Equatable {
    public let request: LocalVaultProtectedRenameRequest
    public let scope: LocalVaultProtectedRenameScope
    public let status: String, relativePath: String
    public let revision: String?
    public let deleted: Bool
}

public struct LocalVaultRemoteItem: Codable, Sendable, Equatable {
    public let itemId: String
    public let relativePath: String
    public let revision: String
    public let canEditContent: Bool?
    public let deleted: Bool?
    public let lifecycle: String?
    public let restoreFromRevision: String?
    public var isDeleted: Bool { deleted == true }
    public init(itemId: String, relativePath: String, revision: String, deleted: Bool = false, canEditContent: Bool? = nil, lifecycle: String? = nil, restoreFromRevision: String? = nil) {
        self.canEditContent = canEditContent
        self.itemId = itemId; self.relativePath = relativePath; self.revision = revision; self.deleted = deleted; self.lifecycle = lifecycle; self.restoreFromRevision = restoreFromRevision
    }
}

public struct LocalVaultRemotePack: Sendable {
    public let data: Data
    public let relativePath: String
    public let revision: String
    public init(data: Data, relativePath: String, revision: String) {
        self.data = data; self.relativePath = relativePath; self.revision = revision
    }
}

public enum LocalVaultSyncFailure: Error, LocalizedError {
    case conflict, invalidResponse, invalidBinding, busy, changed, duplicateIdentity(String), httpStatus(Int)
    public var errorDescription: String? {
        switch self {
        case .conflict: return "Both copies changed. Resolve the saved conflict copies."
        case .invalidResponse: return "The sync server returned an invalid document or response."
        case .httpStatus(let status): return "The sync server returned HTTP \(status)."
        case .invalidBinding: return "Choose a valid workspace and HTTPS server before connecting this folder."
        case .busy: return "This folder already has a sync pass running."
        case .changed: return "The local file changed during sync; the next pass will retry."
        case .duplicateIdentity(let path): return "This document identity moved or is duplicated: \(path)."
        }
    }
}

public struct LocalVaultSyncCapabilities: Sendable, Codable, Equatable {
    public let fullAccess: Bool
    public let canCreateContent: Bool
    public let writableFolders: [String]
    public let writableItems: Set<String>
    public var knownPaths: Set<String> = []
    public var writablePaths: Set<String> = []
    public var pathIdentities: [String: String]? = nil
    public func canEdit(path: String) -> Bool {
        if knownPaths.contains(path) { return writablePaths.contains(path) }
        return canCreateContent || writableFolders.contains { path.hasPrefix($0 + "/") }
    }
}

public struct LocalVaultFolderCaseItem: Codable, Sendable, Equatable {
    public let itemId: String, relativePath: String, revision: String
}
public struct LocalVaultFolderCaseRequest: Codable, Sendable, Equatable {
    public let operationId: String, source: String, destination: String, baseManifestRevision: String
    public let folders: [String]
    public let items: [LocalVaultFolderCaseItem]
}
public struct LocalVaultFolderCaseReceipt: Codable, Sendable, Equatable {
    public let operationId: String, status: String, source: String, destination: String, manifestRevision: String
    public let folders: [String]
    public let items: [LocalVaultFolderCaseItem]
}
public struct LocalVaultFolderCaseContext: Sendable {
    public let manifestRevision: String
    public let folders: [String]
}

public protocol LocalVaultSyncTransport: Sendable {
    var protectedRenameBinding: LocalVaultProtectedRenameScope? { get }
    func folderCaseContext() async -> LocalVaultFolderCaseContext?
    func moveFolderCase(_ request: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseReceipt
    func inspectFolderCase(_ command: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseServerRecovery
    func cancelFolderCase(_ command: LocalVaultFolderCaseRequest, inspection: String) async throws -> LocalVaultFolderCaseServerRecovery
    func canOrganize() async -> Bool
    func canWrite(itemId: String, path: String, existing: Bool) async -> Bool
    func manifest() async throws -> [LocalVaultRemoteItem]
    /// A fresh complete authenticated response, never an upgrade of an old
    /// optional-lifecycle cache. Legacy transports cannot certify absence.
    func generationEvidence(itemId: String) async throws -> LocalVaultManifestGenerationEvidence?
    func folders() async -> [String]
    func authoritativeFolders() async -> [String]?
    func download(itemId: String) async throws -> LocalVaultRemotePack
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String
    func protectedRename(_ request: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws
    func binaryManifest(itemId: String) async throws -> LocalVaultBinaryManifest
    func binaryRead(itemId: String, entryPath: String) async throws -> Data
    func binaryPatch(itemId: String, operationId: String, entryPath: String, expectedHash: String?, expectedLifecycle: String?, bytes: Data?) async throws -> String
}

public struct LocalVaultBinaryManifest: Codable, Sendable {
    public struct Entry: Codable, Sendable {
        public let path: String
        public let sha256: String
        public let size: Int
    }
    public let revision: String
    public let entries: [Entry]
}

public extension LocalVaultSyncTransport {
    func generationEvidence(itemId: String) async throws -> LocalVaultManifestGenerationEvidence? { nil }
    var protectedRenameBinding: LocalVaultProtectedRenameScope? { nil }
    func protectedRename(_ request: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt { throw LocalVaultSyncFailure.invalidResponse }
    func inspectFolderCase(_ command: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseServerRecovery { throw LocalVaultSyncFailure.invalidResponse }
    func cancelFolderCase(_ command: LocalVaultFolderCaseRequest, inspection: String) async throws -> LocalVaultFolderCaseServerRecovery { throw LocalVaultSyncFailure.invalidResponse }
    func folderCaseContext() async -> LocalVaultFolderCaseContext? { nil }
    func moveFolderCase(_ request: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseReceipt { throw LocalVaultSyncFailure.invalidResponse }
    func folders() async -> [String] { [] }
    func authoritativeFolders() async -> [String]? { nil }
    func canOrganize() async -> Bool { true }
    func canWrite(itemId: String, path: String, existing: Bool) async -> Bool { true }
    func binaryManifest(itemId: String) async throws -> LocalVaultBinaryManifest { throw LocalVaultSyncFailure.invalidResponse }
    func binaryRead(itemId: String, entryPath: String) async throws -> Data { throw LocalVaultSyncFailure.invalidResponse }
    func binaryPatch(itemId: String, operationId: String, entryPath: String, expectedHash: String?, expectedLifecycle: String?, bytes: Data?) async throws -> String { throw LocalVaultSyncFailure.invalidResponse }
}

/// Bearer credentials live only in this transport, never in vault files.
public actor HTTPLocalVaultSyncTransport: LocalVaultSyncTransport {
    private let endpoint: URL
    private let protectedRenameScope: LocalVaultProtectedRenameScope
    public nonisolated var protectedRenameBinding: LocalVaultProtectedRenameScope? { protectedRenameScope }
    private let accountId: String?
    private var token: String
    private var credentialEpoch = UUID()
    private let session: URLSession
    private var manifestETag: String?
    private var fullAccess = false
    private var canCreateContent = false
    private var writableFolders: [String] = []
    private var cachedFolders: [String] = []
    private var hasFolderCatalog = false
    public func folders() -> [String] { cachedFolders }
    public func authoritativeFolders() async -> [String]? { hasFolderCatalog && fullAccess && canCreateContent ? cachedFolders : nil }
    private var folderCaseRevision: String?
    public func folderCaseContext() async -> LocalVaultFolderCaseContext? {
        guard accountId != nil, fullAccess, canCreateContent, hasFolderCatalog, let folderCaseRevision else { return nil }
        return .init(manifestRevision: folderCaseRevision, folders: cachedFolders)
    }
    public func moveFolderCase(_ command: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseReceipt {
        try LocalVaultFolderCaseSync.validateWire(command)
        guard await folderCaseContext() != nil else { throw LocalVaultSyncFailure.invalidResponse }
        var request = request(endpoint.deletingLastPathComponent().appendingPathComponent("folder-case-moves"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(command)
        let (data, _) = try await send(request)
        guard let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(fields.keys) == Set(["operationId", "status", "source", "destination", "folders", "items", "manifestRevision"]),
              let items = fields["items"] as? [[String: Any]], items.allSatisfy({ Set($0.keys) == Set(["itemId", "relativePath", "revision"]) }) else { throw LocalVaultSyncFailure.invalidResponse }
        return try JSONDecoder().decode(LocalVaultFolderCaseReceipt.self, from: data)
    }
    public func inspectFolderCase(_ command: LocalVaultFolderCaseRequest) async throws -> LocalVaultFolderCaseServerRecovery { try await folderCaseRecovery(command, inspection: nil) }
    public func cancelFolderCase(_ command: LocalVaultFolderCaseRequest, inspection: String) async throws -> LocalVaultFolderCaseServerRecovery { try await folderCaseRecovery(command, inspection: inspection) }
    private func folderCaseRecovery(_ command: LocalVaultFolderCaseRequest, inspection: String?) async throws -> LocalVaultFolderCaseServerRecovery {
        try LocalVaultFolderCaseSync.validateWire(command)
        struct Body: Encodable { let action: String; let command: LocalVaultFolderCaseRequest; let inspection: String?; let consent: Bool? }
        var request = request(endpoint.deletingLastPathComponent().appendingPathComponent("folder-case-moves/recovery"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = inspection == nil ? 2 : 30
        request.httpBody = try JSONEncoder().encode(Body(action: inspection == nil ? "inspect" : "cancel", command: command, inspection: inspection, consent: inspection == nil ? nil : true))
        let (data, _) = try await send(request)
        guard let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any], let state = fields["state"] as? String else { throw LocalVaultSyncFailure.invalidResponse }
        let expected: Set<String>
        switch state {
        case "completed": expected = ["state", "requestHash", "result"]
        case "review": expected = ["state", "operationId", "requestHash", "source", "destination", "inspection", "manifestRevision", "folders", "items"]
        case "cancelled": expected = ["state", "operationId", "requestHash", "source", "destination", "inspection", "manifestRevision"]
        default: throw LocalVaultSyncFailure.invalidResponse
        }
        guard Set(fields.keys) == expected else { throw LocalVaultSyncFailure.invalidResponse }
        if let result = fields["result"] as? [String: Any] {
            guard Set(result.keys) == Set(["operationId", "status", "source", "destination", "folders", "items", "manifestRevision"]) else { throw LocalVaultSyncFailure.invalidResponse }
        }
        for value in [fields["items"], (fields["result"] as? [String: Any])?["items"]].compactMap({ $0 }) {
            guard let rows = value as? [[String: Any]], rows.allSatisfy({ Set($0.keys) == Set(["itemId", "relativePath", "revision"]) }) else { throw LocalVaultSyncFailure.invalidResponse }
        }
        return try JSONDecoder().decode(LocalVaultFolderCaseServerRecovery.self, from: data)
    }
    private var cachedManifest: [LocalVaultRemoteItem] = []

    public init(origin: URL, workspaceId: String, token: String, session: URLSession = .shared, accountId: String? = nil) throws {
        try LocalVaultSyncBinding.validate(origin: origin, workspaceId: workspaceId)
        self.endpoint = origin.appendingPathComponent("api/vault").appendingPathComponent(workspaceId).appendingPathComponent("items")
        self.protectedRenameScope = .init(origin: origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), workspaceId: workspaceId, accountId: accountId)
        if let accountId { _ = try LocalVaultAccountIdentity.validate(accountId) }
        self.accountId = accountId
        self.token = token; self.session = session
    }

    public func canOrganize() async -> Bool { fullAccess && canCreateContent }
    public func capabilities() -> LocalVaultSyncCapabilities {
        var value = LocalVaultSyncCapabilities(fullAccess: fullAccess, canCreateContent: canCreateContent,
            writableFolders: writableFolders, writableItems: Set(cachedManifest.filter { $0.canEditContent == true }.map(\.itemId)))
        value.knownPaths = Set(cachedManifest.map(\.relativePath))
        value.writablePaths = Set(cachedManifest.filter { $0.canEditContent == true }.map(\.relativePath))
        value.pathIdentities = Dictionary(grouping: cachedManifest.filter { $0.deleted != true }, by: \.relativePath)
            .compactMapValues { $0.count == 1 ? $0[0].itemId : nil }
        return value
    }
    public func canWrite(itemId: String, path: String, existing: Bool) async -> Bool {
        let canCreate = canCreateContent || writableFolders.contains { folder in path.hasPrefix(folder + "/") }
        if let item = cachedManifest.first(where: { $0.itemId == itemId }) {
            return item.canEditContent == true && (item.relativePath == path || canCreate)
        }
        return !existing && canCreate
    }

    public func updateToken(_ token: String, accountId: String? = nil) throws {
        guard self.accountId == accountId else { throw LocalVaultAccountIdentity.Failure.unverified }
        if self.token != token { credentialEpoch = UUID() }
        self.token = token
    }

    private func request(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let accountId { request.setValue(accountId, forHTTPHeaderField: "X-TextText-Account") }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw LocalVaultSyncFailure.invalidResponse }
        if response.statusCode == 409 || response.statusCode == 412 { throw LocalVaultSyncFailure.conflict }
        guard ((200..<300).contains(response.statusCode) || response.statusCode == 304) else {
            throw LocalVaultSyncFailure.httpStatus(response.statusCode)
        }
        guard data.count <= 64 * 1024 * 1024 else { throw LocalVaultSyncFailure.invalidResponse }
        return (data, response)
    }

    private func loadManifest(wait: Bool) async throws -> Bool {
        struct Manifest: Decodable {
            let items: [LocalVaultRemoteItem]
            let tombstones: [LocalVaultRemoteItem]?
            let folders: [String]?
            let fullAccess: Bool?
            let canCreateContent: Bool?
            let writableFolders: [String]?
            let manifestRevision: String?
            let syncCapabilities: [String]?
        }
        var url = endpoint
        if wait {
            var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "wait", value: "25")]
            url = components.url!
        }
        var request = request(url)
        if let manifestETag { request.setValue(manifestETag, forHTTPHeaderField: "If-None-Match") }
        if wait { request.timeoutInterval = 35 }
        let (data, response) = try await send(request)
        if response.statusCode == 304 { return false }
        let decoded = try JSONDecoder().decode(Manifest.self, from: data)
        let manifest = (decoded.items + (decoded.tombstones ?? []).map {
            LocalVaultRemoteItem(itemId: $0.itemId, relativePath: $0.relativePath, revision: $0.revision, deleted: true, canEditContent: $0.canEditContent, lifecycle: $0.lifecycle, restoreFromRevision: $0.restoreFromRevision)
        }).sorted { $0.itemId < $1.itemId }
        let folders = (decoded.folders ?? []).sorted()
        let previousCapabilities = (fullAccess, canCreateContent, writableFolders)
        fullAccess = decoded.fullAccess == true
        canCreateContent = decoded.canCreateContent == true
        writableFolders = (decoded.writableFolders ?? []).filter { !$0.isEmpty && !$0.hasPrefix("/") && !$0.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) && !$0.contains("\\") }
        let nextCaseRevision = decoded.syncCapabilities?.contains("folder-case-moves-v1") == true && decoded.manifestRevision?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil ? decoded.manifestRevision : nil
        let caseChanged = nextCaseRevision != folderCaseRevision
        folderCaseRevision = nextCaseRevision
        let changed = caseChanged || hasFolderCatalog != (decoded.folders != nil && decoded.fullAccess == true && decoded.canCreateContent == true) || manifest != cachedManifest || folders != cachedFolders || previousCapabilities.0 != fullAccess || previousCapabilities.1 != canCreateContent || previousCapabilities.2 != writableFolders
        cachedFolders = folders
        hasFolderCatalog = decoded.folders != nil && decoded.fullAccess == true && decoded.canCreateContent == true
        cachedManifest = manifest
        manifestETag = response.value(forHTTPHeaderField: "ETag")
        return changed
    }

    public func manifest() async throws -> [LocalVaultRemoteItem] {
        _ = try await loadManifest(wait: false)
        return cachedManifest
    }

    public func generationEvidence(itemId: String) async throws -> LocalVaultManifestGenerationEvidence? {
        guard accountId != nil else { return nil }
        let credential = token, epoch = credentialEpoch
        // No If-None-Match: a legacy optional-value cache cannot certify that
        // a lifecycle property was omitted in an authenticated full response.
        let (bytes, response) = try await send(request(endpoint))
        try Task.checkCancellation()
        guard token == credential, credentialEpoch == epoch else { throw LocalVaultSharedFailure.account }
        guard response.statusCode == 200, response.url == endpoint else { throw LocalVaultSyncFailure.invalidResponse }
        return try LocalVaultGenerationManifest.parse(bytes, itemId: itemId, scope: protectedRenameScope)
    }

    /// Request-scoped server watch. Cancelling the task cancels URLSession;
    /// unchanged workspaces return 304 with no document download or disk scan.
    public func waitForChange() async throws -> Bool {
        try await loadManifest(wait: true)
    }

    public func download(itemId: String) async throws -> LocalVaultRemotePack {
        let (data, response) = try await send(request(endpoint.appendingPathComponent(itemId)))
        guard let etag = response.value(forHTTPHeaderField: "ETag"),
              let encodedPath = response.value(forHTTPHeaderField: "X-TextText-Path"),
              let path = encodedPath.removingPercentEncoding else { throw LocalVaultSyncFailure.invalidResponse }
        return .init(data: data, relativePath: path, revision: etag.trimmingCharacters(in: CharacterSet(charactersIn: "\"")))
    }

    public func binaryManifest(itemId: String) async throws -> LocalVaultBinaryManifest {
        let (data, _) = try await send(request(endpoint.appendingPathComponent(itemId).appendingPathComponent("binary")))
        let manifest = try JSONDecoder().decode(LocalVaultBinaryManifest.self, from: data)
        guard manifest.revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              manifest.entries.count <= 10_000,
              manifest.entries.allSatisfy({ $0.path.hasPrefix("assets/") && $0.size >= 0 && $0.size <= 64 * 1024 * 1024 &&
                  $0.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else {
            throw LocalVaultSyncFailure.invalidResponse
        }
        return manifest
    }

    public func binaryRead(itemId: String, entryPath: String) async throws -> Data {
        guard entryPath.hasPrefix("assets/"), entryPath.utf8.count <= 512,
              !entryPath.contains("\\"), !entryPath.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            throw LocalVaultSyncFailure.invalidResponse
        }
        var url = URLComponents(url: endpoint.appendingPathComponent(itemId).appendingPathComponent("binary"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "entry", value: entryPath)]
        return try await send(request(url.url!)).0
    }

    public func binaryPatch(itemId: String, operationId: String, entryPath: String, expectedHash: String?, expectedLifecycle: String?, bytes: Data?) async throws -> String {
        guard bytes == nil || bytes!.count <= 16 * 1024 * 1024 else { throw LocalVaultSyncFailure.invalidResponse }
        var request = request(endpoint.appendingPathComponent(itemId).appendingPathComponent("binary"))
        request.httpMethod = "PATCH"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["operationId": operationId, "entryPath": entryPath,
            "expectedHash": expectedHash as Any? ?? NSNull(), "expectedLifecycle": expectedLifecycle as Any? ?? NSNull(),
            "bytesBase64": bytes?.base64EncodedString() as Any? ?? NSNull()])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        struct Receipt: Decodable { let revision: String }
        let (data, _) = try await send(request)
        return try JSONDecoder().decode(Receipt.self, from: data).revision
    }

    public func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String {
        var request = request(endpoint.appendingPathComponent(itemId))
        request.httpMethod = "PUT"; request.httpBody = data
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(path.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-TextText-Path")
        request.setValue(operationId, forHTTPHeaderField: "X-TextText-Operation-Id")
        request.setValue(nativeEditor ? "native-editor" : "local-file", forHTTPHeaderField: "X-TextText-Edit-Origin")
        if let baseRevision { request.setValue("\"\(baseRevision)\"", forHTTPHeaderField: "If-Match") }
        else { request.setValue("*", forHTTPHeaderField: "If-None-Match") }
        struct Receipt: Decodable { let revision: String }
        let (response, _) = try await send(request)
        return try JSONDecoder().decode(Receipt.self, from: response).revision
    }
    public func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String {
        var request = request(endpoint.appendingPathComponent(itemId))
        request.httpMethod = "PATCH"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["relativePath": to])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\"\(baseRevision)\"", forHTTPHeaderField: "If-Match")
        request.setValue(from.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-TextText-Base-Path")
        request.setValue(operationId, forHTTPHeaderField: "X-TextText-Operation-Id")
        struct Receipt: Decodable { let revision: String }
        let (data, _) = try await send(request)
        return try JSONDecoder().decode(Receipt.self, from: data).revision
    }

    public func protectedRename(_ command: LocalVaultProtectedRenameRequest) async throws -> LocalVaultProtectedRenameReceipt {
        try Self.validateProtectedRename(command)
        guard accountId != nil else { throw LocalVaultSharedFailure.account }
        let credential = token, epoch = credentialEpoch
        var request = request(endpoint.appendingPathComponent(command.itemId))
        request.httpMethod = "PATCH"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["relativePath": command.destination])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\"\(command.baseRevision)\"", forHTTPHeaderField: "If-Match")
        request.setValue(command.source.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-TextText-Base-Path")
        request.setValue(command.operationId, forHTTPHeaderField: "X-TextText-Operation-Id")
        // This path alone reads 409 bodies. Ordinary mutations keep their
        // existing conflict behavior. No error body is a terminal receipt.
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard token == credential, credentialEpoch == epoch else { throw LocalVaultSharedFailure.account }
        guard let response = response as? HTTPURLResponse else { throw LocalVaultSyncFailure.invalidResponse }
        guard response.url == request.url else { throw LocalVaultSyncFailure.invalidResponse }
        guard response.statusCode == 200 || response.statusCode == 409 else { throw LocalVaultSyncFailure.httpStatus(response.statusCode) }
        return try Self.parseProtectedRename(command, scope: protectedRenameScope, status: response.statusCode, data: data)
    }
    private static func renameDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func renamePath(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 1024 && value.lowercased().hasSuffix(".textpack") &&
        !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 || $0 == "\\" || $0 == ":" } &&
        value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    private static func validateProtectedRename(_ command: LocalVaultProtectedRenameRequest) throws {
        func segment(_ value: String) -> Bool {
            value.range(of: "\\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\z", options: .regularExpression) != nil
        }
        guard segment(command.operationId), segment(command.itemId), renamePath(command.source), renamePath(command.destination), renameDigest(command.baseRevision) else { throw LocalVaultSyncFailure.invalidResponse }
    }
    /// Flat wire objects only. Count every key, including duplicates that
    /// Foundation's dictionary decoder would otherwise silently overwrite.
    private static func protectedRenameKeys(_ data: Data) throws -> [String] {
        let bytes = Array(data); var i = 0; var keys: [String] = []
        func whitespace() { while i < bytes.count && [9, 10, 13, 32].contains(bytes[i]) { i += 1 } }
        func string() throws -> Data {
            guard i < bytes.count, bytes[i] == 34 else { throw LocalVaultSyncFailure.invalidResponse }
            let start = i; i += 1
            while i < bytes.count {
                if bytes[i] == 92 { i += 2; continue }
                if bytes[i] == 34 { i += 1; return Data(bytes[start..<i]) }
                i += 1
            }
            throw LocalVaultSyncFailure.invalidResponse
        }
        whitespace(); guard i < bytes.count, bytes[i] == 123 else { throw LocalVaultSyncFailure.invalidResponse }; i += 1
        while true {
            whitespace(); guard i < bytes.count, bytes[i] != 125 else { throw LocalVaultSyncFailure.invalidResponse }
            keys.append(try JSONDecoder().decode(String.self, from: string()))
            whitespace(); guard i < bytes.count, bytes[i] == 58 else { throw LocalVaultSyncFailure.invalidResponse }; i += 1; whitespace()
            if i < bytes.count, bytes[i] == 34 { _ = try string() }
            else { while i < bytes.count && ![44, 125].contains(bytes[i]) { guard bytes[i] != 123 && bytes[i] != 91 else { throw LocalVaultSyncFailure.invalidResponse }; i += 1 } }
            whitespace(); guard i < bytes.count else { throw LocalVaultSyncFailure.invalidResponse }
            if bytes[i] == 125 { i += 1; break }
            guard bytes[i] == 44 else { throw LocalVaultSyncFailure.invalidResponse }; i += 1
        }
        whitespace(); guard i == bytes.count, Set(keys).count == keys.count else { throw LocalVaultSyncFailure.invalidResponse }; return keys
    }
    static func parseProtectedRename(_ command: LocalVaultProtectedRenameRequest, scope: LocalVaultProtectedRenameScope, status: Int, data: Data) throws -> LocalVaultProtectedRenameReceipt {
        try validateProtectedRename(command)
        guard let accountId = scope.accountId, let origin = URL(string: scope.origin) else { throw LocalVaultSyncFailure.invalidResponse }
        _ = try LocalVaultAccountIdentity.validate(accountId)
        try LocalVaultSyncBinding.validate(origin: origin, workspaceId: scope.workspaceId)
        guard data.count <= 16384, status == 200 || status == 409 else { throw LocalVaultSyncFailure.invalidResponse }
        let keys = try protectedRenameKeys(data)
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw LocalVaultSyncFailure.invalidResponse }
        let deleted = value["deleted"] != nil
        let expected = Set(["status", "itemId", "relativePath", "revision"] + (deleted ? ["deleted"] : []))
        guard Set(keys) == expected, value["itemId"] as? String == command.itemId,
              let resultStatus = value["status"] as? String, let path = value["relativePath"] as? String, renamePath(path) else { throw LocalVaultSyncFailure.invalidResponse }
        let revision = value["revision"] as? String
        if status == 200 {
            guard resultStatus == "moved", path == command.destination, revision == command.baseRevision, !deleted else { throw LocalVaultSyncFailure.invalidResponse }
        } else {
            guard resultStatus == "conflict", (value["revision"] is NSNull || revision.map(renameDigest) == true) else { throw LocalVaultSyncFailure.invalidResponse }
            if deleted {
                guard let flag = value["deleted"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(), flag.boolValue else { throw LocalVaultSyncFailure.invalidResponse }
            }
        }
        return .init(request: command, scope: scope, status: resultStatus, relativePath: path, revision: revision, deleted: deleted)
    }

    public func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws {
        var request = request(endpoint.appendingPathComponent(itemId))
        request.httpMethod = "DELETE"
        request.setValue("\"\(baseRevision)\"", forHTTPHeaderField: "If-Match")
        request.setValue(path.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-TextText-Base-Path")
        request.setValue(operationId, forHTTPHeaderField: "X-TextText-Operation-Id")
        _ = try await send(request)
    }

}
