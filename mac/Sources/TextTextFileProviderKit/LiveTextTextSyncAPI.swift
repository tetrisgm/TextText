import Foundation

public struct TextTextAgentCommandItem: Decodable, Sendable {
    public let id: String?
    public let title: String
    public let hash: String

    public init(id: String?, title: String, hash: String) {
        self.id = id
        self.title = title
        self.hash = hash
    }
}

/// The mutation receipt emitted by the shared workspace command. This is the
/// authoritative destination chosen by the server, including any default or
/// nested folder resolution the caller did not perform locally.
public struct TextTextAgentCaptureReceipt: Decodable, Sendable {
    public let itemId: String
    public let kind: String
    public let savedTo: String
    public let title: String

    private enum CodingKeys: String, CodingKey {
        case itemId = "item_id"
        case kind
        case savedTo = "saved_to"
        case title
    }

    public init(itemId: String, kind: String, savedTo: String, title: String) {
        self.itemId = itemId
        self.kind = kind
        self.savedTo = savedTo
        self.title = title
    }
}

/// One result from the shared workspace `search` command. The local CLI
/// decodes this exact server shape instead of rebuilding a second search index
/// from folder manifests.
public struct TextTextAgentSearchResult: Decodable, Sendable {
    public let id: String
    public let slug: String
    public let title: String
    public let kind: String
    public let status: String
    public let hash: String
    public let snippet: String
    public let folderPath: String?

    private enum CodingKeys: String, CodingKey {
        case id, slug, title, kind, status, hash, snippet
        case folderPath = "folder_path"
    }

    public init(
        id: String, slug: String, title: String, kind: String,
        status: String, hash: String, snippet: String,
        folderPath: String? = nil
    ) {
        self.id = id
        self.slug = slug
        self.title = title
        self.kind = kind
        self.status = status
        self.hash = hash
        self.snippet = snippet
        self.folderPath = folderPath
    }
}

public struct TextTextAgentCommandReply: Decodable, Sendable {
    public struct StructuredContent: Decodable, Sendable {
        public let item: TextTextAgentCommandItem?
        public let markdown: String?
        public let replayed: Bool?
        public let query: String?
        public let results: [TextTextAgentSearchResult]?
        public let receipt: TextTextAgentCaptureReceipt?
    }

    private struct Content: Decodable, Sendable {
        let type: String
        let text: String?
    }

    public let structuredContent: StructuredContent?
    public let isError: Bool?
    private let content: [Content]

    public init(
        item: TextTextAgentCommandItem? = nil,
        markdown: String? = nil,
        replayed: Bool? = nil,
        query: String? = nil,
        results: [TextTextAgentSearchResult]? = nil,
        receipt: TextTextAgentCaptureReceipt? = nil,
        isError: Bool? = nil,
        message: String? = nil
    ) {
        self.structuredContent = StructuredContent(
            item: item, markdown: markdown, replayed: replayed,
            query: query, results: results, receipt: receipt)
        self.isError = isError
        self.content = message.map { [Content(type: "text", text: $0)] } ?? []
    }

    public var message: String? {
        content.first(where: { $0.type == "text" })?.text
    }
}

/// The production `TextTextSyncAPI`: async URLSession calls against the platform's
/// /api/sync/v1 routes, authenticated with the workspace `wsk_` token. The File
/// Provider extension constructs one of these once it has the token from the
/// shared app group container.
public final class LiveTextTextSyncAPI: TextTextSyncAPI, @unchecked Sendable {
    private static let syncDocumentContentType =
        "application/vnd.texttext.document+json"
    private static let sharedSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 40
        config.timeoutIntervalForResource = 120
        config.httpAdditionalHeaders = ["User-Agent": "TextText-FileProvider"]
        return URLSession(configuration: config)
    }()
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
            self.session = Self.sharedSession
        }
    }

    // MARK: Reads

    public func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> {
        await get("/api/sync/v1/workspace", as: TextTextWorkspace.self)
    }

    public func manifest(
        folderId: String
    ) async -> Result<[TextTextManifestItem], TextTextSyncError> {
        let path = "/api/sync/v1/folders/\(escape(folderId))/manifest"
        return await get(path, as: ManifestEnvelope.self).map { $0.items }
    }

    public func fileText(
        postId: String
    ) async -> Result<TextTextFileContent, TextTextSyncError> {
        let path = "/api/sync/v1/files/\(escape(postId))"
        switch await send("GET", path) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            guard let text = String(data: reply.data, encoding: .utf8) else {
                return .failure(.decode("file body is not UTF-8"))
            }
            return .success(TextTextFileContent(text: text, hash: reply.bareETag))
        }
    }

    public func fileContent(
        postId: String, representation: TextTextFileRepresentation
    ) async -> Result<TextTextFileContent, TextTextSyncError> {
        guard representation.isTextBundleFamily else {
            return await fileText(postId: postId)
        }
        let path = "/api/sync/v1/files/\(escape(postId))"
        switch await send(
            "GET", path,
            headers: ["Accept": Self.syncDocumentContentType]
        ) {
        case .failure(let error): return .failure(error)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            guard reply.status == 200 else { return .failure(reply.httpError) }
            do {
                let decoded = try Self.decodeSyncDocument(reply.data)
                return .success(
                    TextTextFileContent(
                        text: decoded.markdown,
                        documentJSON: decoded.documentJSON,
                        templateJSON: decoded.templateJSON,
                        hash: reply.bareETag))
            } catch {
                return .failure(.decode(error.localizedDescription))
            }
        }
    }

    // MARK: Local agent commands

    public func agentReadItem(
        postId: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommand(
            name: "read_item", arguments: ["id": postId],
            agentName: agentName, agentIntent: agentIntent)
    }

    public func agentSearchItems(
        query: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommand(
            name: "search", arguments: ["query": query],
            agentName: agentName, agentIntent: agentIntent)
    }

    public func agentCreateItem(
        markdown: String, folderPath: String, idempotencyKey: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommand(
            name: "create_item",
            arguments: [
                "markdown": markdown,
                "folder_path": folderPath,
                "idempotency_key": idempotencyKey,
            ],
            agentName: agentName, agentIntent: agentIntent)
    }

    public func agentCaptureItem(
        capture: String, folderPath: String?, idempotencyKey: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        var arguments = [
            "capture": capture,
            "idempotency_key": idempotencyKey,
        ]
        if let folderPath, !folderPath.isEmpty {
            arguments["folder_path"] = folderPath
        }
        return await agentCommand(
            name: "create_item", arguments: arguments,
            agentName: agentName, agentIntent: agentIntent)
    }

    public func agentUpdateItem(
        postId: String, markdown: String, ifMatchHash: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommand(
            name: "update_item",
            arguments: [
                "id": postId,
                "markdown": markdown,
                "if_match_hash": ifMatchHash,
            ],
            agentName: agentName, agentIntent: agentIntent)
    }

    public func agentUpdateItemSection(
        postId: String, section: String, expectedBody: String,
        replacementBody: String, ifMatchHash: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommand(
            name: "update_item",
            arguments: [
                "id": postId,
                "section": section,
                "expected_section_body": expectedBody,
                "body": replacementBody,
                "if_match_hash": ifMatchHash,
            ],
            agentName: agentName, agentIntent: agentIntent)
    }

    public func agentAppendItem(
        postId: String, markdown: String, ifMatchHash: String,
        idempotencyKey: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommand(
            name: "append_to_item",
            arguments: [
                "id": postId,
                "markdown": markdown,
                "if_match_hash": ifMatchHash,
                "idempotency_key": idempotencyKey,
            ],
            agentName: agentName, agentIntent: agentIntent)
    }

    /// Run any workspace command the route allows, with arbitrary arguments.
    ///
    /// The typed wrappers below cover the handful of verbs this CLI grew up
    /// with. The route now allows two dozen, and without this there was no way
    /// to reach the rest from the executable: an agent on this Mac could be
    /// told it may move an item or comment on one, and have nothing to say it
    /// with. Arguments are passed through as JSON because commands like
    /// create_item_type carry nested objects, which the string-map wrapper
    /// cannot express.
    /// What this connection may ask the workspace to do.
    ///
    /// Answered by the route, not by a list compiled into this binary, because
    /// a list here would be a second copy that drifts the moment the workspace
    /// changes - which is how the CLI came to be six verbs behind in the first
    /// place.
    public func agentAvailableCommands(
        agentName: String?, agentIntent: String?
    ) async -> Result<String, TextTextSyncError> {
        var headers: [String: String] = [:]
        if let agentName = Self.safeAgentHeader(agentName, maximumLength: 120) {
            headers["X-TextText-Agent-Name"] = agentName
        }
        if let agentIntent = Self.safeAgentHeader(agentIntent, maximumLength: 500) {
            headers["X-TextText-Agent-Intent"] = agentIntent
        }
        switch await send("GET", "/api/agent/commands", headers: headers, body: nil) {
        case .failure(let error): return .failure(error)
        case .success(let reply):
            guard reply.status == 200 else { return .failure(reply.httpError) }
            return .success(String(decoding: reply.data, as: UTF8.self))
        }
    }

    public func agentRunCommand(
        name: String, argumentsJSON: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        let parsed: Any
        do {
            parsed = try JSONSerialization.jsonObject(
                with: Data(argumentsJSON.utf8), options: [])
        } catch {
            return .failure(.decode("Arguments must be a JSON object: \(error.localizedDescription)"))
        }
        guard let arguments = parsed as? [String: Any] else {
            return .failure(.decode("Arguments must be a JSON object"))
        }
        return await agentCommandJSON(
            name: name, arguments: arguments,
            agentName: agentName, agentIntent: agentIntent)
    }

    private func agentCommand(
        name: String, arguments: [String: String],
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        await agentCommandJSON(
            name: name, arguments: arguments,
            agentName: agentName, agentIntent: agentIntent)
    }

    private func agentCommandJSON(
        name: String, arguments: [String: Any],
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        let encoded: Data
        do {
            encoded = try JSONSerialization.data(withJSONObject: [
                "name": name,
                "arguments": arguments,
            ])
        } catch {
            return .failure(.decode(error.localizedDescription))
        }
        var headers = ["Content-Type": "application/json"]
        if let agentName = Self.safeAgentHeader(agentName, maximumLength: 120) {
            headers["X-TextText-Agent-Name"] = agentName
        }
        if let agentIntent = Self.safeAgentHeader(agentIntent, maximumLength: 500) {
            headers["X-TextText-Agent-Intent"] = agentIntent
        }
        switch await send(
            "POST", "/api/agent/commands", headers: headers, body: encoded
        ) {
        case .failure(let error): return .failure(error)
        case .success(let reply):
            guard reply.status == 200 else { return .failure(reply.httpError) }
            switch decode(TextTextAgentCommandReply.self, reply.data) {
            case .failure(let error): return .failure(error)
            case .success(let commandReply):
                guard commandReply.isError == true else { return .success(commandReply) }
                let message = commandReply.message ?? "The workspace command failed"
                if message.hasPrefix("Conflict:") { return .failure(.conflict) }
                return .failure(.rejected(message))
            }
        }
    }

    public func documentArtifacts(
        postId: String
    ) async -> Result<TextTextArtifactManifest, TextTextSyncError> {
        await get(
            "/api/sync/v1/files/\(escape(postId))/artifacts",
            as: TextTextArtifactManifest.self)
    }

    public func artifactData(
        url: URL
    ) async -> Result<TextTextArtifactContent, TextTextSyncError> {
        guard url.scheme?.lowercased() == "https",
            let host = url.host?.lowercased(),
            host.hasSuffix(".blob.vercel-storage.com"),
            Self.isAllowedArtifactPath(url.path)
        else {
            return .failure(.rejected("Artifact URL is not TextText-hosted"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.network("not an HTTP response"))
            }
            guard http.statusCode == 200 else {
                return .failure(.http(http.statusCode, "artifact download failed"))
            }
            return .success(
                TextTextArtifactContent(
                    data: data,
                    contentType: http.value(forHTTPHeaderField: "Content-Type")))
        } catch {
            return .failure(.network(error.localizedDescription))
        }
    }

    public func uploadAsset(
        postId: String, filename: String, data: Data, contentType: String?
    ) async -> Result<TextTextArtifact, TextTextSyncError> {
        guard TextTextDocumentAssets.isSafeFilename(filename),
            !data.isEmpty
        else {
            return .failure(.rejected("Asset is empty or has an unsafe filename"))
        }
        let boundary =
            "TextTextBoundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        body.append("Content-Type: \(contentType ?? "application/octet-stream")\r\n\r\n")
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n")
        switch await send(
            "POST", "/api/sync/v1/files/\(escape(postId))/assets",
            headers: ["Content-Type": "multipart/form-data; boundary=\(boundary)"],
            body: body
        ) {
        case .failure(let error): return .failure(error)
        case .success(let reply):
            if reply.status == 404 { return .failure(.notFound) }
            if reply.status == 400 || reply.status == 413 {
                return .failure(.rejected(reply.errorMessage))
            }
            guard reply.status == 201 else { return .failure(reply.httpError) }
            return decode(ArtifactEnvelope.self, reply.data).map(\.artifact)
        }
    }

    public func changes(
        since cursor: String?, wait: Int
    ) async -> Result<TextTextChangeReply, TextTextSyncError> {
        var path = "/api/sync/v1/changes"
        var query: [String] = []
        if let cursor { query.append("cursor=\(escape(cursor))") }
        if wait > 0 { query.append("wait=\(wait)") }
        if !query.isEmpty { path += "?" + query.joined(separator: "&") }
        // The request must outlive the server's long-poll window.
        let timeout = wait > 0 ? TimeInterval(wait) + 20 : 30
        return await get(path, as: TextTextChangeReply.self, timeout: timeout)
    }

    // MARK: Writes (Phase 3 wires these into the extension)

    public func createFile(
        body: String, folderId: String?, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await createFileRequest(
            body: body, documentJSON: nil, folderId: folderId,
            representation: .markdown,
            idempotencyKey: idempotencyKey)
    }

    public func createFile(
        body: String, folderId: String?, representation: TextTextFileRepresentation,
        idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await createFileRequest(
            body: body, documentJSON: nil, folderId: folderId,
            representation: representation, idempotencyKey: idempotencyKey)
    }

    public func createFile(
        body: String, documentJSON: String?, folderId: String?,
        representation: TextTextFileRepresentation, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await createFileRequest(
            body: body, documentJSON: documentJSON, folderId: folderId,
            representation: representation, idempotencyKey: idempotencyKey)
    }

    private func createFileRequest(
        body: String, documentJSON: String?, templateJSON: String? = nil,
        folderId: String?,
        representation: TextTextFileRepresentation, idempotencyKey: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        var path = "/api/sync/v1/files"
        if let folderId, !folderId.isEmpty { path += "?folder=\(escape(folderId))" }
        let encodedBody: Data
        let contentType: String
        if representation.isTextBundleFamily, let documentJSON {
            do {
                encodedBody = try Self.encodeSyncDocument(
                    markdown: body, documentJSON: documentJSON,
                    templateJSON: templateJSON)
                contentType = Self.syncDocumentContentType
            } catch {
                return .failure(.decode(error.localizedDescription))
            }
        } else {
            encodedBody = Data(body.utf8)
            contentType = "text/markdown; charset=utf-8"
        }
        var headers = [
            "Content-Type": contentType,
            "TextText-File-Representation": representation.rawValue,
        ]
        if let idempotencyKey { headers["Idempotency-Key"] = idempotencyKey }
        switch await send("POST", path, headers: headers, body: encodedBody) {
        case .failure(let e): return .failure(e)
        case .success(let reply):
            if reply.status == 400 { return .failure(.rejected(reply.errorMessage)) }
            guard reply.status == 201 else { return .failure(reply.httpError) }
            return decode(ItemEnvelope.self, reply.data).map { $0.item }
        }
    }

    public func patchFile(
        postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        var json: [String: Any] = [:]
        if let folderId, !folderId.isEmpty { json["folder"] = folderId }
        if let slug, !slug.isEmpty { json["slug"] = slug }
        if let title, !title.isEmpty { json["title"] = title }
        guard let body = try? JSONSerialization.data(withJSONObject: json) else {
            return .failure(.decode("could not encode request body"))
        }
        var headers = ["Content-Type": "application/json"]
        // Vercel consumes standard If-Match on PATCH before the route runs.
        // Use TextText's scoped equivalent so the server can perform its own
        // exact file-hash and database-revision compare-and-swap.
        if let hash { headers["X-TextText-If-Match"] = "\"\(hash)\"" }
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
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        await putFile(
            postId: postId, body: body, documentJSON: nil, ifMatch: hash)
    }

    public func putFile(
        postId: String, body: String, documentJSON: String?,
        templateJSON: String? = nil, ifMatch hash: String
    ) async -> Result<TextTextManifestItem, TextTextSyncError> {
        let encodedBody: Data
        let contentType: String
        if let documentJSON {
            do {
                encodedBody = try Self.encodeSyncDocument(
                    markdown: body, documentJSON: documentJSON,
                    templateJSON: templateJSON)
                contentType = Self.syncDocumentContentType
            } catch {
                return .failure(.decode(error.localizedDescription))
            }
        } else {
            encodedBody = Data(body.utf8)
            contentType = "text/markdown; charset=utf-8"
        }
        let headers = [
            "If-Match": "\"\(hash)\"",
            "Content-Type": contentType,
        ]
        switch await send(
            "PUT", "/api/sync/v1/files/\(escape(postId))",
            headers: headers, body: encodedBody
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

    private static func safeAgentHeader(
        _ value: String?, maximumLength: Int
    ) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
            trimmed.count <= maximumLength,
            trimmed.unicodeScalars.allSatisfy({
                !CharacterSet.controlCharacters.contains($0)
            })
        else { return nil }
        return trimmed
    }

    private static func decodeSyncDocument(
        _ data: Data
    ) throws -> (markdown: String, documentJSON: String, templateJSON: String?) {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            root["schema"] as? String == "texttext.sync-document.v1",
            let markdown = root["markdown"] as? String,
            let document = root["document"] as? [String: Any]
        else {
            throw NSError(
                domain: "TextTextSync", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "invalid structured document"])
        }
        let documentData = try JSONSerialization.data(
            withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
        guard let documentJSON = String(data: documentData, encoding: .utf8) else {
            throw NSError(
                domain: "TextTextSync", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "document is not UTF-8"])
        }
        // Optional: an older server does not send it, and a document pinned to
        // a deleted look has none to send. Absent means the bundle falls back
        // to the folder's look, exactly as it did before this key existed.
        var templateJSON: String?
        if let template = root["template"] as? [String: Any] {
            let templateData = try JSONSerialization.data(
                withJSONObject: template, options: [.prettyPrinted, .sortedKeys])
            templateJSON = String(data: templateData, encoding: .utf8).map { $0 + "\n" }
        }
        return (markdown, documentJSON + "\n", templateJSON)
    }

    private static func encodeSyncDocument(
        markdown: String, documentJSON: String, templateJSON: String? = nil
    ) throws -> Data {
        let data = Data(documentJSON.utf8)
        guard
            let document = try JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        else {
            throw NSError(
                domain: "TextTextSync", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "document.json must contain an object"])
        }
        var payload: [String: Any] = [
            "schema": "texttext.sync-document.v1",
            "markdown": markdown,
            "document": document,
        ]
        // Send the look back too, so a textpack carried in from elsewhere
        // brings its design with it. Without this the definition only ever
        // travelled outward and the round trip was half a trip. A malformed
        // one is dropped rather than failing the write: the words matter more
        // than the styling.
        if let templateJSON,
            let template = try? JSONSerialization.jsonObject(with: Data(templateJSON.utf8))
                as? [String: Any] {
            payload["template"] = template
        }
        return try JSONSerialization.data(
            withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    }

    public func deleteFile(postId: String, ifMatch hash: String?) async -> Result<
        Void, TextTextSyncError
    > {
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
    ) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
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
    ) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> {
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
    ) async -> Result<TextTextWorkspaceBlog, TextTextSyncError> {
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

    private struct ManifestEnvelope: Codable { let items: [TextTextManifestItem] }
    private struct ItemEnvelope: Codable { let item: TextTextManifestItem }
    private struct ArtifactEnvelope: Codable { let artifact: TextTextArtifact }
    private struct FolderEnvelope: Codable { let folder: TextTextWorkspaceFolder }
    private struct BlogEnvelope: Codable { let blog: TextTextWorkspaceBlog }

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
                let message = object["error"] as? String
            {
                return message
            }
            return "status \(status)"
        }
        var httpError: TextTextSyncError { .http(status, errorMessage) }
    }

    private func escape(_ component: String) -> String {
        component.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? component
    }

    private static func isAllowedArtifactPath(_ path: String) -> Bool {
        path.hasPrefix("/captures/")
            || path.hasPrefix("/documents/")
            || path.hasPrefix("/editor/media/")
    }

    private func decode<T: Decodable>(
        _ type: T.Type, _ data: Data
    ) -> Result<T, TextTextSyncError> {
        guard let value = try? JSONDecoder().decode(T.self, from: data) else {
            return .failure(.decode("\(T.self) did not decode"))
        }
        return .success(value)
    }

    private func get<T: Decodable>(
        _ path: String, as type: T.Type, timeout: TimeInterval? = nil
    ) async -> Result<T, TextTextSyncError> {
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
    ) async -> Result<Reply, TextTextSyncError> {
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

extension Data {
    fileprivate mutating func append(_ string: String) {
        append(contentsOf: string.utf8)
    }
}
