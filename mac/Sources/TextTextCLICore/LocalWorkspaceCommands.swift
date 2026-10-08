import Foundation
import TextTextFileProviderKit

private final class CLICommandNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

/// Account commands are an optional capability of a local workspace, not a
/// replacement for its file store. Resolve authority again for every command.
final class LocalWorkspaceCommands: @unchecked Sendable {
    private let root: URL
    private let environment: [String: String]
    private let session: URLSession
    init(root: URL, environment: [String: String], session: URLSession? = nil) {
        self.root = root
        self.environment = environment
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 40
        self.session = session ?? URLSession(configuration: configuration, delegate: CLICommandNoRedirect(), delegateQueue: nil)
    }
    func authorizedStore() async throws -> RemoteDocumentStore {
        guard let binding = try PortableWorkspaceBinding.read(root: root),
              let credentials = DeviceCredentials.load(environment: environment),
              let origin = credentials.validatedServerOrigin else {
            throw TextTextCLIError.workspaceUnavailable("this folder has no signed-in account connection")
        }
        let candidate = try PortableWorkspaceBinding.normalized(LocalVaultSyncBinding(origin: origin, workspaceId: binding.workspaceId))
        guard candidate == binding else {
            throw TextTextCLIError.workspaceUnavailable("this folder belongs to a different TextText server")
        }
        var request = URLRequest(url: candidate.origin.appendingPathComponent("api/vault"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch { throw TextTextCLIError.workspaceUnavailable("the account connection could not be verified") }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              data.count <= 65_536 else {
            throw TextTextCLIError.workspaceUnavailable("the account connection could not be verified")
        }
        struct Account: Decodable { let workspaceId: String }
        guard let account = try? JSONDecoder().decode(Account.self, from: data),
              account.workspaceId == binding.workspaceId,
              try PortableWorkspaceBinding.read(root: root) == binding,
              let latest = DeviceCredentials.load(environment: environment),
              latest.token == credentials.token, latest.serverOrigin == credentials.serverOrigin else {
            throw TextTextCLIError.workspaceUnavailable("the signed-in account does not match this folder")
        }
        return RemoteDocumentStore(api: LiveTextTextSyncAPI(origin: candidate.origin, token: credentials.token, session: session))
    }
}
