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
        var value: [String: Any] { ["namespace": namespace, "workspaceId": workspaceId, "itemId": itemId, "localFiles": true] }
    }
    private let credentials: () -> (origin: URL, token: String)?
    private let session: URLSession
    private let engine: () -> LocalVaultSync?
    private let didRelease: () -> Void
    private var localSessions: [String: (itemId: String, engine: LocalVaultSync)] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]
    init(credentials: @escaping () -> (origin: URL, token: String)?, session: URLSession? = nil, engine: @escaping () -> LocalVaultSync? = { nil }, didRelease: @escaping () -> Void = {}) {
        self.credentials = credentials
        self.engine = engine
        self.didRelease = didRelease
        self.session = session ?? URLSession(configuration: .ephemeral, delegate: CollaborationNoRedirect(), delegateQueue: nil)
    }
    deinit { for task in tasks.values { task.cancel() }; session.invalidateAndCancel() }
    func cancel(_ requestId: String) { tasks[requestId]?.cancel() }
    func cancelAll() {
        for task in tasks.values { task.cancel() }; tasks.removeAll()
        let closing = localSessions; localSessions.removeAll()
        let released = didRelease
        for (token, active) in closing {
            Task { try? await active.engine.endSharedEditing(sessionToken: token, itemId: active.itemId); released() }
        }
    }

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
            .appendingPathComponent("items").appendingPathComponent(itemId)
            .appendingPathComponent(method.hasPrefix("presence") ? "presence" : "collaboration")
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
        } else if method == "presenceRead" {
            guard Set(params.keys) == ["itemId"] else { throw LocalVaultCollaborationError(code: "400", message: "Invalid presence read parameters.") }
        } else if ["presenceJoin", "presenceUpdate", "presenceLeave"].contains(method) {
            var body: [String: Any]
            if method == "presenceJoin" {
                guard Set(params.keys) == ["itemId", "awarenessClientId"] else {
                    throw LocalVaultCollaborationError(code: "400", message: "Invalid presence join parameters.")
                }
                let awarenessClientId = try integer(params["awarenessClientId"], minimum: 0, maximum: 4_294_967_295)
                body = ["join": true, "awarenessClientId": awarenessClientId]
            } else {
                let expected: Set<String> = method == "presenceUpdate"
                    ? ["itemId", "clientId", "sessionCredential", "awareness"]
                    : ["itemId", "clientId", "sessionCredential"]
                guard Set(params.keys) == expected,
                      let clientId = params["clientId"] as? String,
                      clientId.range(of: "^p-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil,
                      let credential = params["sessionCredential"] as? String,
                      credential.hasPrefix("v1:"), credential.utf8.count <= 4096 else {
                    throw LocalVaultCollaborationError(code: "400", message: "Invalid presence session.")
                }
                body = ["clientId": clientId, "sessionCredential": credential]
                if method == "presenceUpdate" {
                    guard let awareness = params["awareness"] as? String, awareness.utf8.count <= 20 * 1024 else {
                        throw LocalVaultCollaborationError(code: "400", message: "Invalid presence awareness.")
                    }
                    body["awareness"] = awareness
                } else { body["leave"] = true }
            }
            let data = try JSONSerialization.data(withJSONObject: body)
            guard data.count <= 96 * 1024 else { throw LocalVaultCollaborationError(code: "413", message: "Presence request exceeds its size limit.") }
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
    private func localOperation(_ method: String, params: [String: Any]) async throws -> [String: Any] {
        guard let itemId = params["itemId"] as? String, Self.identifier(itemId) else {
            throw LocalVaultCollaborationError(code: "400", message: "Invalid collaboration item.")
        }
        if method == "collaborationOpen" {
            guard Set(params.keys) == ["itemId", "path", "hash"],
                  let path = params["path"] as? String, let hash = params["hash"] as? String,
                  let engine = engine() else { throw LocalVaultCollaborationError(code: "409", message: "This folder is not ready for shared editing.") }
            let opened = try await engine.beginSharedEditing(itemId: itemId, path: path, expectedHash: hash)
            if Task.isCancelled {
                try? await engine.endSharedEditing(sessionToken: opened.sessionToken, itemId: itemId)
                throw CancellationError()
            }
            localSessions[opened.sessionToken] = (itemId, engine)
            return ["sessionToken": opened.sessionToken, "path": opened.document.path, "hash": opened.document.hash,
                    "acknowledgedRevision": opened.acknowledgedRevision,
                    "journal": opened.checkpoint?.journal as Any? ?? NSNull(),
                    "retiredReason": opened.checkpoint?.retiredReason as Any? ?? NSNull()]
        }
        if method == "collaborationClose" {
            guard Set(params.keys).isSubset(of: ["itemId", "sessionToken", "retiredReason"]),
                  let token = params["sessionToken"] as? String, !token.isEmpty,
                  params["retiredReason"] == nil || params["retiredReason"] is String else {
                throw LocalVaultCollaborationError(code: "400", message: "Invalid collaboration close request.")
            }
            // Navigation or an account change may have already closed it.
            // Repeating close must not strand a clean editor in recovery.
            guard let active = localSessions[token] else { return [:] }
            guard active.itemId == itemId else { throw LocalVaultCollaborationError(code: "409", message: "This session belongs to another item.") }
            let reason = (params["retiredReason"] as? String).map { String($0.prefix(1000)) }
            try await active.engine.endSharedEditing(sessionToken: token, itemId: itemId, retiredReason: reason)
            localSessions.removeValue(forKey: token)
            didRelease()
            return [:]
        }
        guard let token = params["sessionToken"] as? String, let active = localSessions[token], active.itemId == itemId else {
            throw LocalVaultCollaborationError(code: "409", message: "This shared editing session has closed. Your recovery journal is kept.")
        }
        if method == "collaborationRecover" {
            guard Set(params.keys) == ["itemId", "sessionToken", "recoveryPath", "recoveryHash"],
                  let path = params["recoveryPath"] as? String, let hash = params["recoveryHash"] as? String else {
                throw LocalVaultCollaborationError(code: "400", message: "Choose the saved recovery copy.")
            }
            try await active.engine.finishSharedRecovery(sessionToken: token, itemId: itemId, recoveryPath: path, recoveryHash: hash)
            localSessions.removeValue(forKey: token)
            didRelease()
            return [:]
        }
        guard method == "collaborationCheckpoint",
              Set(params.keys) == ["itemId", "sessionToken", "hash", "epoch", "seq", "revision", "journalGeneration", "journal", "pending", "markdown", "documentJSON"],
              let hash = params["hash"] as? String, let revision = params["revision"] as? String,
              let journal = params["journal"] as? String, journal.utf8.count <= 4 * 1024 * 1024,
              let pendingNumber = params["pending"] as? NSNumber, CFGetTypeID(pendingNumber) == CFBooleanGetTypeID(),
              let markdown = params["markdown"] as? String, markdown.utf8.count <= 8 * 1024 * 1024,
              let documentJSON = params["documentJSON"] as? String, documentJSON.utf8.count <= 8 * 1024 * 1024 else {
            throw LocalVaultCollaborationError(code: "400", message: "Invalid local collaboration checkpoint.")
        }
        let epoch = try Self.integer(params["epoch"], minimum: 1, maximum: 9_007_199_254_740_991)
        let seq = try Self.integer(params["seq"], minimum: 0, maximum: 9_007_199_254_740_991)
        let generation = try Self.integer(params["journalGeneration"], minimum: 1, maximum: 9_007_199_254_740_991)
        let saved = try await active.engine.materializeSharedEditing(sessionToken: token, itemId: itemId,
            expectedHash: hash, epoch: epoch, seq: seq, acknowledgedRevision: revision,
            journalGeneration: UInt64(generation), journal: journal, pending: pendingNumber.boolValue,
            markdown: markdown, documentJSON: documentJSON)
        return ["path": saved.document.path, "hash": saved.document.hash]
    }
    func start(id: String, method: String, params: [String: Any], root: URL, completion: @escaping (Result<[String: Any]?, Error>) -> Void) {
        guard tasks[id] == nil, tasks.count < 8 else { completion(.failure(LocalVaultCollaborationError(code: "429", message: "Too many collaboration requests."))); return }
        let account = credentials()
        tasks[id] = Task { [weak self] in
            guard let self else { return }
            defer { self.tasks.removeValue(forKey: id) }
            do {
                if ["collaborationOpen", "collaborationCheckpoint", "collaborationClose", "collaborationRecover"].contains(method) {
                    completion(.success(try await self.localOperation(method, params: params))); return
                }
                let context = try await Task.detached(priority: .utility) { try Self.context(root: root, account: account) }.value
                try Task.checkCancellation()
                guard let context else {
                    if method == "collaborationConfig" { completion(.success(nil)); return }
                    throw LocalVaultCollaborationError(code: "401", message: "Connect this folder to TextText to collaborate.")
                }
                if method == "collaborationConfig" {
                    guard Set(params.keys) == ["path"], let path = params["path"] as? String else { throw LocalVaultCollaborationError(code: "400", message: "Choose a file to collaborate on.") }
                    let candidate = await Task.detached(priority: .utility) { () -> (String, Bool)? in
                        guard let file = try? LocalVaultDocumentStore(root: root).readMetadata(path: path),
                              let itemId = MarkdownIdentityCodec.extract(from: file.contents.markdown)?.itemId, Self.identifier(itemId) else { return nil }
                        return (itemId, (try? LocalVaultSync.collaborationReady(root: root, path: path, itemId: itemId, localHash: file.hash)) == true)
                    }.value
                    var configuration: Configuration?
                    if let candidate, let engine = self.engine() {
                        let retained = try await engine.readSharedCheckpoint(itemId: candidate.0)
                        if candidate.1 || retained != nil {
                            configuration = Configuration(namespace: context.binding.origin.absoluteString, workspaceId: context.binding.workspaceId, itemId: candidate.0)
                        }
                    }
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
