import Foundation

public struct LocalVaultMirrorObservation: Codable, Equatable, Sendable {
    public let localHash: String, baselineHash: String, remoteRevision: String, baselineRevision: String
    public let refresh: Bool
    public init(localHash: String, baselineHash: String, remoteRevision: String, baselineRevision: String, refresh: Bool) {
        self.localHash = localHash; self.baselineHash = baselineHash
        self.remoteRevision = remoteRevision; self.baselineRevision = baselineRevision; self.refresh = refresh
    }
}
public struct LocalVaultMirrorScope: Codable, Equatable, Sendable {
    public let accountId: String, workspaceId: String, lifecycle: String
    public init(accountId: String, workspaceId: String, lifecycle: String) {
        self.accountId = accountId; self.workspaceId = workspaceId; self.lifecycle = lifecycle
    }
}
public enum LocalVaultMirrorDisposition: String, Codable, Sendable { case upload, pull, idle }

public enum LocalVaultMirrorScheduleOutcome: String, Codable, Sendable {
    case success, transient, permission, conflict, storage, stopped
    case authRequired = "auth-required", policyUnavailable = "policy-unavailable"
    public static func failure(_ error: Error) -> Self {
        if error is LocalVaultMirrorPolicy.Failure { return .policyUnavailable }
        if let failure = error as? LocalVaultSyncFailure {
            switch failure {
            case .httpStatus(401): return .authRequired
            case .httpStatus(403), .httpStatus(404): return .permission
            case .conflict: return .conflict
            case .changed, .busy: return .transient
            case .httpStatus(let status) where status == 408 || status == 429 || status >= 500: return .transient
            default: return .storage
            }
        }
        if error is URLError || error is CancellationError { return .transient }
        return .storage
    }
}
public struct LocalVaultMirrorScheduleObservation: Codable, Equatable, Sendable {
    public let outcome: LocalVaultMirrorScheduleOutcome
    public let consecutiveFailures: Int, hasEligiblePending: Bool, rerun: Bool
    public init(outcome: LocalVaultMirrorScheduleOutcome, consecutiveFailures: Int, hasEligiblePending: Bool = false, rerun: Bool = false) {
        self.outcome = outcome; self.consecutiveFailures = consecutiveFailures
        self.hasEligiblePending = hasEligiblePending; self.rerun = rerun
    }
}
public struct LocalVaultMirrorScheduleDecision: Codable, Equatable, Sendable {
    public let action: String, delayMs: Int?, consecutiveFailures: Int
}

public struct LocalVaultMirrorLifecycleObservation: Codable, Equatable, Sendable {
    public let remotePresent: Bool, remoteDeleted: Bool
    public let remoteLifecycle: String?, remoteRevision: String?
    public let editorOwned: Bool
    public let baselineLifecycle: String?, baselineRevision: String?, pendingKind: String?, pendingLifecycle: String?, pendingBaseRevision: String?
    public let pendingConflicted: Bool
    public init(remotePresent: Bool, remoteDeleted: Bool, remoteLifecycle: String?, remoteRevision: String?, editorOwned: Bool,
                baselineLifecycle: String?, baselineRevision: String?, pendingKind: String?, pendingLifecycle: String?, pendingBaseRevision: String?, pendingConflicted: Bool) {
        self.remotePresent = remotePresent; self.remoteDeleted = remoteDeleted; self.remoteLifecycle = remoteLifecycle; self.remoteRevision = remoteRevision
        self.editorOwned = editorOwned; self.baselineLifecycle = baselineLifecycle; self.baselineRevision = baselineRevision
        self.pendingKind = pendingKind; self.pendingLifecycle = pendingLifecycle; self.pendingBaseRevision = pendingBaseRevision; self.pendingConflicted = pendingConflicted
    }
    private enum CodingKeys: String, CodingKey { case remotePresent, remoteDeleted, remoteLifecycle, remoteRevision, editorOwned, baselineLifecycle, baselineRevision, pendingKind, pendingLifecycle, pendingBaseRevision, pendingConflicted }
    // The shared contract distinguishes an explicit null from a missing field.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(remotePresent, forKey: .remotePresent); try c.encode(remoteDeleted, forKey: .remoteDeleted)
        try c.encode(remoteLifecycle, forKey: .remoteLifecycle); try c.encode(remoteRevision, forKey: .remoteRevision)
        try c.encode(editorOwned, forKey: .editorOwned); try c.encode(baselineLifecycle, forKey: .baselineLifecycle)
        try c.encode(baselineRevision, forKey: .baselineRevision); try c.encode(pendingKind, forKey: .pendingKind)
        try c.encode(pendingLifecycle, forKey: .pendingLifecycle); try c.encode(pendingBaseRevision, forKey: .pendingBaseRevision)
        try c.encode(pendingConflicted, forKey: .pendingConflicted)
    }
}
public struct LocalVaultMirrorLifecycleDecision: Codable, Equatable, Sendable {
    public let baseline: String, pending: String
}

/// Validates the existing page's pure policy RPC. This contains no mirror algorithm.
public actor LocalVaultMirrorPolicy {
    public typealias Evaluate = @Sendable (String) async throws -> String
    private let digest: String, scope: LocalVaultMirrorScope, evaluate: Evaluate
    private let timeoutNanoseconds: UInt64
    private var pageId: String?, retired = false
    private var generation: Int?
    private var acquired = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private func acquire() async {
        if !acquired { acquired = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { acquired = false } else { waiters.removeFirst().resume() }
    }
    private struct Pending {
        let continuation: CheckedContinuation<String, Error>
        let operation: Task<Void, Never>, timer: Task<Void, Never>
    }
    private var pending: [UUID: Pending] = [:]
    public enum Failure: Error { case stale, timeout }
    private struct Identity: Decodable { let version: Int, digest: String, pageId: String, generation: Int }
    private struct BindRequest: Encodable { let scope: LocalVaultMirrorScope, generation: Int }
    private struct Binding: Decodable { let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope }
    private struct Request<Observation: Encodable>: Encodable {
        let version = 1
        let digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String, observed: Observation
    }
    private struct Reply: Decodable {
        let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String
        let observed: LocalVaultMirrorObservation, disposition: LocalVaultMirrorDisposition
    }
    private struct ScheduleReply: Decodable {
        let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String
        let observed: LocalVaultMirrorScheduleObservation, decision: LocalVaultMirrorScheduleDecision
    }
    private struct LifecycleReply: Decodable {
        let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String
        let observed: LocalVaultMirrorLifecycleObservation, decision: LocalVaultMirrorLifecycleDecision
    }
    public init(digest: String, scope: LocalVaultMirrorScope, timeoutNanoseconds: UInt64 = 5_000_000_000, evaluate: @escaping Evaluate) {
        self.digest = digest; self.scope = scope; self.evaluate = evaluate; self.timeoutNanoseconds = timeoutNanoseconds
    }
    public func retire() {
        retired = true
        for id in Array(pending.keys) { finish(id, .failure(Failure.stale)) }
    }
    private func finish(_ id: UUID, _ result: Result<String, Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.operation.cancel(); request.timer.cancel(); request.continuation.resume(with: result)
    }
    private func expire(_ id: UUID) {
        guard pending[id] != nil else { return }
        retired = true; finish(id, .failure(Failure.timeout))
    }
    private func call<T: Decodable>(_ method: String, _ argument: String = "", as: T.Type) async throws -> T {
        try Task.checkCancellation(); guard !retired else { throw Failure.stale }
        let id = UUID(), script = "window.texttextMirrorPolicy.\(method)(\(argument))"
        let raw: String = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let operation = Task {
                    do { let value = try await evaluate(script); finish(id, .success(value)) }
                    catch { finish(id, .failure(error is CancellationError || error is Failure ? error : Failure.stale)) }
                }
                let timer = Task {
                    do { try await Task.sleep(nanoseconds: timeoutNanoseconds); expire(id) } catch {}
                }
                pending[id] = Pending(continuation: continuation, operation: operation, timer: timer)
            }
        } onCancel: { Task { await self.finish(id, .failure(CancellationError())) } }
        try Task.checkCancellation(); guard !retired else { throw Failure.stale }
        do { return try JSONDecoder().decode(T.self, from: Data(raw.utf8)) }
        catch { throw Failure.stale }
    }
    private func check(_ version: Int, _ digest: String, _ page: String, _ generation: Int) throws {
        guard version == 1, digest == self.digest, page == pageId,
            self.generation == nil || generation == self.generation else { throw Failure.stale }
    }
    public func ready() async throws {
        await acquire(); defer { release() }
        try await prepare()
    }
    private func prepare() async throws {
        let hello = try await call("handshake", as: Identity.self)
        guard !hello.pageId.isEmpty else { throw Failure.stale }
        if pageId == nil { pageId = hello.pageId }
        try check(hello.version, hello.digest, hello.pageId, hello.generation)
        if generation == nil {
            let input = BindRequest(scope: scope, generation: hello.generation)
            let binding = try await call("bind", String(decoding: JSONEncoder().encode(input), as: UTF8.self), as: Binding.self)
            try check(binding.version, binding.digest, binding.pageId, binding.generation)
            guard binding.scope == scope else { throw Failure.stale }
            generation = binding.generation
        }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
    }
    public func decide(_ observed: LocalVaultMirrorObservation) async throws -> LocalVaultMirrorDisposition {
        await acquire(); defer { release() }
        try await prepare()
        guard let generation, let pageId else { throw Failure.stale }
        let request = Request(digest: digest, pageId: pageId, generation: generation, scope: scope, requestId: UUID().uuidString, observed: observed)
        let reply = try await call("evaluate", String(decoding: JSONEncoder().encode(request), as: UTF8.self), as: Reply.self)
        try check(reply.version, reply.digest, reply.pageId, reply.generation)
        guard reply.scope == scope, reply.requestId == request.requestId, reply.observed == observed else { throw Failure.stale }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
        return reply.disposition
    }
    public func schedule(_ observed: LocalVaultMirrorScheduleObservation) async throws -> LocalVaultMirrorScheduleDecision {
        await acquire(); defer { release() }
        try await prepare()
        guard let generation, let pageId else { throw Failure.stale }
        let request = Request(digest: digest, pageId: pageId, generation: generation, scope: scope, requestId: UUID().uuidString, observed: observed)
        let reply = try await call("schedule", String(decoding: JSONEncoder().encode(request), as: UTF8.self), as: ScheduleReply.self)
        try check(reply.version, reply.digest, reply.pageId, reply.generation)
        guard reply.scope == scope, reply.requestId == request.requestId, reply.observed == observed else { throw Failure.stale }
        let decision = reply.decision
        guard ["run", "wait-change", "wait-credentials", "wait-reopen", "stop"].contains(decision.action),
              (0...6).contains(decision.consecutiveFailures),
              decision.action == "run" ? decision.delayMs.map({ (0...60_000).contains($0) }) == true : decision.delayMs == nil else { throw Failure.stale }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
        return decision
    }
    public func lifecycle(_ observed: LocalVaultMirrorLifecycleObservation) async throws -> LocalVaultMirrorLifecycleDecision {
        await acquire(); defer { release() }
        try await prepare()
        guard let generation, let pageId else { throw Failure.stale }
        let request = Request(digest: digest, pageId: pageId, generation: generation, scope: scope, requestId: UUID().uuidString, observed: observed)
        let reply = try await call("lifecycle", String(decoding: JSONEncoder().encode(request), as: UTF8.self), as: LifecycleReply.self)
        try check(reply.version, reply.digest, reply.pageId, reply.generation)
        guard reply.scope == scope, reply.requestId == request.requestId, reply.observed == observed,
              ["keep", "adopt", "defer"].contains(reply.decision.baseline),
              ["none", "keep", "adopt", "retire-delete", "fence-edit", "keep-fenced", "defer"].contains(reply.decision.pending) else { throw Failure.stale }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
        return reply.decision
    }

}
