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

public struct LocalVaultMirrorSharedPathObservation: Codable, Equatable, Sendable {
    public let protectedProjection: Bool
    public let baselinePath: String?
    public let localPath: String?
    public let remotePath: String?
    public let checkpointPath: String?
    public let checkpointReady: Bool
    public let checkpointRetired: Bool
    public let localUnique: Bool
    public let remoteDeleted: Bool
    public let localLifecycle: String?
    public let remoteLifecycle: String?
    public let blocked: Bool
    public let organizePermitted: Bool
    public let pendingRename: String
    public init(protectedProjection: Bool, baselinePath: String?, localPath: String?, remotePath: String?, checkpointPath: String?, checkpointReady: Bool, checkpointRetired: Bool, localUnique: Bool, remoteDeleted: Bool, localLifecycle: String?, remoteLifecycle: String?, blocked: Bool, organizePermitted: Bool, pendingRename: String) {
        self.protectedProjection = protectedProjection
        self.baselinePath = baselinePath
        self.localPath = localPath
        self.remotePath = remotePath
        self.checkpointPath = checkpointPath
        self.checkpointReady = checkpointReady
        self.checkpointRetired = checkpointRetired
        self.localUnique = localUnique
        self.remoteDeleted = remoteDeleted
        self.localLifecycle = localLifecycle
        self.remoteLifecycle = remoteLifecycle
        self.blocked = blocked
        self.organizePermitted = organizePermitted
        self.pendingRename = pendingRename
    }
    private enum CodingKeys: String, CodingKey { case protectedProjection, baselinePath, localPath, remotePath, checkpointPath, checkpointReady, checkpointRetired, localUnique, remoteDeleted, localLifecycle, remoteLifecycle, blocked, organizePermitted, pendingRename }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(protectedProjection, forKey: .protectedProjection)
        try c.encode(baselinePath, forKey: .baselinePath)
        try c.encode(localPath, forKey: .localPath)
        try c.encode(remotePath, forKey: .remotePath)
        try c.encode(checkpointPath, forKey: .checkpointPath)
        try c.encode(checkpointReady, forKey: .checkpointReady)
        try c.encode(checkpointRetired, forKey: .checkpointRetired)
        try c.encode(localUnique, forKey: .localUnique)
        try c.encode(remoteDeleted, forKey: .remoteDeleted)
        try c.encode(localLifecycle, forKey: .localLifecycle)
        try c.encode(remoteLifecycle, forKey: .remoteLifecycle)
        try c.encode(blocked, forKey: .blocked)
        try c.encode(organizePermitted, forKey: .organizePermitted)
        try c.encode(pendingRename, forKey: .pendingRename)
    }
}
public struct LocalVaultMirrorSharedPathDecision: Codable, Equatable, Sendable { public let action: String }

public struct LocalVaultMirrorQueueCandidate: Codable, Equatable, Sendable {
    public let operationId: String
    public let conflicted: Bool, editorOwned: Bool, recoveryBlocked: Bool, permitted: Bool
    public init(operationId: String, conflicted: Bool, editorOwned: Bool, recoveryBlocked: Bool, permitted: Bool) {
        self.operationId = operationId; self.conflicted = conflicted; self.editorOwned = editorOwned
        self.recoveryBlocked = recoveryBlocked; self.permitted = permitted
    }
}
public struct LocalVaultMirrorQueueObservation: Codable, Equatable, Sendable {
    public let candidates: [LocalVaultMirrorQueueCandidate], budget: Int
    public let lane: String?
    public init(candidates: [LocalVaultMirrorQueueCandidate], budget: Int, lane: String? = nil) { self.candidates = candidates; self.budget = budget; self.lane = lane }
}
public struct LocalVaultMirrorQueueDecision: Codable, Equatable, Sendable {
    public let operationIds: [String], hasMore: Bool
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
    private struct SharedPathReply: Decodable {
        let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String
        let observed: LocalVaultMirrorSharedPathObservation, decision: LocalVaultMirrorSharedPathDecision
    }
    private struct QueueReply: Decodable {
        let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String
        let observed: LocalVaultMirrorQueueObservation, decision: LocalVaultMirrorQueueDecision
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
        if method == "sharedPath" {
            guard let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
                  Set(object.keys) == Set(["version", "digest", "pageId", "generation", "scope", "requestId", "observed", "decision"]),
                  let observation = object["observed"] as? [String: Any],
                  Set(observation.keys) == Set(["protectedProjection", "baselinePath", "localPath", "remotePath", "checkpointPath", "checkpointReady", "checkpointRetired", "localUnique", "remoteDeleted", "localLifecycle", "remoteLifecycle", "blocked", "organizePermitted", "pendingRename"]),
                  let decision = object["decision"] as? [String: Any], Set(decision.keys) == Set(["action"]),
                  let owner = object["scope"] as? [String: Any], Set(owner.keys) == Set(["accountId", "workspaceId", "lifecycle"]) else { throw Failure.stale }
        }
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

    public func sharedPath(_ observed: LocalVaultMirrorSharedPathObservation) async throws -> LocalVaultMirrorSharedPathDecision {
        await acquire(); defer { release() }
        try await prepare()
        guard let generation, let pageId else { throw Failure.stale }
        let request = Request(digest: digest, pageId: pageId, generation: generation, scope: scope, requestId: UUID().uuidString, observed: observed)
        let reply = try await call("sharedPath", String(decoding: JSONEncoder().encode(request), as: UTF8.self), as: SharedPathReply.self)
        try check(reply.version, reply.digest, reply.pageId, reply.generation)
        guard reply.scope == scope, reply.requestId == request.requestId, reply.observed == observed,
              ["hold", "unchanged", "follow-remote", "announce-local", "adopt-path"].contains(reply.decision.action) else { throw Failure.stale }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
        return reply.decision
    }

    public func queue(_ observed: LocalVaultMirrorQueueObservation) async throws -> LocalVaultMirrorQueueDecision {
        guard observed.lane == nil || observed.lane == "document" || observed.lane == "binary" else { throw Failure.stale }
        await acquire(); defer { release() }
        try await prepare()
        guard let generation, let pageId else { throw Failure.stale }
        let request = Request(digest: digest, pageId: pageId, generation: generation, scope: scope, requestId: UUID().uuidString, observed: observed)
        let reply = try await call("queue", String(decoding: JSONEncoder().encode(request), as: UTF8.self), as: QueueReply.self)
        try check(reply.version, reply.digest, reply.pageId, reply.generation)
        let ids = reply.decision.operationIds
        guard reply.scope == scope, reply.requestId == request.requestId, reply.observed == observed,
              (observed.lane == nil || observed.lane == "document" || observed.lane == "binary"),
              (0...512).contains(observed.budget), ids.count <= observed.budget,
              Set(ids).count == ids.count else { throw Failure.stale }
        let selected = Set(ids)
        guard observed.candidates.filter({ selected.contains($0.operationId) }).map(\.operationId) == ids else { throw Failure.stale }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
        return reply.decision
    }

}
