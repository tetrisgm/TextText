import Foundation
import WriteFileProviderKit

// MARK: Wire types (exactly what the write platform's routes emit)

struct WorkspaceBlog: Codable {
    let handle: String
    let name: String
    let username: String?
}

struct WorkspaceFolder: Codable {
    let id: String
    let name: String
    let path: String
    let mode: String
    let parentId: String?
}

/// GET /api/sync/v1/workspace
struct Workspace: Codable {
    let blog: WorkspaceBlog
    let folders: [WorkspaceFolder]
}

/// One manifest entry, also the {item} body PUT/POST return.
struct ManifestItem: Codable {
    let file: String
    let kind: String
    let slug: String
    let title: String
    let status: String
    let hash: String
    let id: String?
    let date: String?
    let createdAt: String?
    let updatedAt: String?
    let url: String?
}

private struct ManifestEnvelope: Codable {
    let items: [ManifestItem]
}

private struct ItemEnvelope: Codable {
    let item: ManifestItem
}

private struct FolderEnvelope: Codable {
    let folder: WorkspaceFolder
}

/// POST /api/link/start
struct LinkStartResponse: Codable {
    let code: String
    let pollToken: String
    let verifyUrl: String
    let expiresAt: String
    let interval: Double?
}

/// POST /api/link/poll
struct LinkPollResponse: Codable {
    let status: String // pending | expired | approved
    let token: String?
    let tokenName: String?
}

// MARK: Client

enum ClientFailure: Error, CustomStringConvertible {
    case network(String)
    case http(Int, String)
    case badResponse(String)

    var description: String {
        switch self {
        case .network(let m): return "network: \(m)"
        case .http(let s, let m): return "HTTP \(s): \(m)"
        case .badResponse(let m): return "bad response: \(m)"
        }
    }
}

enum ManifestReply {
    case notModified
    case manifest([ManifestItem], etag: String?)
}

enum SaveReply {
    case saved(ManifestItem)
    /// 412: the post changed underneath the client (PUT only).
    case conflict
    /// 400: the file itself is the problem; retrying unchanged bytes is futile.
    case rejected(String)
}

protocol SyncClient {
    func workspace() -> Result<(Workspace, Data), ClientFailure>
    func manifest(folderId: String, etag: String?) -> Result<ManifestReply, ClientFailure>
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) -> Result<WorkspaceFolder, ClientFailure>
    func fileText(postId: String) -> Result<(text: String, hash: String?), ClientFailure>
    func putFile(postId: String, body: String, ifMatch hash: String) -> Result<SaveReply, ClientFailure>
    func patchFile(postId: String, folderId: String?, slug: String?, ifMatch hash: String?) -> Result<SaveReply, ClientFailure>
    func postFile(body: String, folderId: String?, idempotencyKey: String?) -> Result<SaveReply, ClientFailure>
    func postFile(
        body: String, folderId: String?, representation: WriteFileRepresentation,
        idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure>
    func deleteFile(postId: String, ifMatch hash: String?) -> Result<Void, ClientFailure>
    func advertisedAppVersion() -> String?
}

extension SyncClient {
    func postFile(
        body: String, folderId: String?, representation: WriteFileRepresentation,
        idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        postFile(body: body, folderId: folderId, idempotencyKey: idempotencyKey)
    }
}

/// Synchronous URLSession client for the write platform. Called only from
/// background queues (the sync queue, the link poll queue), never main.
final class ServerClient: SyncClient {
    let origin: URL
    private let token: String?
    private let session: URLSession

    init(origin: URL, token: String?) {
        // Normalize away a trailing slash so path concatenation stays simple.
        var raw = origin.absoluteString
        while raw.hasSuffix("/") { raw.removeLast() }
        self.origin = URL(string: raw) ?? origin
        self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.httpAdditionalHeaders = ["User-Agent": "Write-Mac/\(appVersion)"]
        self.session = URLSession(configuration: config)
    }

    // MARK: Device link

    func startLink(name: String) -> Result<LinkStartResponse, ClientFailure> {
        requestJSON("POST", "/api/link/start", json: ["name": name])
    }

    func pollLink(pollToken: String) -> Result<LinkPollResponse, ClientFailure> {
        requestJSON("POST", "/api/link/poll", json: ["pollToken": pollToken])
    }

    // MARK: Sync v1

    func workspace() -> Result<(Workspace, Data), ClientFailure> {
        switch send("GET", "/api/sync/v1/workspace") {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            guard reply.status == 200 else { return .failure(httpFailure(reply)) }
            guard let ws = try? JSONDecoder().decode(Workspace.self, from: reply.data) else {
                return .failure(.badResponse("workspace JSON did not decode"))
            }
            return .success((ws, reply.data))
        }
    }

    func manifest(folderId: String, etag: String?) -> Result<ManifestReply, ClientFailure> {
        var headers: [String: String] = [:]
        if let etag { headers["If-None-Match"] = etag }
        switch send("GET", "/api/sync/v1/folders/\(folderId)/manifest", headers: headers) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 304 { return .success(.notModified) }
            guard reply.status == 200 else { return .failure(httpFailure(reply)) }
            guard let envelope = try? JSONDecoder().decode(ManifestEnvelope.self, from: reply.data) else {
                return .failure(.badResponse("manifest JSON did not decode"))
            }
            return .success(.manifest(envelope.items, etag: reply.etag))
        }
    }

    func createFolder(parentPath: String, name: String, idempotencyKey: String?) -> Result<WorkspaceFolder, ClientFailure> {
        let json: [String: Any] = ["parent_path": parentPath, "name": name]
        guard let body = try? JSONSerialization.data(withJSONObject: json) else {
            return .failure(.badResponse("could not encode request body"))
        }
        // A stable Idempotency-Key makes a lost-response retry return the
        // ORIGINAL 201 instead of creating a duplicate folder.
        var headers = ["Content-Type": "application/json"]
        if let idempotencyKey { headers["Idempotency-Key"] = idempotencyKey }
        switch send("POST", "/api/sync/v1/folders", headers: headers, body: body) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            guard reply.status == 201 else { return .failure(httpFailure(reply)) }
            guard let envelope = try? JSONDecoder().decode(FolderEnvelope.self, from: reply.data) else {
                return .failure(.badResponse("create folder reply did not decode"))
            }
            return .success(envelope.folder)
        }
    }

    /// The markdown file exactly as the server renders it, plus its hash
    /// (from the ETag when present).
    func fileText(postId: String) -> Result<(text: String, hash: String?), ClientFailure> {
        switch send("GET", "/api/sync/v1/files/\(postId)") {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            guard reply.status == 200 else { return .failure(httpFailure(reply)) }
            guard let text = String(data: reply.data, encoding: .utf8) else {
                return .failure(.badResponse("file body is not UTF-8"))
            }
            return .success((text, reply.bareETag))
        }
    }

    /// PUT with If-Match: the client proves its edit is based on the server's
    /// current file. 412 means it was not; 428 never happens (we always send
    /// the header); 400 means the file needs fixing.
    func putFile(postId: String, body: String, ifMatch hash: String) -> Result<SaveReply, ClientFailure> {
        let headers = [
            "If-Match": "\"\(hash)\"",
            "Content-Type": "text/markdown; charset=utf-8",
        ]
        switch send("PUT", "/api/sync/v1/files/\(postId)", headers: headers,
                    body: Data(body.utf8)) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 412 { return .success(.conflict) }
            if reply.status == 400 { return .success(.rejected(reply.errorMessage)) }
            guard reply.status == 200 else { return .failure(httpFailure(reply)) }
            guard let envelope = try? JSONDecoder().decode(ItemEnvelope.self, from: reply.data) else {
                return .failure(.badResponse("PUT reply did not decode"))
            }
            return .success(.saved(envelope.item))
        }
    }

    func postFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        postFile(
            body: body, folderId: folderId, representation: .markdown,
            idempotencyKey: idempotencyKey)
    }

    func postFile(
        body: String, folderId: String?, representation: WriteFileRepresentation,
        idempotencyKey: String?
    ) -> Result<SaveReply, ClientFailure> {
        var headers = [
            "Content-Type": "text/markdown; charset=utf-8",
            "Write-File-Representation": representation.rawValue,
        ]
        // A stable Idempotency-Key makes a lost-response retry return the
        // ORIGINAL 201 instead of publishing the post twice.
        if let idempotencyKey { headers["Idempotency-Key"] = idempotencyKey }
        // The target folder makes the server's mode authoritative: a file in the
        // Notes/Bookmarks mirror is created as a note/bookmark and stays unlisted,
        // and a file in a subfolder lands there instead of the system root. Without
        // ?folder=, the server trusts the frontmatter type and could publish a
        // note filed under Notes (the privacy invariant leak this closes).
        var path = "/api/sync/v1/files"
        if let folderId, !folderId.isEmpty {
            let escaped = folderId.addingPercentEncoding(
                withAllowedCharacters: .urlPathAllowed) ?? folderId
            path += "?folder=\(escaped)"
        }
        switch send("POST", path, headers: headers, body: Data(body.utf8)) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 400 { return .success(.rejected(reply.errorMessage)) }
            guard reply.status == 201 else { return .failure(httpFailure(reply)) }
            guard let envelope = try? JSONDecoder().decode(ItemEnvelope.self, from: reply.data) else {
                return .failure(.badResponse("POST reply did not decode"))
            }
            return .success(.saved(envelope.item))
        }
    }

    /// PATCH the folder and/or slug without re-sending the body. Used when a
    /// local move (folder change, hash unchanged) is detected: the server's
    /// folder is updated so the next pull does not snap the file back. When
    /// present, the base hash rides as X-Write-If-Match so a stale move (the
    /// row moved on underneath us) is rejected with 412 (mapped to a conflict).
    /// The scoped header avoids Vercel consuming standard If-Match before the
    /// PATCH route can compare the sync file's content hash.
    func patchFile(postId: String, folderId: String?, slug: String?, ifMatch hash: String?) -> Result<SaveReply, ClientFailure> {
        var json: [String: Any] = [:]
        if let folderId, !folderId.isEmpty { json["folder"] = folderId }
        if let slug, !slug.isEmpty { json["slug"] = slug }
        guard let body = try? JSONSerialization.data(withJSONObject: json) else {
            return .failure(.badResponse("could not encode request body"))
        }
        var headers = ["Content-Type": "application/json"]
        if let hash { headers["X-Write-If-Match"] = "\"\(hash)\"" }
        switch send("PATCH", "/api/sync/v1/files/\(postId)", headers: headers, body: body) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 412 { return .success(.conflict) }
            if reply.status == 400 { return .success(.rejected(reply.errorMessage)) }
            guard reply.status == 200 else { return .failure(httpFailure(reply)) }
            guard let envelope = try? JSONDecoder().decode(ItemEnvelope.self, from: reply.data) else {
                return .failure(.badResponse("PATCH reply did not decode"))
            }
            return .success(.saved(envelope.item))
        }
    }

    /// DELETE; a 404 counts as done (already gone). Sending If-Match with the
    /// indexed hash gives stale-delete protection: the server returns 412 when
    /// the row moved on underneath us, so a delete based on an out-of-date view
    /// does not silently succeed.
    func deleteFile(postId: String, ifMatch hash: String?) -> Result<Void, ClientFailure> {
        var headers: [String: String] = [:]
        if let hash { headers["If-Match"] = "\"\(hash)\"" }
        switch send("DELETE", "/api/sync/v1/files/\(postId)", headers: headers) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 204 || reply.status == 404 { return .success(()) }
            return .failure(httpFailure(reply))
        }
    }

    /// GET /api/app/version -> {version}. The route is being built in
    /// parallel; a 404 (or anything else odd) is quietly nil.
    func advertisedAppVersion() -> String? {
        guard case .success(let reply) = send("GET", "/api/app/version"),
              reply.status == 200,
              let object = try? JSONSerialization.jsonObject(with: reply.data) as? [String: Any],
              let version = object["version"] as? String else {
            return nil
        }
        return version
    }

    // MARK: Plumbing

    private struct Reply {
        let status: Int
        let data: Data
        let response: HTTPURLResponse

        var etag: String? { response.value(forHTTPHeaderField: "ETag") }
        /// ETag reduced to the server's bare content hash: the surrounding quotes
        /// and any weak `W/` prefix (Vercel adds it on a gzipped response)
        /// removed, so we never store or echo back a "W/hash".
        var bareETag: String? {
            guard var tag = etag else { return nil }
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
    }

    private func httpFailure(_ reply: Reply) -> ClientFailure {
        .http(reply.status, reply.errorMessage)
    }

    private func requestJSON<T: Decodable>(
        _ method: String, _ path: String, json: [String: Any]
    ) -> Result<T, ClientFailure> {
        guard let body = try? JSONSerialization.data(withJSONObject: json) else {
            return .failure(.badResponse("could not encode request body"))
        }
        switch send(method, path, headers: ["Content-Type": "application/json"], body: body) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            guard (200..<300).contains(reply.status) else { return .failure(httpFailure(reply)) }
            guard let decoded = try? JSONDecoder().decode(T.self, from: reply.data) else {
                return .failure(.badResponse("\(path) reply did not decode"))
            }
            return .success(decoded)
        }
    }

    private func send(
        _ method: String, _ path: String,
        headers: [String: String] = [:], body: Data? = nil
    ) -> Result<Reply, ClientFailure> {
        guard let url = URL(string: origin.absoluteString + path) else {
            return .failure(.badResponse("bad URL for \(path)"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        var result: Result<Reply, ClientFailure> = .failure(.network("no response"))
        let semaphore = DispatchSemaphore(value: 0)
        session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error {
                result = .failure(.network(error.localizedDescription))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                result = .failure(.badResponse("not an HTTP response"))
                return
            }
            result = .success(Reply(status: http.statusCode, data: data ?? Data(), response: http))
        }.resume()
        semaphore.wait()
        return result
    }
}
