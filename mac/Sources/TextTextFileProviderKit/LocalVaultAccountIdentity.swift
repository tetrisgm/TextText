import Foundation

/// A stable, nonsecret actor verified by the linked credential. A cache belongs
/// to that exact credential record; callers must not copy it to a replacement.
public enum LocalVaultAccountIdentity {
    public static func validate(_ value: String) throws -> String {
        guard value.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\z", options: .regularExpression) != nil else {
            throw Failure.unverified
        }
        return value
    }
    public enum Failure: Error, LocalizedError {
        case unverified
        public var errorDescription: String? { "Reconnect to verify this account. Saved work is unchanged." }
    }
    public static func resolve(origin: URL, cachedAccountId: String?, fetch: (String) throws -> Data) throws -> String {
        let loopback = ["localhost", "127.0.0.1", "::1"].contains(origin.host ?? "")
        guard origin.scheme == "https" || (origin.scheme == "http" && loopback), origin.host != nil, origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil, origin.path.isEmpty || origin.path == "/" else { throw Failure.unverified }
        if let cachedAccountId { return try validate(cachedAccountId) }
        func read(_ path: String) throws -> [String: Any] {
            let data = try fetch(path)
            guard data.count <= 65536, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.unverified }
            return object
        }
        let home = try read("/api/vault")
        if let direct = home["accountId"] {
            guard let value = direct as? String else { throw Failure.unverified }
            return try validate(value)
        }
        guard let workspace = home["workspaceId"] as? String, UUID(uuidString: workspace) != nil else { throw Failure.unverified }
        let profile = try read("/api/vault/" + workspace + "/account")
        guard let value = profile["accountId"] as? String else { throw Failure.unverified }
        return try validate(value)
    }
}
