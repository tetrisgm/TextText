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
    func agentReadItem(
        postId: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError>
    func agentCreateItem(
        markdown: String, folderPath: String, idempotencyKey: String,
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

    public func readMarkdown(at reference: CLIDocumentReference) async throws -> String {
        switch reference {
        case .local(let url):
            return try DocumentStore(root: url.deletingLastPathComponent())
                .readMarkdown(at: url)
        case .remote(let document):
            guard case .remote(let store) = self else {
                throw TextTextCLIError.documentNotFound(document.path)
            }
            return try await store.readMarkdown(at: document)
        }
    }

    public func writeMarkdown(
        _ markdown: String, to reference: CLIDocumentReference
    ) async throws {
        switch reference {
        case .local(let url):
            try DocumentStore(root: url.deletingLastPathComponent())
                .writeMarkdown(markdown, to: url)
        case .remote(let document):
            guard case .remote(let store) = self else {
                throw TextTextCLIError.documentNotFound(document.path)
            }
            try await store.writeMarkdown(markdown, to: document)
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
        in reference: CLIDocumentReference
    ) async throws {
        switch reference {
        case .local(let url):
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
                replacement, section: section, in: document)
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
        if let workspace { query.append(URLQueryItem(name: "workspace", value: workspace)) }
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
        let documents = try await snapshot().documents
        let normalized = name.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

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
        let content = try await fetchCommandContent(document)
        return content.text
    }

    public func writeMarkdown(_ markdown: String, to document: RemoteDocument) async throws {
        let current = try await cachedOrFetchContent(document)
        guard let hash = current.hash, !hash.isEmpty else {
            throw TextTextCLIError.workspaceUnavailable(
                "the server did not provide a document version")
        }
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
        in document: RemoteDocument
    ) async throws {
        let current = try await cachedOrFetchContent(document)
        guard let hash = current.hash, !hash.isEmpty else {
            throw TextTextCLIError.workspaceUnavailable(
                "the server did not provide a document version")
        }
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
