import Foundation

public protocol NativeWorkspaceCommandServer {
    func command(_ name: String, args: [String: Any]) throws -> [String: Any]
}

public enum NativeWorkspaceCommandRegistry {
    public static var makeServer: () -> NativeWorkspaceCommandServer? = { nil }
    public static var openURL: @MainActor (URL) -> Bool = { _ in false }
}

/// The four automation actions share the same command executor as the UI.
public struct NativeItemActions {
    private let server: NativeWorkspaceCommandServer
    public init(server: NativeWorkspaceCommandServer? = nil) throws {
        guard let resolved = server ?? NativeWorkspaceCommandRegistry.makeServer() else {
            throw WorkspaceIntentError.notSignedIn
        }
        self.server = resolved
    }
    public func create(title: String, body: String, folder: String) throws -> WorkspaceDocumentRecord {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WorkspaceIntentError.emptyTitle }
        var args: [String: Any] = ["title": title, "body": body, "kind": "note", "idempotency_key": UUID().uuidString]
        if !folder.isEmpty { args["folder_path"] = folder }
        return try item(server.command("create_item", args: args))
    }
    public func append(id: String, text: String) throws -> WorkspaceDocumentRecord {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WorkspaceIntentError.emptyText }
        let read = try server.command("read_item", args: ["id": id])
        guard let value = read["item"] as? [String: Any], let hash = value["hash"] as? String, !hash.isEmpty else {
            throw WorkspaceIntentServerError.transport("The item has no version")
        }
        return try item(server.command("append_to_item", args: ["id": id, "markdown": text,
            "if_match_hash": hash, "idempotency_key": UUID().uuidString]))
    }
    public func search(query: String, limit: Int) throws -> [WorkspaceDocumentRecord] {
        let result = try server.command("search", args: ["query": query, "limit": min(50, max(1, limit))])
        guard let values = result["results"] as? [[String: Any]] else {
            throw WorkspaceIntentServerError.transport("Invalid search response")
        }
        return try values.map(record)
    }
    public func read(id: String) throws -> WorkspaceDocumentRecord {
        try item(server.command("read_item", args: ["id": id]))
    }
    public func open(id: String) throws -> URL {
        // Resolve access afresh before handing anything to Launch Services.
        try item(server.command("read_item", args: ["id": id])).deepLink
    }
    private func item(_ result: [String: Any]) throws -> WorkspaceDocumentRecord {
        guard let value = result["item"] as? [String: Any] else { throw WorkspaceIntentServerError.transport("Invalid item response") }
        return try record(value)
    }
    private func record(_ value: [String: Any]) throws -> WorkspaceDocumentRecord {
        guard let id = value["id"] as? String, !id.isEmpty,
              let title = value["title"] as? String else { throw WorkspaceIntentServerError.transport("Invalid item response") }
        return WorkspaceDocumentRecord(id: id, title: title, kind: value["kind"] as? String ?? "note",
            folderPath: value["folder_path"] as? String ?? "", relativePath: "", modifiedDate: nil,
            status: value["status"] as? String, publishedURL: nil)
    }
}
