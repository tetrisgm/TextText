import Foundation
import TextTextFileProviderKit

/// App-owned synchronization for the selected folder. One conditional request
/// waits for remote changes; file events trigger uploads. Idle waits never scan
/// or upload the vault, and credentials never enter its state files.
@MainActor
final class LocalVaultConnectionController {
    typealias CredentialsProvider = () -> (origin: URL, token: String)?
    private static let retryMessage = "Changes are saved on this Mac. The web connection will retry."
    private let requestedWorkspaceId: String?
    private let root: URL
    private let credentials: CredentialsProvider
    private let session: URLSession
    private var credentialGeneration = 0
    private var connectedCredentialGeneration = 0
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
    private var connecting = false
    private var stopped = false
    private var connectingTask: Task<Void, Never>?
    private(set) var capabilities: LocalVaultSyncCapabilities?
    private var onlineReady = false
    private var connectRetry: Task<Void, Never>?
    private var connectDelay: UInt64 = 2
    var onChange: (([String: Any], Bool) -> Void)?

    init(root: URL, workspaceId: String? = nil, session: URLSession = .shared, credentials: @escaping CredentialsProvider) {
        self.requestedWorkspaceId = workspaceId
        self.root = root; self.credentials = credentials; self.session = session
        do {
            if let existing = try LocalVaultSync.binding(root: root) {
                previousBinding = existing
                if let account = credentials(), account.origin == existing.origin {
                    capabilities = try? LocalVaultCapabilityCache.read(root: root, binding: existing)
                }
            }
        } catch { message = error.localizedDescription }
    }
    deinit { watching?.cancel(); running?.cancel(); scheduled?.cancel(); connectRetry?.cancel(); connectingTask?.cancel() }
    func stop() {
        stopped = true
        connectingTask?.cancel(); connectingTask = nil
        watching?.cancel(); watching = nil
        running?.cancel(); running = nil
        scheduled?.cancel(); scheduled = nil
        connectRetry?.cancel(); connectRetry = nil
        onChange = nil
    }
    func credentialsChanged() {
        credentialGeneration += 1
        connectAutomatically()
    }
    var status: [String: Any] {
        var value: [String: Any] = ["connected": binding != nil, "available": credentials() != nil,
                                    "hasConflicts": hasConflicts, "connecting": connecting,
                                    "onlineReady": onlineReady,
                                    "requiresRebind": previousBinding != nil && binding == nil]
        if let binding {
            value["workspaceId"] = binding.workspaceId
            value["webURL"] = binding.origin.appendingPathComponent("vault/\(binding.workspaceId)").absoluteString
        }
        if let message { value["message"] = message }
        return value
    }
    /// An authenticated folder is the workspace. Attach it without a separate setup step.
    /// Only an old loopback test journal may migrate automatically; another real
    /// server may represent a different account and needs explicit review.
    func connectAutomatically() {
        guard !stopped, binding == nil || connectedCredentialGeneration != credentialGeneration,
              !connecting, credentials() != nil else { return }
        if let previousBinding, !Self.isLoopback(previousBinding.origin),
           let account = credentials(), previousBinding.origin != account.origin {
            message = "This workspace was connected to another account. Its files are safe on this Mac."
            onChange?(status, false)
            return
        }
        connecting = true
        let attemptedGeneration = credentialGeneration
        onChange?(status, false)
        connectingTask = Task { [weak self] in
            guard let self else { return }
            do {
                let mayMigrateLegacy = self.previousBinding.map { Self.isLoopback($0.origin) } == true
                _ = try await self.connect(allowRebind: mayMigrateLegacy)
                self.connectedCredentialGeneration = attemptedGeneration
                self.connectRetry?.cancel()
                self.connectRetry = nil
                self.connectDelay = 2
            }
            catch {
                guard !self.stopped else { return }
                self.message = "Your workspace is saved on this Mac. Online collaboration is unavailable right now."
                self.scheduleConnectRetry()
            }
            self.connecting = false
            self.connectingTask = nil
            self.onChange?(self.status, false)
            if self.credentialGeneration != attemptedGeneration { self.connectAutomatically() }
        }
    }
    private static func isLoopback(_ origin: URL) -> Bool {
        ["localhost", "127.0.0.1", "::1"].contains(origin.host ?? "")
    }
    private func scheduleConnectRetry() {
        guard !stopped else { return }
        connectRetry?.cancel()
        let delay = connectDelay
        connectDelay = min(connectDelay * 2, 60)
        connectRetry = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            guard !Task.isCancelled else { return }
            self?.connectRetry = nil
            self?.connectAutomatically()
        }
    }
    func connect(allowRebind: Bool = false, startSync: Bool = true) async throws -> [String: Any] {
        guard let account = credentials() else { throw LocalVaultConnectionError("Sign in to TextText before connecting this folder to the web.") }
        // Validate before attaching the token to a URL.
        _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: "discovery")
        let selectedId = requestedWorkspaceId ?? previousBinding.flatMap { $0.origin == account.origin ? $0.workspaceId : nil }
        if let selectedId { _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: selectedId) }
        let endpoint = selectedId.map { "api/vault/\($0)/items" } ?? "api/vault"
        var request = URLRequest(url: account.origin.appendingPathComponent(endpoint), timeoutInterval: 30)
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard !stopped else { throw CancellationError() }
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
        let workspaceId = try selectedId ?? JSONDecoder().decode(Workspace.self, from: data).workspaceId
        guard let latest = credentials(), latest.origin == account.origin, latest.token == account.token else {
            throw CancellationError()
        }
        let binding = try LocalVaultSyncBinding(origin: account.origin, workspaceId: workspaceId)
        if let portable = try PortableWorkspaceBinding.read(root: root), portable != (try PortableWorkspaceBinding.normalized(binding)) {
            throw LocalVaultSyncFailure.invalidBinding
        }
        if let previous = try LocalVaultSync.binding(root: root), previous != binding {
            guard allowRebind else {
                throw LocalVaultConnectionError("This folder has sync history from a different server. Confirm the new connection to preserve its old history before continuing.")
            }
            try LocalVaultSync.archiveAndRebind(root: root, to: binding)
        }
        try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
        try await configure(binding, token: account.token, startSync: false)
        if let transport, let engine {
            _ = try await transport.manifest()
            var value = await transport.capabilities()
            value.knownPaths.formUnion(await engine.knownLocalPaths())
            let changed = capabilities != value
            capabilities = value
            try? LocalVaultCapabilityCache.write(value, root: root, binding: binding)
            if changed { onChange?(status, true) }
        }
        if startSync { activate() }
        onlineReady = false
        previousBinding = binding
        message = nil
        watchFailureIsCurrent = false
        if startSync { schedule() }
        return status
    }
    struct AvailableWorkspace: Decodable {
        let id: String
        let name: String
        let access: String
        var dictionary: [String: Any] { ["id": id, "name": name, "access": access] }
    }
    func availableWorkspaces() async throws -> [AvailableWorkspace] {
        guard let account = credentials() else { throw LocalVaultSyncFailure.httpStatus(401) }
        _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: "discovery")
        var request = URLRequest(url: account.origin.appendingPathComponent("api/vault/workspaces"), timeoutInterval: 30)
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard !stopped, let current = credentials(), current.origin == account.origin, current.token == account.token else { throw CancellationError() }
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, data.count <= 1_000_000 else { throw LocalVaultSyncFailure.invalidResponse }
        struct Discovery: Decodable { let workspaces: [AvailableWorkspace] }
        let workspaces = try JSONDecoder().decode(Discovery.self, from: data).workspaces
        guard workspaces.count <= 1000, Set(workspaces.map(\.id)).count == workspaces.count else { throw LocalVaultSyncFailure.invalidResponse }
        for workspace in workspaces {
            _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: workspace.id)
            guard ["owner", "workspace", "scoped"].contains(workspace.access), workspace.name.count <= 1000 else { throw LocalVaultSyncFailure.invalidResponse }
        }
        return workspaces
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
    private func configure(_ binding: LocalVaultSyncBinding, token: String, startSync: Bool) async throws {
        if self.binding == binding, let transport, engine != nil {
            // Keep the actor that owns live file sessions and checkpoints.
            await transport.updateToken(token)
            return
        }
        let transport = try HTTPLocalVaultSyncTransport(origin: binding.origin, workspaceId: binding.workspaceId, token: token, session: session)
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport)
        self.binding = binding; self.transport = transport; self.engine = engine
        if startSync { activate() }
    }
    func activate() {
        guard !stopped, let transport else { return }
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
        guard !stopped, engine != nil else { return }
        if running != nil { rerun = true; return }
        scheduled?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.run() }
        scheduled = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }
    private func retry() {
        guard !stopped else { return }
        scheduled?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.run() }
        scheduled = work
        DispatchQueue.main.asyncAfter(deadline: .now() + retryDelay, execute: work)
        retryDelay = min(retryDelay * 2, 60)
    }
    private func notifyCompletedSync(downloaded: Int, capabilityChanged: Bool) {
        onChange?(status, downloaded > 0 || capabilityChanged)
    }
    private func run() {
        guard !stopped, let engine, running == nil else { return }
        running = Task { [weak self, engine] in
            do {
                let report = try await engine.sync()
                guard let self else { return }
                var capabilityChanged = false
                if let transport = self.transport {
                    var value = await transport.capabilities()
                    value.knownPaths.formUnion(await engine.knownLocalPaths())
                    capabilityChanged = self.capabilities != value
                    self.capabilities = value
                    if let binding = self.binding { try? LocalVaultCapabilityCache.write(value, root: self.root, binding: binding) }
                }
                self.hasConflicts = !report.conflicts.isEmpty
                self.onlineReady = report.errors.isEmpty && report.conflicts.isEmpty
                if !report.conflicts.isEmpty { self.recordSyncMessage("Conflicting edits were kept in this folder's recovery copies.") }
                else { self.recordSyncMessage(report.errors.first) }
                self.notifyCompletedSync(downloaded: report.downloaded, capabilityChanged: capabilityChanged)
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
                self.onlineReady = false
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
