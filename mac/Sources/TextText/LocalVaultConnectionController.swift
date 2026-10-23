import Foundation
import TextTextFileProviderKit

/// App-owned synchronization for the selected folder. One conditional request
/// waits for remote changes; file events trigger uploads. Idle waits never scan
/// or upload the vault, and credentials never enter its state files.
@MainActor
final class LocalVaultConnectionController {
    typealias CredentialsProvider = () -> (origin: URL, token: String)?
    typealias VerifiedCredentialsProvider = () -> LocalVaultAccountCredential?
    typealias MirrorPolicyFactory = (LocalVaultSyncBinding, LocalVaultAccountCredential) throws -> LocalVaultMirrorPolicy
    private static let retryMessage = "Changes are saved on this Mac. The web connection will retry."
    private let requestedWorkspaceId: String?
    private let root: URL
    private let credentials: VerifiedCredentialsProvider
    private let mirrorPolicyFactory: MirrorPolicyFactory?
    private var mirrorPolicy: LocalVaultMirrorPolicy?
    private var connectedAccount: LocalVaultAccountCredential?
    private let session: URLSession
    private var credentialGeneration = 0
    private var connectedCredentialGeneration = 0
    private var remoteVerified = false
    private var engine: LocalVaultSync?
    var collaborationEngine: LocalVaultSync? { engine }
    private var transport: HTTPLocalVaultSyncTransport?
    private var watching: Task<Void, Never>?
    private var running: Task<Void, Never>?
    private var runID: UUID?
    private var runTasks: [UUID: Task<Void, Never>] = [:]
    private let syncPass: (@MainActor (LocalVaultSync) async throws -> LocalVaultSyncReport)?
    private var scheduled: DispatchWorkItem?
    private var rerun = false
    private var syncFailures = 0
    private var scheduleTask: Task<Void, Never>?
    private var scheduledRetry = false
    private var schedulingWait: LocalVaultMirrorScheduleOutcome?
    private var rejectedToken: String?
    private var binding: LocalVaultSyncBinding?
    private var previousBinding: LocalVaultSyncBinding?
    private(set) var message: String?
    private(set) var requiresAccountReview = false
    private var watchFailureIsCurrent = false
    private var hasConflicts = false
    private var connecting = false
    private var stopped = false
    private var connectingTask: Task<Void, Never>?
    private(set) var capabilities: LocalVaultSyncCapabilities?
    private var catalogIssues: [LocalVaultCatalogIssue] = []
    private var onlineReady = false
    private var connectRetry: Task<Void, Never>?
    private var connectFailures = 0
    var onChange: (([String: Any], Bool) -> Void)?

    init(root: URL, workspaceId: String? = nil, session: URLSession = .shared, credentials: @escaping CredentialsProvider = { nil }, verifiedCredentials: VerifiedCredentialsProvider? = nil, mirrorPolicyFactory: MirrorPolicyFactory? = nil, syncPass: (@MainActor (LocalVaultSync) async throws -> LocalVaultSyncReport)? = nil) {
        self.requestedWorkspaceId = workspaceId
        self.root = root; self.credentials = verifiedCredentials ?? { credentials().map { LocalVaultAccountCredential(origin: $0.origin, token: $0.token) } }; self.session = session
        self.mirrorPolicyFactory = mirrorPolicyFactory; self.syncPass = syncPass
        do {
            if let existing = try LocalVaultSync.binding(root: root) {
                previousBinding = existing
                if let account = self.credentials(), account.origin == existing.origin,
                   requestedWorkspaceId == nil || requestedWorkspaceId == existing.workspaceId {
                    capabilities = try? LocalVaultCapabilityCache.read(root: root, binding: existing, accountId: self.credentials()?.accountId)
                    // The saved binding was verified on an earlier connection.
                    // Restore its local journal synchronously so a reopened
                    // editor never races server discovery after a crash.
                    if let portable = try PortableWorkspaceBinding.read(root: root),
                       portable == (try PortableWorkspaceBinding.normalized(existing)) {
                        let transport = try HTTPLocalVaultSyncTransport(origin: existing.origin,
                            workspaceId: existing.workspaceId, token: account.token, session: session, accountId: account.accountId)
                        if let id = account.accountId { try LocalVaultAccountRootOwnership.open(root: root, binding: existing, accountId: id) }
                        let policy = try mirrorPolicyFactory?(existing, account)
                        let engine = try LocalVaultSync(root: root, binding: existing, transport: transport, accountId: account.accountId, mirrorPolicy: policy)
                        self.mirrorPolicy = policy
                        self.binding = existing; self.transport = transport; self.engine = engine; self.connectedAccount = account
                    }
                }
            }
        } catch { capabilities = nil; requiresAccountReview = Self.isAdoptionFailure(error); message = error.localizedDescription }
    }
    deinit { for task in runTasks.values { task.cancel() }; scheduleTask?.cancel(); watching?.cancel(); running?.cancel(); scheduled?.cancel(); connectRetry?.cancel(); connectingTask?.cancel() }
    func stop() {
        stopped = true
        for task in runTasks.values { task.cancel() }
        scheduleTask?.cancel(); scheduleTask = nil
        if let mirrorPolicy { Task { await mirrorPolicy.retire() } }
        connectingTask?.cancel(); connectingTask = nil
        watching?.cancel(); watching = nil
        cancelRun()
        scheduled?.cancel(); scheduled = nil
        connectRetry?.cancel(); connectRetry = nil
        onChange = nil
    }
    static func isAdoptionFailure(_ error: Error) -> Bool {
        if case LocalVaultAccountRootOwnership.Failure.adoption = error { return true }
        return false
    }
    func stopAndWait() async {
        let pending = [connectingTask, watching, connectRetry, scheduleTask].compactMap { $0 } + Array(runTasks.values)
        stop()
        await mirrorPolicy?.retire(); mirrorPolicy = nil
        for task in pending { await task.value }
        engine = nil; transport = nil; binding = nil; capabilities = nil
    }
    func credentialsChanged() {
        credentialGeneration += 1
        if let connectedAccount, credentials().map({ connectedAccount.sameAccount(as: $0) }) != true {
            if let mirrorPolicy { Task { await mirrorPolicy.retire() } }
            mirrorPolicy = nil
            connectingTask?.cancel(); connectingTask = nil
            watching?.cancel(); watching = nil
            cancelRun()
            scheduled?.cancel(); scheduled = nil
            connectRetry?.cancel(); connectRetry = nil
            transport = nil; engine = nil; binding = nil; capabilities = nil
            catalogIssues = []
            onlineReady = false; connecting = false; remoteVerified = false
            message = "Return to the original account to continue this folder's saved work."
            onChange?(status, false)
            return
        }
        if schedulingWait == .authRequired, credentials()?.token == rejectedToken { return }
        cancelRun()
        schedulingWait = nil; rejectedToken = nil; syncFailures = 0; connectFailures = 0
        scheduled?.cancel(); scheduled = nil; scheduledRetry = false
        connectRetry?.cancel(); connectRetry = nil
        connectAutomatically()
    }
    var status: [String: Any] {
        var value: [String: Any] = ["connected": binding != nil, "available": credentials() != nil,
                                    "hasConflicts": hasConflicts, "connecting": connecting,
                                    "onlineReady": onlineReady,
                                    "catalogIssues": catalogIssues.map { ["path": $0.path, "reason": $0.reason] },
                                    "authenticationRequired": schedulingWait == .authRequired,
                                    "requiresRebind": previousBinding != nil && binding == nil, "requiresAccountReview": requiresAccountReview]
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
        guard !stopped, schedulingWait != .authRequired, schedulingWait != .policyUnavailable, !remoteVerified || connectedCredentialGeneration != credentialGeneration,
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
                self.connectFailures = 0
            }
            catch {
                guard !self.stopped else { return }
                self.requiresAccountReview = Self.isAdoptionFailure(error)
                if self.requiresAccountReview {
                    self.message = "Choose Review saved work in the File menu to connect this folder to your account."
                } else if self.credentialGeneration == attemptedGeneration {
                    self.message = "Your workspace is saved on this Mac. Online collaboration is unavailable right now."
                    await self.scheduleConnectRetry(error)
                }
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
    private func park(_ outcome: LocalVaultMirrorScheduleOutcome) {
        schedulingWait = outcome; onlineReady = false; watchFailureIsCurrent = false
        scheduled?.cancel(); scheduled = nil; scheduledRetry = false
        connectRetry?.cancel(); connectRetry = nil
        if outcome == .authRequired {
            rejectedToken = credentials()?.token
            cancelRun()
            watching?.cancel(); watching = nil
            message = "Your TextText sign-in has expired. Sign in again to resume syncing."
        } else if outcome == .policyUnavailable {
            cancelRun()
            watching?.cancel(); watching = nil
            message = "Sync is paused. Restart TextText to reconnect."
        } else if outcome == .storage {
            message = "Sync is paused. Repair the local file or reopen this workspace to retry."
        }
        onChange?(status, false)
    }
    private func schedulingPolicy() throws -> LocalVaultMirrorPolicy {
        if let mirrorPolicy { return mirrorPolicy }
        guard let account = credentials(), let factory = mirrorPolicyFactory else { throw LocalVaultMirrorPolicy.Failure.stale }
        // Discovery can fail before a workspace has been selected. Use the same
        // existing page with a temporary, fenced discovery scope until configure.
        let target = try LocalVaultSyncBinding(origin: account.origin, workspaceId: requestedWorkspaceId ?? "discovery")
        let policy = try factory(target, account); mirrorPolicy = policy
        return policy
    }
    private func decision(_ outcome: LocalVaultMirrorScheduleOutcome, failures: Int,
                          hasMore: Bool = false, rerun: Bool = false) async -> LocalVaultMirrorScheduleDecision? {
        guard !stopped, !Task.isCancelled else { return nil }
        // Stop unauthorized work immediately, including watch/discovery callers
        // whose own task is cancelled by this account fence.
        if outcome == .authRequired { park(outcome); return nil }
        if outcome == .policyUnavailable { park(outcome); return nil }
        do {
            let result = try await schedulingPolicy().schedule(.init(outcome: outcome, consecutiveFailures: failures, hasEligiblePending: hasMore, rerun: rerun))
            guard !stopped, !Task.isCancelled, schedulingWait != .authRequired else { return nil }
            return result
        } catch {
            if !Task.isCancelled { park(.policyUnavailable) }
            return nil
        }
    }
    private func scheduleConnectRetry(_ error: Error) async {
        let outcome = LocalVaultMirrorScheduleOutcome.failure(error)
        guard let next = await decision(outcome, failures: connectFailures) else { return }
        connectFailures = next.consecutiveFailures
        if next.action == "wait-reopen" { park(outcome); return }
        guard next.action == "run" || next.action == "wait-change" else { return }
        connectRetry?.cancel()
        // Permission waits retain a read-only discovery cadence to see regrant.
        let delay = next.delayMs ?? 30_000
        connectRetry = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
            guard !Task.isCancelled else { return }
            self?.connectRetry = nil; self?.connectAutomatically()
        }
    }
    func connect(allowRebind: Bool = false, startSync: Bool = true) async throws -> [String: Any] {
        guard let account = credentials() else { throw LocalVaultConnectionError("Sign in to TextText before connecting this folder to the web.") }
        if let connectedAccount, !connectedAccount.sameAccount(as: account) {
            throw LocalVaultConnectionError("Return to the original account to continue this folder's saved work.")
        }
        if let id = account.accountId { _ = try LocalVaultAccountIdentity.validate(id) }
        // Validate before attaching the token to a URL.
        _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: "discovery")
        let selectedId = requestedWorkspaceId ?? previousBinding.flatMap { $0.origin == account.origin ? $0.workspaceId : nil }
        if let selectedId { _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: selectedId) }
        // Reopen a previously verified local journal before waiting for the
        // server. A pending editor must remain available through a network
        // outage or a slow discovery response after process restart.
        if let existing = try LocalVaultSync.binding(root: root),
           let selectedId, existing.workspaceId == selectedId,
           try PortableWorkspaceBinding.normalized(existing) == PortableWorkspaceBinding.normalized(
               LocalVaultSyncBinding(origin: account.origin, workspaceId: selectedId)) {
            try await configure(existing, account: account, startSync: false)
        }
        let endpoint = selectedId.map { "api/vault/\($0)/items" } ?? "api/vault"
        var request = URLRequest(url: account.origin.appendingPathComponent(endpoint), timeoutInterval: 30)
        request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
        if let id = account.accountId { request.setValue(id, forHTTPHeaderField: "X-TextText-Account") }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard !stopped else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else {
            throw LocalVaultConnectionError("The web connection did not respond. Your files remain saved on this Mac.")
        }
        guard http.statusCode == 200 else { throw LocalVaultSyncFailure.httpStatus(http.statusCode) }
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
        try await configure(binding, account: account, startSync: false)
        if let transport, let engine {
            _ = try await transport.manifest()
            var value = await transport.capabilities()
            value.knownPaths.formUnion(await engine.knownLocalPaths())
            let changed = capabilities != value
            capabilities = value
            try? LocalVaultCapabilityCache.write(value, root: root, binding: binding, accountId: account.accountId)
            if changed { onChange?(status, true) }
        }
        if startSync { activate() }
        onlineReady = false
        previousBinding = binding
        message = nil
        watchFailureIsCurrent = false
        if startSync { schedule() }
        remoteVerified = true
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
        if let id = account.accountId { request.setValue(id, forHTTPHeaderField: "X-TextText-Account") }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard !stopped, let current = credentials(), current.origin == account.origin, current.token == account.token else { throw CancellationError() }
        guard let response = response as? HTTPURLResponse, data.count <= 1_000_000 else { throw LocalVaultSyncFailure.invalidResponse }
        guard response.statusCode == 200 else { throw LocalVaultSyncFailure.httpStatus(response.statusCode) }
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
    private func configure(_ binding: LocalVaultSyncBinding, account: LocalVaultAccountCredential, startSync: Bool) async throws {
        if let connectedAccount, !connectedAccount.sameAccount(as: account) {
            throw LocalVaultConnectionError("Return to the original account to continue this folder's saved work.")
        }
        let token = account.token
        if self.binding == binding, let transport, engine != nil {
            // Keep the actor that owns live file sessions and checkpoints.
            try await transport.updateToken(token, accountId: account.accountId)
            return
        }
        let transport = try HTTPLocalVaultSyncTransport(origin: binding.origin, workspaceId: binding.workspaceId, token: token, session: session, accountId: account.accountId)
        if let id = account.accountId { try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: id) }
        let policy = try mirrorPolicyFactory?(binding, account)
        let engine = try LocalVaultSync(root: root, binding: binding, transport: transport, accountId: account.accountId, mirrorPolicy: policy)
        await mirrorPolicy?.retire(); mirrorPolicy = policy
        self.binding = binding; self.transport = transport; self.engine = engine; self.connectedAccount = account; requiresAccountReview = false
        if startSync { activate() }
    }
    func activate() {
        guard !stopped, schedulingWait != .authRequired, schedulingWait != .policyUnavailable, let transport else { return }
        watching?.cancel()
        let generation = credentialGeneration
        watching = Task { [weak self, transport] in
            var failures = 0
            while !Task.isCancelled {
                do {
                    let changed = try await transport.waitForChange()
                    if Task.isCancelled { break }
                    self?.watchDidSucceed()
                    if changed { self?.schedule() }
                    failures = 0
                } catch {
                    guard !Task.isCancelled, let self, generation == self.credentialGeneration else { break }
                    self.watchDidFail()
                    let outcome = LocalVaultMirrorScheduleOutcome.failure(error)
                    guard let next = await self.decision(outcome, failures: failures) else { break }
                    failures = next.consecutiveFailures
                    if next.action == "wait-reopen" { self.park(outcome); break }
                    guard next.action == "run" || next.action == "wait-change" else { break }
                    // This is a read-only watch, so a denied grant can be observed
                    // again without retrying a denied outbox write.
                    try? await Task.sleep(nanoseconds: UInt64(next.delayMs ?? 30_000) * 1_000_000)
                }
            }
        }
        schedule()
    }
    func schedule() {
        guard !stopped, engine != nil, schedulingWait != .authRequired, schedulingWait != .policyUnavailable else { return }
        if schedulingWait == .storage { schedulingWait = nil }
        if running != nil { rerun = true; return }
        // A file wake cannot shorten the shared policy's transient retry delay.
        if scheduledRetry { rerun = true; return }
        scheduleTask?.cancel()
        scheduleTask = Task { [weak self] in
            guard let self, let next = await self.decision(.success, failures: self.syncFailures, rerun: true) else { return }
            self.install(next, outcome: .success)
        }
    }
    private func install(_ next: LocalVaultMirrorScheduleDecision, outcome: LocalVaultMirrorScheduleOutcome) {
        guard !stopped, schedulingWait != .authRequired, schedulingWait != .policyUnavailable else { return }
        if next.action == "wait-reopen" { park(outcome); return }
        guard next.action == "run", let delay = next.delayMs else { return }
        scheduled?.cancel(); scheduledRetry = outcome == .transient
        let work = DispatchWorkItem { [weak self] in
            self?.scheduled = nil; self?.scheduledRetry = false; self?.run()
        }
        scheduled = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(delay) / 1000, execute: work)
    }
    private func notifyCompletedSync(downloaded: Int, capabilityChanged: Bool) {
        onChange?(status, downloaded > 0 || capabilityChanged)
    }
    private func cancelRun() {
        running?.cancel(); running = nil; runID = nil
    }
    private func run() {
        guard !stopped, schedulingWait != .authRequired, schedulingWait != .policyUnavailable, let engine, running == nil else { return }
        let generation = credentialGeneration, id = UUID()
        runID = id
        let pass = syncPass
        let task = Task { [weak self, engine] in
            defer {
                if let self {
                    self.runTasks.removeValue(forKey: id)
                    if self.runID == id {
                        self.running = nil; self.runID = nil
                        // A file event can arrive while the policy RPC is awaiting
                        // its reply, after this pass captured its earlier rerun flag.
                        if self.rerun && !self.stopped && self.schedulingWait == nil && !self.scheduledRetry { self.schedule() }
                    }
                }
            }
            do {
                let report: LocalVaultSyncReport
                if let pass { report = try await pass(engine) } else { report = try await engine.sync() }
                guard let self, self.runID == id, generation == self.credentialGeneration,
                      !Task.isCancelled, !self.stopped, let currentEngine = self.engine, currentEngine === engine,
                      let current = self.credentials(), let owner = self.connectedAccount,
                      owner.sameAccount(as: current) else { return }
                var capabilityChanged = false
                if let transport = self.transport {
                    var value = await transport.capabilities()
                    value.knownPaths.formUnion(await engine.knownLocalPaths())
                    guard self.runID == id, generation == self.credentialGeneration, !Task.isCancelled, !self.stopped else { return }
                    capabilityChanged = self.capabilities != value
                    self.capabilities = value
                    if let binding = self.binding { try? LocalVaultCapabilityCache.write(value, root: self.root, binding: binding, accountId: owner.accountId) }
                }
                self.catalogIssues = report.catalogIssues
                self.hasConflicts = !report.conflicts.isEmpty
                self.onlineReady = report.errors.isEmpty && report.conflicts.isEmpty
                if !report.conflicts.isEmpty { self.recordSyncMessage("Conflicting edits were kept in this folder's recovery copies.") }
                else { self.recordSyncMessage(report.errors.first) }
                self.notifyCompletedSync(downloaded: report.downloaded, capabilityChanged: capabilityChanged)
                let outcome: LocalVaultMirrorScheduleOutcome = report.failureOutcomes.contains(.storage) ? .storage :
                    report.failureOutcomes.contains(.policyUnavailable) ? .policyUnavailable :
                    report.failureOutcomes.contains(.transient) ? .transient :
                    report.failureOutcomes.first ?? .success
                let rerun = self.rerun; self.rerun = false
                guard let next = await self.decision(outcome, failures: self.syncFailures, hasMore: report.hasMore, rerun: rerun) else { return }
                guard self.runID == id, generation == self.credentialGeneration else { return }
                self.syncFailures = next.consecutiveFailures
                self.install(next, outcome: outcome)
            } catch {
                guard let self, self.runID == id, generation == self.credentialGeneration,
                      !Task.isCancelled, !self.stopped else { return }
                self.onlineReady = false
                self.recordSyncMessage(Self.retryMessage)
                self.onChange?(self.status, false)
                let outcome = LocalVaultMirrorScheduleOutcome.failure(error)
                guard let next = await self.decision(outcome, failures: self.syncFailures),
                      self.runID == id, generation == self.credentialGeneration else { return }
                self.syncFailures = next.consecutiveFailures
                self.install(next, outcome: outcome)
            }
        }
        running = task; runTasks[id] = task
    }
}
private struct LocalVaultConnectionError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
