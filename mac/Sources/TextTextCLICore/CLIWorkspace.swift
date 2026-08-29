import Foundation
import TextTextFileProviderKit

/// The small sync surface the command-line client needs. Keeping this narrower
/// than `TextTextSyncAPI` makes the remote CLI path independently testable while
/// still reusing the production authenticated sync transport.
public protocol TextTextCLISyncAPI: Sendable {
    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError>
    func manifest(folderId: String) async
        -> Result<[TextTextManifestItem], TextTextSyncError>
    func fileContent(
        postId: String, representation: TextTextFileRepresentation
    ) async -> Result<TextTextFileContent, TextTextSyncError>
    func agentRunCommand(
        name: String, argumentsJSON: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentReadItem(
        postId: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentSearchItems(
        query: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentCreateItem(
        markdown: String, folderPath: String, idempotencyKey: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentCaptureItem(
        capture: String, folderPath: String?, idempotencyKey: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentUpdateItem(
        postId: String, markdown: String, ifMatchHash: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentUpdateItemSection(
        postId: String, section: String, expectedBody: String,
        replacementBody: String, ifMatchHash: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentAppendItem(
        postId: String, markdown: String, ifMatchHash: String,
        idempotencyKey: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
}

extension LiveTextTextSyncAPI: TextTextCLISyncAPI {}

public struct RemoteDocument: Equatable, Sendable {
    public let path: String
    public let itemId: String
    public let folderId: String
    public let workspaceHandle: String
    public let representation: TextTextFileRepresentation

    public init(
        path: String, itemId: String, folderId: String,
        workspaceHandle: String, representation: TextTextFileRepresentation
    ) {
        self.path = path
        self.itemId = itemId
        self.folderId = folderId
        self.workspaceHandle = workspaceHandle
        self.representation = representation
    }
}

public struct CLIDocumentContent: Equatable, Sendable {
    public let markdown: String
    public let hash: String?

    public init(markdown: String, hash: String?) {
        self.markdown = markdown
        self.hash = hash
    }
}

public enum CLIDocumentReference: Equatable, Sendable {
    case local(URL)
    case remote(RemoteDocument)

    public var itemId: String? {
        switch self {
        case .local: return nil
        case .remote(let document): return document.itemId
        }
    }
}

public struct AgentCaptureReceipt: Equatable, Sendable {
    public let itemId: String?
    public let kind: String
    public let savedTo: String
    public let title: String

    public init(itemId: String?, kind: String, savedTo: String, title: String) {
        self.itemId = itemId
        self.kind = kind
        self.savedTo = savedTo
        self.title = title
    }
}

public struct CLICaptureResult: Equatable, Sendable {
    public let reference: CLIDocumentReference
    public let receipt: AgentCaptureReceipt

    public init(reference: CLIDocumentReference, receipt: AgentCaptureReceipt) {
        self.reference = reference
        self.receipt = receipt
    }
}

/// Command-scoped attribution travels with async work without becoming global
/// mutable process state. Only the remote transport consumes it; local files
/// retain their existing presence behavior.
public enum CLICommandActor {
    @TaskLocal public static var current: AgentActor?
}

/// One command-line view of the workspace.
///
/// A signed-in standalone app already owns a revocable, tenant-scoped device
/// credential. The CLI uses that credential directly against the authenticated
/// sync routes, so Finder integration is optional and there is no local server,
/// copied token, or second sign-in. `TEXTTEXT_WORKSPACE_ROOT` deliberately keeps
/// the original file backend for tests and explicit offline file workflows.
public enum CLIWorkspace: Sendable {
    case local(DocumentStore)
    case remote(RemoteDocumentStore)

    public static func locate(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> CLIWorkspace {
        if let root = environment["TEXTTEXT_WORKSPACE_ROOT"], !root.isEmpty {
            return .local(DocumentStore(root: URL(fileURLWithPath: root)))
        }

        if let credentials = DeviceCredentials.load(
            fileManager: fileManager, environment: environment),
            let origin = credentials.validatedServerOrigin
        {
            let api = LiveTextTextSyncAPI(origin: origin, token: credentials.token)
            return .remote(RemoteDocumentStore(api: api))
        }

        // Finder integration is optional and may be disabled. Never silently
        // change transports based on a mount that happens to exist: the signed
        // in app credential is the one canonical local-agent path.
        throw TextTextCLIError.workspaceNotFound
    }

    public func list(under folder: String? = nil) async throws -> [String] {
        switch self {
        case .local(let store): return try store.list(under: folder)
        case .remote(let store): return try await store.list(under: folder)
        }
    }

    public func references(under folder: String? = nil) async throws
        -> [CLIDocumentReference]
    {
        switch self {
        case .local(let store):
            return try store.list(under: folder).map {
                .local(store.root.appendingPathComponent($0))
            }
        case .remote(let store):
            return try await store.documents(under: folder).map {
                .remote($0)
            }
        }
    }

    public func resolve(_ name: String) async throws -> CLIDocumentReference {
        switch self {
        case .local(let store):
            return .local(try store.resolve(name))
        case .remote(let store):
            guard !name.hasPrefix("/") else {
                throw TextTextCLIError.invalidDocument(
                    "remote documents must use a workspace-relative path")
            }
            return .remote(try await store.resolve(name))
        }
    }

    /// Search uses the authenticated workspace command instead of downloading
    /// every folder manifest and document into a second local index.
    public func search(_ query: String) async throws -> [TextTextAgentSearchResult] {
        switch self {
        case .remote(let store): return try await store.search(query)
        case .local:
            throw TextTextCLIError.workspaceUnavailable(
                "search needs the signed-in TextText workspace")
        }
    }

    public func runCommand(
        _ name: String, argumentsJSON: String
    ) async throws -> String {
        switch self {
        case .remote(let store):
            return try await store.runCommand(name, argumentsJSON: argumentsJSON)
        case .local:
            throw TextTextCLIError.workspaceUnavailable(
                "workspace commands need the signed-in TextText workspace")
        }
    }

    public func readContent(
        at reference: CLIDocumentReference
    ) async throws -> CLIDocumentContent {
        switch reference {
        case .local(let url):
            return CLIDocumentContent(
                markdown: try DocumentStore(
                    root: url.deletingLastPathComponent()
                ).readMarkdown(at: url),
                hash: nil)
        case .remote(let document):
            guard case .remote(let store) = self else {
                throw TextTextCLIError.documentNotFound(document.path)
            }
            return try await store.readContent(at: document)
        }
    }

    public func readMarkdown(at reference: CLIDocumentReference) async throws -> String {
        try await readContent(at: reference).markdown
    }

    public func writeMarkdown(
        _ markdown: String, to reference: CLIDocumentReference,
        ifMatchHash: String? = nil
    ) async throws {
        switch reference {
        case .local(let url):
            if ifMatchHash != nil {
                throw TextTextCLIError.workspaceUnavailable(
                    "--if-match-hash needs the signed-in workspace")
            }
            try DocumentStore(root: url.deletingLastPathComponent())
                .writeMarkdown(markdown, to: url)
        case .remote(let document):
            guard case .remote(let store) = self else {
                throw TextTextCLIError.documentNotFound(document.path)
            }
            try await store.writeMarkdown(
                markdown, to: document, ifMatchHash: ifMatchHash)
        }
    }

    public func appendMarkdown(
        _ markdown: String, to reference: CLIDocumentReference,
        idempotencyKey: String? = nil
    ) async throws {
        switch reference {
        case .local(let url):
            let store = DocumentStore(root: url.deletingLastPathComponent())
            let current = try store.readMarkdown(at: url)
            let separator = current.hasSuffix("\n") ? "" : "\n"
            try store.writeMarkdown(current + separator + markdown, to: url)
        case .remote(let document):
            guard case .remote(let store) = self else {
                throw TextTextCLIError.documentNotFound(document.path)
            }
            try await store.appendMarkdown(
                markdown, to: document, idempotencyKey: idempotencyKey)
        }
    }

    public func replaceSectionBody(
        _ replacement: String, section: DocumentSection,
        in reference: CLIDocumentReference, ifMatchHash: String? = nil
    ) async throws {
        switch reference {
        case .local(let url):
            if ifMatchHash != nil {
                throw TextTextCLIError.workspaceUnavailable(
                    "--if-match-hash needs the signed-in workspace")
            }
            let store = DocumentStore(root: url.deletingLastPathComponent())
            let current = try store.readMarkdown(at: url)
            try store.writeMarkdown(
                DocumentSections.replaceBody(
                    of: section, in: current, with: replacement),
                to: url)
        case .remote(let document):
            guard case .remote(let store) = self else {
                throw TextTextCLIError.documentNotFound(document.path)
            }
            try await store.replaceSectionBody(
                replacement, section: section, in: document,
                ifMatchHash: ifMatchHash)
        }
    }

    @discardableResult
    public func create(
        title: String, body: String = "", folder: String? = nil,
        kind: String = "note", idempotencyKey: String? = nil
    ) async throws -> CLIDocumentReference {
        switch self {
        case .local(let store):
            return .local(
                try store.create(
                    title: title, body: body, folder: folder, kind: kind))
        case .remote(let store):
            return .remote(
                try await store.create(
                    title: title, body: body, folder: folder, kind: kind,
                    idempotencyKey: idempotencyKey))
        }
    }

    @discardableResult
    public func capture(
        _ input: AgentCaptureInput, rawValue: String, folder: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> CLICaptureResult {
        switch self {
        case .local(let store):
            let url = try store.create(
                title: input.title, body: input.body,
                folder: folder ?? input.folder, kind: input.kind,
                sourceURL: input.sourceURL)
            let reference = CLIDocumentReference.local(url)
            let relative = store.relativePath(of: url)
            return CLICaptureResult(
                reference: reference,
                receipt: AgentCaptureReceipt(
                    itemId: store.itemId(at: url),
                    kind: input.kind,
                    savedTo: relative.split(separator: "/").dropLast()
                        .joined(separator: "/"),
                    title: input.title))
        case .remote(let store):
            let captured = try await store.capture(
                input, rawValue: rawValue, folder: folder,
                idempotencyKey: idempotencyKey)
            return CLICaptureResult(
                reference: .remote(captured.document),
                receipt: captured.receipt)
        }
    }

    public func relativePath(of reference: CLIDocumentReference) -> String {
        switch reference {
        case .local(let url):
            if case .local(let store) = self { return store.relativePath(of: url) }
            return url.path
        case .remote(let document): return document.path
        }
    }

    public func itemId(at reference: CLIDocumentReference) async -> String? {
        switch reference {
        case .remote(let document): return document.itemId
        case .local(let url):
            return DocumentStore(root: url.deletingLastPathComponent()).itemId(at: url)
        }
    }

    public func itemLink(for reference: CLIDocumentReference) async -> URL? {
        let itemId: String?
        let workspace: String?
        switch reference {
        case .remote(let document):
            itemId = document.itemId
            workspace = document.workspaceHandle
        case .local(let url):
            itemId = DocumentStore(root: url.deletingLastPathComponent()).itemId(at: url)
            workspace = nil
        }
        guard let itemId else { return nil }
        var components = URLComponents()
        components.scheme = "texttext-app"
        components.host = "item"
        components.path = "/\(itemId)"
        var query = [URLQueryItem(name: "mode", value: "edit")]
        if let workspace, !workspace.isEmpty {
            query.append(URLQueryItem(name: "workspace", value: workspace))
        }
        components.queryItems = query
        return components.url
    }

    public func lint(_ reference: CLIDocumentReference) async -> [LintFinding] {
        let name = relativePath(of: reference)
        switch reference {
        case .local(let url): return DocumentLinter.check(url, named: name)
        case .remote:
            // A remote read is decoded as a validated UTF-8 sync document by
            // the same transport the app's File Provider uses. If that read
            // succeeds, there is no package boundary left for the CLI to lint.
            do {
                _ = try await readMarkdown(at: reference)
                return []
            } catch {
                return [LintFinding(document: name, problem: String(describing: error))]
            }
        }
    }

    public var usesRemoteSync: Bool {
        if case .remote = self { return true }
        return false
    }
}

/// Direct, credentialed workspace access for the bundled CLI.
public final class RemoteDocumentStore: @unchecked Sendable {
    private struct Snapshot {
        let workspace: TextTextWorkspace
        let documents: [RemoteDocument]
        let foldersByDisplayPath: [String: TextTextWorkspaceFolder]
    }

    private let api: any TextTextCLISyncAPI
    private let cacheLock = NSLock()
    private var contentByItemId: [String: TextTextFileContent] = [:]
    private var documentByItemId: [String: RemoteDocument] = [:]

    public init(api: any TextTextCLISyncAPI) {
        self.api = api
    }

    public func list(under folder: String? = nil) async throws -> [String] {
        try await documents(under: folder).map(\.path)
    }

    public func documents(under folder: String? = nil) async throws
        -> [RemoteDocument]
    {
        let snapshot = try await snapshot()
        guard let folder, !folder.isEmpty else { return snapshot.documents }
        let normalized = folder.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let prefix = normalized + "/"
        return snapshot.documents.filter {
            $0.path.caseInsensitiveCompare(normalized) == .orderedSame
                || $0.path.lowercased().hasPrefix(prefix.lowercased())
        }
    }

    public func resolve(_ name: String) async throws -> RemoteDocument {
        let normalized = name.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if let cached = cacheLock.withLock({ documentByItemId[normalized] }) {
            return cached
        }
        if Self.looksLikeItemId(normalized) {
            return RemoteDocument(
                path: normalized, itemId: normalized, folderId: "",
                workspaceHandle: "", representation: .textpack)
        }
        let documents = try await snapshot().documents

        // Search results expose the durable item id. Accepting it directly
        // makes `texttext search ...` followed by `texttext read <id>` an exact
        // readback rather than a potentially ambiguous title lookup.
        if let item = documents.first(where: { $0.itemId == normalized }) {
            return item
        }

        if let exact = documents.first(where: {
            $0.path.caseInsensitiveCompare(normalized) == .orderedSame
        }) {
            return exact
        }

        for suffix in TextTextFileRepresentation.allCases.map(\.filenameSuffix)
        where !normalized.lowercased().hasSuffix(suffix) {
            if let exact = documents.first(where: {
                $0.path.caseInsensitiveCompare(normalized + suffix) == .orderedSame
            }) {
                return exact
            }
        }

        let needle = ((normalized as NSString).lastPathComponent as NSString)
            .deletingPathExtension.lowercased()
        let matches = documents.filter {
            ((($0.path as NSString).lastPathComponent as NSString)
                .deletingPathExtension.lowercased()) == needle
        }
        switch matches.count {
        case 0: throw TextTextCLIError.documentNotFound(name)
        case 1: return matches[0]
        default: throw TextTextCLIError.ambiguous(name, matches.map(\.path))
        }
    }

    public func readMarkdown(at document: RemoteDocument) async throws -> String {
        try await readContent(at: document).markdown
    }

    public func readContent(
        at document: RemoteDocument
    ) async throws -> CLIDocumentContent {
        let content = try await fetchCommandContent(document)
        return CLIDocumentContent(markdown: content.text, hash: content.hash)
    }

    /// Run any workspace command the route allows, and hand back its reply.
    ///
    /// The named verbs above cover what this CLI grew up with. The route allows
    /// two dozen, and without this there was no way to reach the rest from the
    /// executable, so an agent on this Mac could be told it may move an item or
    /// comment on one and have nothing to say it with.
    public func runCommand(
        _ name: String, argumentsJSON: String
    ) async throws -> String {
        switch await api.agentRunCommand(
            name: name, argumentsJSON: argumentsJSON,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        {
        case .success(let reply):
            return reply.message ?? ""
        case .failure(let error):
            throw TextTextCLIError.workspaceUnavailable(String(describing: error))
        }
    }

    public func search(_ query: String) async throws -> [TextTextAgentSearchResult] {
        switch await api.agentSearchItems(
            query: query,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        {
        case .success(let reply):
            guard let results = reply.structuredContent?.results else {
                throw TextTextCLIError.workspaceUnavailable(
                    "the server returned no search results")
            }
            cacheLock.withLock {
                for result in results {
                    let filename = TextTextFilename.filename(
                        title: result.title, slug: result.id,
                        representation: .textpack)
                    documentByItemId[result.id] = RemoteDocument(
                        path: [result.folderPath ?? "", filename]
                            .filter { !$0.isEmpty }.joined(separator: "/"),
                        itemId: result.id, folderId: "", workspaceHandle: "",
                        representation: .textpack)
                }
            }
            return results
        case .failure(let error):
            throw Self.cliError(error)
        }
    }

    public func writeMarkdown(
        _ markdown: String, to document: RemoteDocument,
        ifMatchHash: String? = nil
    ) async throws {
        let current = try await cachedOrFetchContent(document)
        let hash = try guardedHash(
            current, expected: ifMatchHash, document: document)
        let result = await api.agentUpdateItem(
            postId: document.itemId,
            markdown: markdown,
            ifMatchHash: hash,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        switch result {
        case .success:
            _ = cacheLock.withLock { contentByItemId.removeValue(forKey: document.itemId) }
        case .failure(let error):
            throw Self.cliError(error, document: document.path)
        }
    }

    public func appendMarkdown(
        _ markdown: String, to document: RemoteDocument,
        idempotencyKey: String? = nil
    ) async throws {
        let current = try await cachedOrFetchContent(document)
        guard let hash = current.hash, !hash.isEmpty else {
            throw TextTextCLIError.workspaceUnavailable(
                "the server did not provide a document version")
        }
        let key = idempotencyKey ?? "cli-append-\(UUID().uuidString.lowercased())"
        let result = await api.agentAppendItem(
            postId: document.itemId,
            markdown: markdown,
            ifMatchHash: hash,
            idempotencyKey: key,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        switch result {
        case .success:
            _ = cacheLock.withLock {
                contentByItemId.removeValue(forKey: document.itemId)
            }
        case .failure(.network):
            switch await api.agentAppendItem(
                postId: document.itemId,
                markdown: markdown,
                ifMatchHash: hash,
                idempotencyKey: key,
                agentName: CLICommandActor.current?.name,
                agentIntent: CLICommandActor.current?.message)
            {
            case .success:
                _ = cacheLock.withLock {
                    contentByItemId.removeValue(forKey: document.itemId)
                }
            case .failure(let error):
                throw Self.cliError(error, document: document.path)
            }
        case .failure(let error):
            throw Self.cliError(error, document: document.path)
        }
    }

    public func replaceSectionBody(
        _ replacement: String, section: DocumentSection,
        in document: RemoteDocument, ifMatchHash: String? = nil
    ) async throws {
        let current = try await cachedOrFetchContent(document)
        let hash = try guardedHash(
            current, expected: ifMatchHash, document: document)
        let expected = DocumentSections.body(of: section, in: current.text)
        let result = await api.agentUpdateItemSection(
            postId: document.itemId,
            section: section.heading,
            expectedBody: expected,
            replacementBody: replacement,
            ifMatchHash: hash,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        switch result {
        case .success:
            _ = cacheLock.withLock {
                contentByItemId.removeValue(forKey: document.itemId)
            }
        case .failure(let error):
            throw Self.cliError(error, document: document.path)
        }
    }

    @discardableResult
    public func create(
        title: String, body: String = "", folder: String? = nil,
        kind: String = "note", idempotencyKey: String? = nil
    ) async throws -> RemoteDocument {
        let current = try await snapshot()
        let targetFolder = try resolveFolder(folder, kind: kind, in: current)
        // An explicitly selected folder controls the presentation kind. The
        // command's default `note` is only a default-folder hint; carrying it
        // into Blog or Bookmarks makes the shared command reject the create.
        let effectiveKind: String
        switch targetFolder.mode
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        {
        case "notes": effectiveKind = "note"
        case "bookmarks": effectiveKind = "bookmark"
        default: effectiveKind = "article"
        }
        let markdown =
            DocumentCreation.frontmatter(
                title: title, kind: effectiveKind)
            + (body.isEmpty ? "" : body.trimmingCharacters(in: .newlines) + "\n")
        let key = idempotencyKey ?? "cli-create-\(UUID().uuidString.lowercased())"

        let result = await api.agentCreateItem(
            markdown: markdown, folderPath: targetFolder.path,
            idempotencyKey: key,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        let itemId: String
        switch result {
        case .success(let value):
            guard let id = value.structuredContent?.item?.id, !id.isEmpty else {
                throw TextTextCLIError.workspaceUnavailable(
                    "the server created a document without an identity")
            }
            itemId = id
        case .failure(.network):
            // A lost response may have committed. Reusing the same key makes
            // one bounded retry safe instead of creating a duplicate.
            switch await api.agentCreateItem(
                markdown: markdown, folderPath: targetFolder.path,
                idempotencyKey: key,
                agentName: CLICommandActor.current?.name,
                agentIntent: CLICommandActor.current?.message)
            {
            case .success(let value):
                guard let id = value.structuredContent?.item?.id, !id.isEmpty else {
                    throw TextTextCLIError.workspaceUnavailable(
                        "the server created a document without an identity")
                }
                itemId = id
            case .failure(let error): throw Self.cliError(error)
            }
        case .failure(let error): throw Self.cliError(error)
        }

        // The write is committed before the response. A fresh manifest gives
        // the exact user-facing path and handles sibling title collisions.
        if let created = try await snapshot().documents.first(where: {
            $0.itemId == itemId
        }) {
            return created
        }
        let folderPath = displayPath(
            for: targetFolder, folders: current.workspace.folders)
        let filename = TextTextFilename.filename(
            title: title, slug: itemId, representation: .textpack)
        return RemoteDocument(
            path: [folderPath, filename].filter { !$0.isEmpty }.joined(separator: "/"),
            itemId: itemId,
            folderId: targetFolder.id,
            workspaceHandle: current.workspace.blog.handle,
            representation: .textpack)
    }

    @discardableResult
    public func capture(
        _: AgentCaptureInput, rawValue: String, folder: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> (document: RemoteDocument, receipt: AgentCaptureReceipt) {
        let key = idempotencyKey ?? "cli-capture-\(UUID().uuidString.lowercased())"

        func reply(
            from result: Result<TextTextAgentCommandReply, TextTextSyncError>
        ) throws -> TextTextAgentCommandReply {
            switch result {
            case .success(let value):
                guard let id = value.structuredContent?.item?.id, !id.isEmpty else {
                    throw TextTextCLIError.workspaceUnavailable(
                        "the server captured an item without an identity")
                }
                guard let receipt = value.structuredContent?.receipt,
                    receipt.itemId == id
                else {
                    throw TextTextCLIError.workspaceUnavailable(
                        "the server captured an item without an exact receipt")
                }
                return value
            case .failure(let error): throw Self.cliError(error)
            }
        }

        let first = await api.agentCaptureItem(
            capture: rawValue, folderPath: folder,
            idempotencyKey: key,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        let capturedReply: TextTextAgentCommandReply
        if case .failure(.network) = first {
            capturedReply = try reply(
                from: await api.agentCaptureItem(
                    capture: rawValue, folderPath: folder,
                    idempotencyKey: key,
                    agentName: CLICommandActor.current?.name,
                    agentIntent: CLICommandActor.current?.message))
        } else {
            capturedReply = try reply(from: first)
        }
        guard let structured = capturedReply.structuredContent,
            let createdId = structured.item?.id,
            let authoritative = structured.receipt
        else {
            throw TextTextCLIError.workspaceUnavailable(
                "the server captured an item without an exact receipt")
        }
        let receipt = AgentCaptureReceipt(
            itemId: authoritative.itemId,
            kind: authoritative.kind,
            savedTo: authoritative.savedTo,
            title: authoritative.title)

        // The command receipt is the authority. Do not crawl every manifest
        // after a successful capture or invent a location from the requested
        // folder: an idempotent replay may return an item that was moved.
        let filename = TextTextFilename.filename(
            title: receipt.title, slug: createdId, representation: .textpack)
        let document = RemoteDocument(
            path: [receipt.savedTo, filename].filter { !$0.isEmpty }
                .joined(separator: "/"),
            itemId: createdId,
            folderId: "",
            workspaceHandle: "",
            representation: .textpack)
        cacheLock.withLock { documentByItemId[createdId] = document }
        return (document, receipt)
    }

    private func snapshot() async throws -> Snapshot {
        let workspace: TextTextWorkspace
        switch await api.workspace() {
        case .success(let value): workspace = value
        case .failure(let error): throw Self.cliError(error)
        }

        let manifests = try await withThrowingTaskGroup(
            of: (TextTextWorkspaceFolder, [TextTextManifestItem]).self
        ) { group in
            for folder in workspace.folders {
                group.addTask { [api] in
                    switch await api.manifest(folderId: folder.id) {
                    case .success(let entries): return (folder, entries)
                    case .failure(let error): throw Self.cliError(error)
                    }
                }
            }
            var values: [(TextTextWorkspaceFolder, [TextTextManifestItem])] = []
            for try await value in group { values.append(value) }
            return values
        }

        var documents: [RemoteDocument] = []
        for (folder, entries) in manifests {
            let siblings = TextTextFilename.disambiguate(
                entries.compactMap {
                    TextTextItemMapper.item(
                        for: $0, inFolder: folder.id,
                        handle: workspace.blog.handle, readOnly: false)
                })
            let folderPath = displayPath(for: folder, folders: workspace.folders)
            for item in siblings {
                guard let itemId = item.serverId,
                    let representation = item.representation
                else { continue }
                documents.append(
                    RemoteDocument(
                        path: [folderPath, item.filename]
                            .filter { !$0.isEmpty }.joined(separator: "/"),
                        itemId: itemId,
                        folderId: folder.id,
                        workspaceHandle: workspace.blog.handle,
                        representation: representation))
            }
        }
        documents.sort { $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending }
        let byPath = Dictionary(
            uniqueKeysWithValues: workspace.folders.map {
                (displayPath(for: $0, folders: workspace.folders).lowercased(), $0)
            })
        return Snapshot(
            workspace: workspace, documents: documents,
            foldersByDisplayPath: byPath)
    }

    private func fetchCommandContent(
        _ document: RemoteDocument
    ) async throws -> TextTextFileContent {
        switch await api.agentReadItem(
            postId: document.itemId,
            agentName: CLICommandActor.current?.name,
            agentIntent: CLICommandActor.current?.message)
        {
        case .success(let reply):
            guard let markdown = reply.structuredContent?.markdown,
                let hash = reply.structuredContent?.item?.hash,
                !hash.isEmpty
            else {
                throw TextTextCLIError.workspaceUnavailable(
                    "the server returned an incomplete document")
            }
            let content = TextTextFileContent(text: markdown, hash: hash)
            cacheLock.withLock { contentByItemId[document.itemId] = content }
            return content
        case .failure(let error):
            throw Self.cliError(error, document: document.path)
        }
    }

    private func cachedOrFetchContent(
        _ document: RemoteDocument
    ) async throws -> TextTextFileContent {
        if let cached = cacheLock.withLock({ contentByItemId[document.itemId] }) {
            return cached
        }
        return try await fetchCommandContent(document)
    }

    private func guardedHash(
        _ current: TextTextFileContent, expected: String?,
        document: RemoteDocument
    ) throws -> String {
        guard let hash = current.hash, !hash.isEmpty else {
            throw TextTextCLIError.workspaceUnavailable(
                "the server did not provide a document version")
        }
        if let expected,
            Self.normalizeHash(expected) != Self.normalizeHash(hash)
        {
            throw TextTextCLIError.documentChanged(document.path)
        }
        return hash
    }

    private static func normalizeHash(_ value: String) -> String {
        var normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.lowercased().hasPrefix("w/") {
            normalized.removeFirst(2)
        }
        return normalized.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }

    private static func looksLikeItemId(_ value: String) -> Bool {
        UUID(uuidString: value) != nil
    }

    private func resolveFolder(
        _ requested: String?, kind: String, in snapshot: Snapshot
    ) throws -> TextTextWorkspaceFolder {
        guard let requested, !requested.isEmpty else {
            guard
                let inferred = inferredFolder(
                    for: kind, in: snapshot.workspace.folders)
            else {
                throw TextTextCLIError.folderNotFound(kind)
            }
            return inferred
        }
        let normalized =
            requested
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased()
        if let exact = snapshot.foldersByDisplayPath[normalized] { return exact }
        let matches = snapshot.workspace.folders.filter {
            $0.path.lowercased() == normalized || $0.name.lowercased() == normalized
        }
        switch matches.count {
        case 0: throw TextTextCLIError.folderNotFound(requested)
        case 1: return matches[0]
        default:
            throw TextTextCLIError.ambiguous(
                requested,
                matches.map { displayPath(for: $0, folders: snapshot.workspace.folders) })
        }
    }

    private func inferredFolder(
        for kind: String, in folders: [TextTextWorkspaceFolder]
    ) -> TextTextWorkspaceFolder? {
        let mode = kind == "bookmark" ? "bookmarks" : kind == "note" ? "notes" : "blog"
        return folders.first { $0.mode.lowercased() == mode && $0.parentId == nil }
    }

    private func displayPath(
        for folder: TextTextWorkspaceFolder,
        folders: [TextTextWorkspaceFolder]
    ) -> String {
        var components = [TextTextFilename.encodeComponent(folder.name)]
        var parentId = folder.parentId
        var seen = Set([folder.id])
        while let id = parentId,
            let parent = folders.first(where: { $0.id == id }),
            seen.insert(id).inserted
        {
            components.insert(TextTextFilename.encodeComponent(parent.name), at: 0)
            parentId = parent.parentId
        }
        return components.joined(separator: "/")
    }

    private static func cliError(
        _ error: TextTextSyncError, document: String? = nil
    ) -> TextTextCLIError {
        switch error {
        case .notFound:
            return .documentNotFound(document ?? "the requested document")
        case .conflict:
            return .documentChanged(document ?? "the document")
        case .rejected(let reason), .network(let reason), .decode(let reason):
            return .workspaceUnavailable(reason)
        case .http(let status, let reason):
            if status == 401 { return .workspaceNotFound }
            if status == 404 { return .documentNotFound(document ?? "the requested document") }
            return .workspaceUnavailable(reason)
        }
    }
}

extension NSLock {
    fileprivate func withLock<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}
