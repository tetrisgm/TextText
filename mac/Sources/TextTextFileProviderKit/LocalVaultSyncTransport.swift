import Foundation

public struct LocalVaultRemoteItem: Codable, Sendable, Equatable {
    public let itemId: String
    public let relativePath: String
    public let revision: String
    public let deleted: Bool?
    public var isDeleted: Bool { deleted == true }
    public init(itemId: String, relativePath: String, revision: String, deleted: Bool = false) {
        self.itemId = itemId; self.relativePath = relativePath; self.revision = revision; self.deleted = deleted
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
    case conflict, invalidResponse, invalidBinding, busy, changed, duplicateIdentity(String)
    public var errorDescription: String? {
        switch self {
        case .conflict: return "Both copies changed. Resolve the saved conflict copies."
        case .invalidResponse: return "The sync server returned an invalid document or response."
        case .invalidBinding: return "Choose a valid workspace and HTTPS server before connecting this folder."
        case .busy: return "This folder already has a sync pass running."
        case .changed: return "The local file changed during sync; the next pass will retry."
        case .duplicateIdentity(let path): return "This document identity moved or is duplicated: \(path)."
        }
    }
}

public protocol LocalVaultSyncTransport: Sendable {
    func manifest() async throws -> [LocalVaultRemoteItem]
    func download(itemId: String) async throws -> LocalVaultRemotePack
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) async throws -> String
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) async throws -> String
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws
}

/// Bearer credentials live only in this transport, never in vault files.
public actor HTTPLocalVaultSyncTransport: LocalVaultSyncTransport {
    private let endpoint: URL
    private let token: String
    private let session: URLSession
    private var manifestETag: String?
    private var cachedManifest: [LocalVaultRemoteItem] = []

    public init(origin: URL, workspaceId: String, token: String, session: URLSession = .shared) throws {
        try LocalVaultSyncBinding.validate(origin: origin, workspaceId: workspaceId)
        self.endpoint = origin.appendingPathComponent("api/vault").appendingPathComponent(workspaceId).appendingPathComponent("items")
        self.token = token; self.session = session
    }

    private func request(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw LocalVaultSyncFailure.invalidResponse }
        if response.statusCode == 409 || response.statusCode == 412 { throw LocalVaultSyncFailure.conflict }
        guard ((200..<300).contains(response.statusCode) || response.statusCode == 304), data.count <= 64 * 1024 * 1024 else {
            throw LocalVaultSyncFailure.invalidResponse
        }
        return (data, response)
    }

    private func loadManifest(wait: Bool) async throws -> Bool {
        struct Manifest: Decodable {
            let items: [LocalVaultRemoteItem]
            let tombstones: [LocalVaultRemoteItem]?
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
            LocalVaultRemoteItem(itemId: $0.itemId, relativePath: $0.relativePath, revision: $0.revision, deleted: true)
        }).sorted { $0.itemId < $1.itemId }
        let changed = manifest != cachedManifest
        cachedManifest = manifest
        manifestETag = response.value(forHTTPHeaderField: "ETag")
        return changed
    }

    public func manifest() async throws -> [LocalVaultRemoteItem] {
        _ = try await loadManifest(wait: false)
        return cachedManifest
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

    public func delete(itemId: String, path: String, baseRevision: String, operationId: String) async throws {
        var request = request(endpoint.appendingPathComponent(itemId))
        request.httpMethod = "DELETE"
        request.setValue("\"\(baseRevision)\"", forHTTPHeaderField: "If-Match")
        request.setValue(path.addingPercentEncoding(withAllowedCharacters: .alphanumerics), forHTTPHeaderField: "X-TextText-Base-Path")
        request.setValue(operationId, forHTTPHeaderField: "X-TextText-Operation-Id")
        _ = try await send(request)
    }

}
