import Foundation
import TextTextFileProviderKit

/// App-owned synchronization for the selected folder. One conditional request
/// waits for remote changes; file events trigger uploads. Idle waits never scan
/// or upload the vault, and credentials never enter its state files.
@MainActor
final class LocalVaultConnectionController {
    typealias CredentialsProvider = () -> (origin: URL, token: String)?
    private let root: URL
    private let credentials: CredentialsProvider
    private var engine: LocalVaultSync?
    var collaborationEngine: LocalVaultSync? { engine }
    private var transport: HTTPLocalVaultSyncTransport?
    private var watching: Task<Void, Never>?
    private var running: Task<Void, Never>?
    private var scheduled: DispatchWorkItem?
    private var rerun = false
    private var retryDelay: TimeInterval = 2
    private var binding: LocalVaultSyncBinding?
    private(set) var message: String?
    private var hasConflicts = false
    var onChange: (([String: Any], Bool) -> Void)?

    init(root: URL, credentials: @escaping CredentialsProvider) {
        self.root = root; self.credentials = credentials
        do {
            if let existing = try LocalVaultSync.binding(root: root) {
                guard let account = credentials(), Self.sameOrigin(existing.origin, account.origin) else {
                    message = "Sign in to the account connected to this folder to resume synchronization."; return
                }
                try configure(existing, token: account.token)
            }
        } catch { message = error.localizedDescription }
    }
    deinit { watching?.cancel(); running?.cancel(); scheduled?.cancel() }
    private static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        a.scheme == b.scheme && a.host == b.host && a.port == b.port
    }
    var status: [String: Any] {
        var value: [String: Any] = ["connected": binding != nil, "available": credentials() != nil, "hasConflicts": hasConflicts]
        if let binding {
            value["workspaceId"] = binding.workspaceId
            value["webURL"] = binding.origin.appendingPathComponent("vault/\(binding.workspaceId)").absoluteString
        }
        if let message { value["message"] = message }
        return value
    }
    func connect() async throws -> [String: Any] {
        guard let account = credentials() else { throw LocalVaultConnectionError("Sign in to TextText before connecting this folder to the web.") }
        // Validate before attaching the token to a URL.
        _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: "discovery")
        var request = URLRequest(url: account.origin.appendingPathComponent("api/vault"), timeoutInterval: 30)
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw LocalVaultConnectionError("The server could not connect this folder. Your files remain saved on this Mac.")
        }
        struct Workspace: Decodable { let workspaceId: String }
        let workspace = try JSONDecoder().decode(Workspace.self, from: data)
        let binding = try LocalVaultSyncBinding(origin: account.origin, workspaceId: workspace.workspaceId)
        try configure(binding, token: account.token)
        message = nil
        schedule()
        return status
    }
    private func configure(_ binding: LocalVaultSyncBinding, token: String) throws {
        let transport = try HTTPLocalVaultSyncTransport(origin: binding.origin, workspaceId: binding.workspaceId, token: token)
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        self.binding = binding; self.transport = transport; self.engine = engine
        watching?.cancel()
        watching = Task { [weak self, transport] in
            var backoff: UInt64 = 2
            while !Task.isCancelled {
                do {
                    if try await transport.waitForChange() { self?.schedule() }
                    backoff = 2
                } catch {
                    if Task.isCancelled { break }
                    self?.message = "Changes are saved on this Mac. The web connection will retry."
                    if let self { self.onChange?(self.status, false) }
                    try? await Task.sleep(nanoseconds: backoff * 1_000_000_000)
                    backoff = min(backoff * 2, 60)
                }
            }
        }
        schedule()
    }
    func schedule() {
        guard engine != nil else { return }
        if running != nil { rerun = true; return }
        scheduled?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.run() }
        scheduled = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }
    private func retry() {
        scheduled?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.run() }
        scheduled = work
        DispatchQueue.main.asyncAfter(deadline: .now() + retryDelay, execute: work)
        retryDelay = min(retryDelay * 2, 60)
    }
    private func run() {
        guard let engine, running == nil else { return }
        running = Task { [weak self, engine] in
            do {
                let report = try await engine.sync()
                guard let self else { return }
                self.hasConflicts = !report.conflicts.isEmpty
                if !report.conflicts.isEmpty { self.message = "Conflicting edits were kept in this folder's recovery copies." }
                else { self.message = report.errors.first }
                self.onChange?(self.status, report.downloaded > 0)
                self.running = nil
                if !report.errors.isEmpty { self.retry(); return }
                self.retryDelay = 2
                if report.hasMore || self.rerun {
                    self.rerun = false
                    // A failed outbox must not cause a tight retry/upload loop.
                    if report.errors.isEmpty { self.schedule() }
                }
            } catch {
                guard let self else { return }
                self.message = "Changes are saved on this Mac. The web connection will retry."
                self.onChange?(self.status, false); self.running = nil
                self.retry()
            }
        }
    }
}
private struct LocalVaultConnectionError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
