import Foundation
import CoreFoundation
import TextTextFileProviderKit
import TextTextWorkspaceCore

struct LocalVaultCollaborationError: LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
}

/// Narrow authenticated relay. No URL or credential is accepted from JavaScript.
@MainActor
final class LocalVaultCollaboration {
    private struct Context: Sendable { let binding: LocalVaultSyncBinding; let token: String }
    private struct Configuration: Sendable {
        let namespace: String
        let workspaceId: String
        let itemId: String
        var value: [String: Any] { ["namespace": namespace, "workspaceId": workspaceId, "itemId": itemId] }
    }
    private let credentials: () -> (origin: URL, token: String)?
    private let session: URLSession
    private var tasks: [String: Task<Void, Never>] = [:]
    init(credentials: @escaping () -> (origin: URL, token: String)?, session: URLSession? = nil) {
        self.credentials = credentials
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: CollaborationNoRedirect(), delegateQueue: nil)
    }
    deinit { for task in tasks.values { task.cancel() }; session.invalidateAndCancel() }
    func cancel(_ requestId: String) { tasks[requestId]?.cancel() }
    func cancelAll() { for task in tasks.values { task.cancel() }; tasks.removeAll() }

    nonisolated private static func context(root: URL, account: (origin: URL, token: String)?) throws -> Context? {
        guard let account, let stored = try LocalVaultSync.binding(root: root),
              stored.origin.scheme == account.origin.scheme, stored.origin.host == account.origin.host,
              stored.origin.port == account.origin.port else { return nil }
        let binding = try LocalVaultSyncBinding(origin: stored.origin, workspaceId: stored.workspaceId)
        return Context(binding: binding, token: account.token)
    }
    nonisolated static func identifier(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil
    }
    nonisolated private static func integer(_ value: Any?, minimum: Int, maximum: Int) throws -> Int {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue >= Double(minimum), number.doubleValue <= Double(maximum) else {
            throw LocalVaultCollaborationError(code: "400", message: "Invalid collaboration cursor.")
        }
        return number.intValue
    }
    /// Pure request builder is shared by relay and validation tests.
    nonisolated static func request(origin: URL, workspaceId: String, token: String, method: String, params: [String: Any]) throws -> URLRequest {
        _ = try LocalVaultSyncBinding(origin: origin, workspaceId: workspaceId)
        guard let itemId = params["itemId"] as? String, identifier(itemId), identifier(workspaceId) else {
            throw LocalVaultCollaborationError(code: "400", message: "Invalid collaboration item.")
        }
        let endpoint = origin.appendingPathComponent("api/vault").appendingPathComponent(workspaceId)
            .appendingPathComponent("items").appendingPathComponent(itemId).appendingPathComponent("collaboration")
        var request = URLRequest(url: endpoint, timeoutInterval: 35)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if method == "collaborationRead" {
            guard Set(params.keys).isSubset(of: ["itemId", "epoch", "seq", "waitMs"]) else { throw LocalVaultCollaborationError(code: "400", message: "Invalid collaboration read parameters.") }
            var query: [URLQueryItem] = []
            let wait = try params["waitMs"].map { try integer($0, minimum: 0, maximum: 25_000) } ?? 0
            if params["epoch"] != nil || params["seq"] != nil || wait > 0 {
                let epoch = try integer(params["epoch"], minimum: 1, maximum: 9_007_199_254_740_991)
                let seq = try integer(params["seq"], minimum: 0, maximum: 9_007_199_254_740_991)
                query = [URLQueryItem(name: "epoch", value: String(epoch)), URLQueryItem(name: "seq", value: String(seq))]
            }
            if wait > 0 { query.append(URLQueryItem(name: "waitMs", value: String(wait))) }
            var url = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
            url.queryItems = query.isEmpty ? nil : query
            request.url = url.url
        } else if method == "collaborationPush" {
            guard Set(params.keys).isSubset(of: ["itemId", "operationId", "epoch", "updates"]),
                  let operationId = params["operationId"] as? String, identifier(operationId),
                  let updates = params["updates"] as? [String], !updates.isEmpty, updates.count <= 64,
                  updates.allSatisfy({ $0.utf8.count <= 512 * 1024 }) else {
                throw LocalVaultCollaborationError(code: "400", message: "Invalid collaboration update.")
            }
            let epoch = try integer(params["epoch"], minimum: 1, maximum: 9_007_199_254_740_991)
            let data = try JSONSerialization.data(withJSONObject: ["operationId": operationId, "epoch": epoch, "updates": updates])
            guard data.count <= 6 * 1024 * 1024 else { throw LocalVaultCollaborationError(code: "413", message: "Collaboration update exceeds its size limit.") }
            request.httpMethod = "POST"; request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else { throw LocalVaultCollaborationError(code: "400", message: "Unknown collaboration operation.") }
        return request
    }
    /// Streaming runs on the generic executor, keeping large replies off AppKit's main actor.
    nonisolated private static func responseData(session: URLSession, request: URLRequest) async throws -> (Data, Int) {
        let (stream, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw LocalVaultCollaborationError(code: "503", message: "Invalid collaboration response.") }
        var data = Data()
        for try await byte in stream {
            guard data.count < 16 * 1024 * 1024 else { throw LocalVaultCollaborationError(code: "413", message: "Collaboration response exceeds its size limit.") }
            data.append(byte)
        }
        try Task.checkCancellation()
        return (data, response.statusCode)
    }
    func start(id: String, method: String, params: [String: Any], root: URL, completion: @escaping (Result<[String: Any]?, Error>) -> Void) {
        guard tasks[id] == nil, tasks.count < 8 else { completion(.failure(LocalVaultCollaborationError(code: "429", message: "Too many collaboration requests."))); return }
        let account = credentials()
        tasks[id] = Task { [weak self] in
            guard let self else { return }
            defer { self.tasks.removeValue(forKey: id) }
            do {
                let context = try await Task.detached(priority: .utility) { try Self.context(root: root, account: account) }.value
                try Task.checkCancellation()
                guard let context else {
                    if method == "collaborationConfig" { completion(.success(nil)); return }
                    throw LocalVaultCollaborationError(code: "401", message: "Connect this folder to TextText to collaborate.")
                }
                if method == "collaborationConfig" {
                    guard Set(params.keys) == ["path"], let path = params["path"] as? String else { throw LocalVaultCollaborationError(code: "400", message: "Choose a file to collaborate on.") }
                    let configuration = await Task.detached(priority: .utility) { () -> Configuration? in
                        guard let file = try? LocalVaultDocumentStore(root: root).readMetadata(path: path),
                              let itemId = MarkdownIdentityCodec.extract(from: file.contents.markdown)?.itemId, Self.identifier(itemId),
                              (try? LocalVaultSync.collaborationReady(root: root, path: path, itemId: itemId, localHash: file.hash)) == true else { return nil }
                        return Configuration(namespace: context.binding.origin.absoluteString,
                            workspaceId: context.binding.workspaceId, itemId: itemId)
                    }.value
                    try Task.checkCancellation()
                    completion(.success(configuration?.value)); return
                }
                let request = try Self.request(origin: context.binding.origin, workspaceId: context.binding.workspaceId, token: context.token, method: method, params: params)
                let (data, status) = try await Self.responseData(session: self.session, request: request)
                try Task.checkCancellation()
                let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                guard status == 200, let value else {
                    let message = (value?["error"] as? String).map { String($0.prefix(1000)) } ?? "Collaboration request could not complete."
                    throw LocalVaultCollaborationError(code: String(status), message: message)
                }
                completion(.success(value))
            } catch { completion(.failure(error)) }
        }
    }
}
private final class CollaborationNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
