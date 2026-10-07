import Foundation
import TextTextFileProviderKit

/// App-owned synchronization for the selected folder. One conditional request
/// waits for remote changes; file events trigger uploads. Idle waits never scan
/// or upload the vault, and credentials never enter its state files.
@MainActor
final class LocalVaultConnectionController {
    typealias CredentialsProvider = () -> (origin: URL, token: String)?
    private static let retryMessage = "Changes are saved on this Mac. The web connection will retry."
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
    private var previousBinding: LocalVaultSyncBinding?
    private(set) var message: String?
    private var watchFailureIsCurrent = false
    private var hasConflicts = false
    var onChange: (([String: Any], Bool) -> Void)?

    init(root: URL, credentials: @escaping CredentialsProvider) {
        self.root = root; self.credentials = credentials
        do {
            if let existing = try LocalVaultSync.binding(root: root) {
                previousBinding = existing
                guard let account = credentials() else {
                    message = "Sign in to resume this folder's web connection."; return
                }
                guard Self.sameOrigin(existing.origin, account.origin) else {
                    message = "This folder is linked to a different TextText server. Your files remain available here."; return
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
        var value: [String: Any] = ["connected": binding != nil, "available": credentials() != nil,
                                    "hasConflicts": hasConflicts, "requiresRebind": previousBinding != nil && binding == nil]
        if let binding {
            value["workspaceId"] = binding.workspaceId
            value["webURL"] = binding.origin.appendingPathComponent("vault/\(binding.workspaceId)").absoluteString
        }
        if let message { value["message"] = message }
        return value
    }
    func connect(allowRebind: Bool = false) async throws -> [String: Any] {
        guard let account = credentials() else { throw LocalVaultConnectionError("Sign in to TextText before connecting this folder to the web.") }
        // Validate before attaching the token to a URL.
        _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: "discovery")
        var request = URLRequest(url: account.origin.appendingPathComponent("api/vault"), timeoutInterval: 30)
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw LocalVaultConnectionError("The web connection did not respond. Your files remain saved on this Mac.")
        }
        switch http.statusCode {
        case 200: break
        case 401, 403:
            throw LocalVaultConnectionError("Your TextText sign-in has expired. Sign in again to connect this folder.")
        case 503:
            throw LocalVaultConnectionError("Web sync is not configured on the TextText server yet. Your files remain saved on this Mac.")
        default:
            throw LocalVaultConnectionError("The server could not connect this folder. Your files remain saved on this Mac.")
        }
        struct Workspace: Decodable { let workspaceId: String }
        let workspace = try JSONDecoder().decode(Workspace.self, from: data)
        let binding = try LocalVaultSyncBinding(origin: account.origin, workspaceId: workspace.workspaceId)
        if let previous = try LocalVaultSync.binding(root: root), previous != binding {
            guard allowRebind else {
                throw LocalVaultConnectionError("This folder has sync history from a different server. Confirm the new connection to preserve its old history before continuing.")
            }
            try LocalVaultSync.archiveAndRebind(root: root, to: binding)
        }
        try configure(binding, token: account.token)
        previousBinding = binding
        message = nil
        watchFailureIsCurrent = false
        schedule()
        return status
    }
    func watchDidSucceed() {
        guard watchFailureIsCurrent else { return }
        watchFailureIsCurrent = false
        message = nil
        onChange?(status, false)
    }
    func watchDidFail() {
        // A sync or conflict error remains the more specific status.
        guard !watchFailureIsCurrent, message == nil else { return }
        message = Self.retryMessage
        watchFailureIsCurrent = true
        onChange?(status, false)
    }
    func recordSyncMessage(_ value: String?) {
        watchFailureIsCurrent = false
        message = value
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
                    let changed = try await transport.waitForChange()
                    if Task.isCancelled { break }
                    self?.watchDidSucceed()
                    if changed { self?.schedule() }
                    backoff = 2
                } catch {
                    if Task.isCancelled { break }
                    self?.watchDidFail()
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
                if !report.conflicts.isEmpty { self.recordSyncMessage("Conflicting edits were kept in this folder's recovery copies.") }
                else { self.recordSyncMessage(report.errors.first) }
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
                self.recordSyncMessage(Self.retryMessage)
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
