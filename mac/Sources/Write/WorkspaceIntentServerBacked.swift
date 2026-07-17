import Foundation
import WriteAppIntents
import WriteFileProviderKit

/// The App Intents' server transport: a thin adapter over the same sync API
/// client (`SyncClient`/`ServerClient`) the app uses everywhere else. This is
/// what makes App Intents create and resolve items through the SERVER (the
/// source of truth) instead of scanning or writing the File Provider mount.
struct ServerBackedWorkspaceIntentServer: WorkspaceIntentServer {
    let client: SyncClient

    func folders() throws -> [WorkspaceServerFolder] {
        switch client.workspace() {
        case .success(let (workspace, _)):
            return workspace.folders.map {
                WorkspaceServerFolder(id: $0.id, name: $0.name, path: $0.path, mode: $0.mode)
            }
        case .failure(let error):
            throw WorkspaceIntentServerError.transport(error.description)
        }
    }

    func items(inFolder folderId: String) throws -> [WorkspaceServerItem] {
        switch client.manifest(folderId: folderId, etag: nil) {
        case .success(.manifest(let items, _)):
            return items.compactMap { Self.serverItem(from: $0, folderId: folderId) }
        case .success(.notModified):
            return []
        case .failure(let error):
            throw WorkspaceIntentServerError.transport(error.description)
        }
    }

    func fileText(id: String) throws -> (text: String, hash: String) {
        switch client.fileText(postId: id) {
        case .success(let (text, hash)):
            guard let hash else {
                throw WorkspaceIntentServerError.transport("the server returned no version for \(id)")
            }
            return (text, hash)
        case .failure(let error):
            throw Self.mapFailure(error, id: id)
        }
    }

    func createDocument(
        body: String, folderId: String?, idempotencyKey: String?
    ) throws -> WorkspaceServerItem {
        // No explicit representation: the server assigns its create-format
        // default (.textpack), keeping the client from pinning a format.
        let reply = client.postFile(
            body: body, folderId: folderId, idempotencyKey: idempotencyKey)
        return try Self.item(from: reply, folderId: folderId, id: nil)
    }

    func updateDocument(id: String, body: String, ifMatch: String) throws -> WorkspaceServerItem {
        let reply = client.putFile(postId: id, body: body, ifMatch: ifMatch)
        return try Self.item(from: reply, folderId: nil, id: id)
    }

    func moveDocument(
        id: String, toFolder folderId: String, ifMatch: String?
    ) throws -> WorkspaceServerItem {
        let reply = client.patchFile(postId: id, folderId: folderId, slug: nil, ifMatch: ifMatch)
        return try Self.item(from: reply, folderId: folderId, id: id)
    }

    func createFolder(
        parentPath: String, name: String, idempotencyKey: String?
    ) throws -> WorkspaceServerFolder {
        switch client.createFolder(parentPath: parentPath, name: name, idempotencyKey: idempotencyKey) {
        case .success(let folder):
            return WorkspaceServerFolder(
                id: folder.id, name: folder.name, path: folder.path, mode: folder.mode)
        case .failure(let error):
            throw WorkspaceIntentServerError.transport(error.description)
        }
    }

    // MARK: Mapping

    private static func item(
        from reply: Result<SaveReply, ClientFailure>, folderId: String?, id: String?
    ) throws -> WorkspaceServerItem {
        switch reply {
        case .success(.saved(let item)):
            guard let mapped = serverItem(from: item, folderId: folderId) else {
                throw WorkspaceIntentServerError.transport("the server returned an item with no id")
            }
            return mapped
        case .success(.conflict):
            throw WorkspaceIntentServerError.conflict
        case .success(.rejected(let message)):
            throw WorkspaceIntentServerError.rejected(message)
        case .failure(let error):
            throw mapFailure(error, id: id ?? "")
        }
    }

    private static func mapFailure(_ error: ClientFailure, id: String) -> WorkspaceIntentServerError {
        if case .http(let status, _) = error, status == 404 {
            return .notFound(id)
        }
        return .transport(error.description)
    }

    private static func serverItem(
        from item: ManifestItem, folderId: String?
    ) -> WorkspaceServerItem? {
        guard let id = item.id, !id.isEmpty else { return nil }
        return WorkspaceServerItem(
            id: id,
            slug: item.slug,
            title: item.title,
            kind: item.kind,
            status: item.status,
            folderId: folderId,
            folderPath: nil,
            canonicalURL: item.url.flatMap(URL.init(string:)),
            hash: item.hash,
            modifiedDate: parseDate(item.updatedAt ?? item.createdAt ?? item.date)
        )
    }

    private static func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}

/// Builds a credentialed server for the App Intents, or nil when signed out.
/// Registered in `main.swift` before the run loop so it is always in place
/// before an intent runs in-process.
enum WorkspaceIntentServerFactory {
    static func make() -> WorkspaceIntentServer? {
        let store = StateStore()
        guard let credentials = store.loadCredentials() else { return nil }
        let client = ServerClient(
            origin: resolveServerOrigin(credentials: credentials),
            token: credentials.token)
        return ServerBackedWorkspaceIntentServer(client: client)
    }
}
