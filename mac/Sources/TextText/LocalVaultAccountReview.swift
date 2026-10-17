import Foundation
import TextTextFileProviderKit

struct LocalVaultAccountReview {
    let account: LocalVaultAccountCredential
    let binding: LocalVaultSyncBinding
    let email: String

    static func load(account: LocalVaultAccountCredential, binding: LocalVaultSyncBinding, session supplied: URLSession? = nil) async throws -> Self {
        guard let accountId = account.accountId, account.origin == binding.origin else { throw LocalVaultAccountRootOwnership.Failure.account }
        _ = try LocalVaultAccountIdentity.validate(accountId)
        _ = try LocalVaultSyncBinding(origin: binding.origin, workspaceId: binding.workspaceId)
        let session = supplied ?? URLSession(configuration: .ephemeral, delegate: ReviewNoRedirect(), delegateQueue: nil)
        defer { if supplied == nil { session.invalidateAndCancel() } }
        func read(_ suffix: String, limit: Int) async throws -> [String: Any] {
            let url = binding.origin.appendingPathComponent("api/vault/\(binding.workspaceId)/\(suffix)")
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
            request.setValue(accountId, forHTTPHeaderField: "X-TextText-Account")
            let (data, response) = try await session.data(for: request)
            try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse, response.statusCode == 200, response.url == url, data.count <= limit,
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw LocalVaultAccountIdentity.Failure.unverified }
            return object
        }
        let profile = try await read("account", limit: 65536)
        guard profile["accountId"] as? String == accountId,
              let email = profile["email"] as? String, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              email.utf8.count <= 320, email.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            throw LocalVaultAccountIdentity.Failure.unverified
        }
        let manifest = try await read("items", limit: 32 * 1024 * 1024)
        guard manifest["items"] is [[String: Any]] else { throw LocalVaultAccountIdentity.Failure.unverified }
        return Self(account: account, binding: binding, email: email)
    }
}
private final class ReviewNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
