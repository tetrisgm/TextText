import Foundation

/// The production `WriteSyncAPI`: async URLSession calls against the platform's
/// /api/sync/v1 routes, authenticated with the workspace `wsk_` token. The File
/// Provider extension constructs one of these once it has the token from the
/// shared app group container.
public final class LiveWriteSyncAPI: WriteSyncAPI, @unchecked Sendable {
    private let origin: URL
    private let token: String
    private let session: URLSession

    public init(origin: URL, token: String, session: URLSession? = nil) {
        var raw = origin.absoluteString
        while raw.hasSuffix("/") { raw.removeLast() }
        self.origin = URL(string: raw) ?? origin
        self.token = token
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 40
            config.timeoutIntervalForResource = 120
            config.httpAdditionalHeaders = ["User-Agent": "Write-FileProvider"]
            self.session = URLSession(configuration: config)
        }
    }

    // MARK: Reads

    public func workspace() async -> Result<WriteWorkspace, WriteSyncError> {
        await get("/api/sync/v1/workspace", as: WriteWorkspace.self)
    }

    public func manifest(
        folderId: String
    ) async -> Result<[WriteManifestItem], WriteSyncError> {
        let path = "/api/sync/v1/folders/\(escape(folderId))/manifest"
        return await get(path, as: ManifestEnvelope.self).map { $0.items }
    }

    public func fileText(
        postId: String
    ) async -> Result<WriteFileContent, WriteSyncError> {
        let path = "/api/sync/v1/files/\(escape(postId))"
        switch await send("GET", path) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            guard let text = String(data: reply.data, encoding: .utf8) else {
                return .failure(.decode("file body is not UTF-8"))
            }
            return .success(WriteFileContent(text: text, hash: reply.bareETag))
        }
    }

    public func changes(
        since cursor: String?, wait: Int
    ) async -> Result<WriteChangeReply, WriteSyncError> {
        var path = "/api/sync/v1/changes"
        var query: [String] = []
        if let cursor { query.append("cursor=\(escape(cursor))") }
        if wait > 0 { query.append("wait=\(wait)") }
        if !query.isEmpty { path += "?" + query.joined(separator: "&") }
        // The request must outlive the server's long-poll window.
        let timeout = wait > 0 ? TimeInterval(wait) + 20 : 30
        return await get(path, as: WriteChangeReply.self, timeout: timeout)
    }

    // MARK: Writes (Phase 3 wires these into the extension)

    public func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        var path = "/api/sync/v1/files"
        if let folderId, !folderId.isEmpty { path += "?folder=\(escape(folderId))" }
        var headers = ["Content-Type": "text/markdown; charset=utf-8"]
        if let idempotencyKey { headers["Idempotency-Key"] = idempotencyKey }
        switch await send("POST", path, headers: headers, body: Data(body.utf8)) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 400 { return .failure(.rejected(reply.errorMessage)) }
            guard reply.status == 201 else { return .failure(reply.httpError) }
            return decode(ItemEnvelope.self, reply.data).map { $0.item }
        }
    }

    public func patchFile(
        postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        var json: [String: Any] = [:]
        if let folderId, !folderId.isEmpty { json["folder"] = folderId }
        if let slug, !slug.isEmpty { json["slug"] = slug }
        if let title, !title.isEmpty { json["title"] = title }
        guard let body = try? JSONSerialization.data(withJSONObject: json) else {
            return .failure(.decode("could not encode request body"))
        }
        var headers = ["Content-Type": "application/json"]
        // Vercel consumes standard If-Match on PATCH before the route runs.
        // Use Write's scoped equivalent so the server can perform its own
        // exact file-hash and database-revision compare-and-swap.
        if let hash { headers["X-Write-If-Match"] = "\"\(hash)\"" }
        switch await send(
            "PATCH", "/api/sync/v1/files/\(escape(postId))",
            headers: headers, body: body
        ) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 412 { return .failure(.conflict) }
            if reply.status == 404 { return .failure(.notFound) }
            if reply.status == 400 { return .failure(.rejected(reply.errorMessage)) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            return decode(ItemEnvelope.self, reply.data).map { $0.item }
        }
    }

    public func putFile(
        postId: String, body: String, ifMatch hash: String
    ) async -> Result<WriteManifestItem, WriteSyncError> {
        let headers = [
            "If-Match": "\"\(hash)\"",
            "Content-Type": "text/markdown; charset=utf-8",
        ]
        switch await send(
            "PUT", "/api/sync/v1/files/\(escape(postId))",
            headers: headers, body: Data(body.utf8)
        ) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 412 { return .failure(.conflict) }
            if reply.status == 404 { return .failure(.notFound) }
            if reply.status == 400 { return .failure(.rejected(reply.errorMessage)) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            return decode(ItemEnvelope.self, reply.data).map { $0.item }
        }
    }

    public func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, WriteSyncError> {
        var headers: [String: String] = [:]
        if let hash { headers["If-Match"] = "\"\(hash)\"" }
        switch await send("DELETE", "/api/sync/v1/files/\(escape(postId))", headers: headers) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            // 412: the row moved on underneath us. Surface it as a conflict so
            // mutation callers can return current state (modify) or a rejected
            // deletion; versionNoLongerAvailable is reserved for strict fetches.
            if reply.status == 412 { return .failure(.conflict) }
            if reply.status == 204 || reply.status == 404 { return .success(()) }
            return .failure(reply.httpError)
        }
    }

    public func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        let json: [String: Any] = ["parent_path": parentPath, "name": name]
        guard let body = try? JSONSerialization.data(withJSONObject: json) else {
            return .failure(.decode("could not encode request body"))
        }
        var headers = ["Content-Type": "application/json"]
        if let idempotencyKey { headers["Idempotency-Key"] = idempotencyKey }
        switch await send("POST", "/api/sync/v1/folders", headers: headers, body: body) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            guard reply.status == 201 else { return .failure(reply.httpError) }
            return decode(FolderEnvelope.self, reply.data).map { $0.folder }
        }
    }

    public func renameFolder(
        folderId: String, name: String
    ) async -> Result<WriteWorkspaceFolder, WriteSyncError> {
        guard let body = try? JSONSerialization.data(withJSONObject: ["name": name]) else {
            return .failure(.decode("could not encode request body"))
        }
        switch await send(
            "PATCH", "/api/sync/v1/folders/\(escape(folderId))",
            headers: ["Content-Type": "application/json"], body: body
        ) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            return decode(FolderEnvelope.self, reply.data).map { $0.folder }
        }
    }

    public func renameWorkspace(
        name: String
    ) async -> Result<WriteWorkspaceBlog, WriteSyncError> {
        guard let body = try? JSONSerialization.data(withJSONObject: ["name": name]) else {
            return .failure(.decode("could not encode request body"))
        }
        switch await send(
            "PATCH", "/api/sync/v1/workspace",
            headers: ["Content-Type": "application/json"], body: body
        ) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            return decode(BlogEnvelope.self, reply.data).map { $0.blog }
        }
    }

    // MARK: Envelopes

    private struct ManifestEnvelope: Codable { let items: [WriteManifestItem] }
    private struct ItemEnvelope: Codable { let item: WriteManifestItem }
    private struct FolderEnvelope: Codable { let folder: WriteWorkspaceFolder }
    private struct BlogEnvelope: Codable { let blog: WriteWorkspaceBlog }

    // MARK: Plumbing

    private struct Reply {
        let status: Int
        let data: Data
        let response: HTTPURLResponse

        var bareETag: String? {
            // Reduce to the bare content hash: drop a weak `W/` prefix (Vercel
            // adds it when it gzips the response) before AND after the quotes,
            // so we never store or echo back a "W/hash" the server has to undo.
            guard var tag = response.value(forHTTPHeaderField: "ETag") else { return nil }
            if tag.hasPrefix("W/") { tag.removeFirst(2) }
            tag = tag.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            if tag.hasPrefix("W/") { tag.removeFirst(2) }
            return tag
        }
        var errorMessage: String {
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = object["error"] as? String {
                return message
            }
            return "status \(status)"
        }
        var httpError: WriteSyncError { .http(status, errorMessage) }
    }

    private func escape(_ component: String) -> String {
        component.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? component
    }

    private func decode<T: Decodable>(
        _ type: T.Type, _ data: Data
    ) -> Result<T, WriteSyncError> {
        guard let value = try? JSONDecoder().decode(T.self, from: data) else {
            return .failure(.decode("\(T.self) did not decode"))
        }
        return .success(value)
    }

    private func get<T: Decodable>(
        _ path: String, as type: T.Type, timeout: TimeInterval? = nil
    ) async -> Result<T, WriteSyncError> {
        switch await send("GET", path, timeout: timeout) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            return decode(T.self, reply.data)
        }
    }

    private func send(
        _ method: String, _ path: String,
        headers: [String: String] = [:], body: Data? = nil,
        timeout: TimeInterval? = nil
    ) async -> Result<Reply, WriteSyncError> {
        guard let url = URL(string: origin.absoluteString + path) else {
            return .failure(.decode("bad URL for \(path)"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if let timeout { request.timeoutInterval = timeout }
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.network("not an HTTP response"))
            }
            return .success(Reply(status: http.statusCode, data: data, response: http))
        } catch {
            return .failure(.network(error.localizedDescription))
        }
    }
}
