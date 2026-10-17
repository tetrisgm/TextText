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

/// Validates the existing page's pure policy RPC. This contains no mirror algorithm.
public actor LocalVaultMirrorPolicy {
    public typealias Evaluate = @Sendable (String) async throws -> String
    private let digest: String, scope: LocalVaultMirrorScope, evaluate: Evaluate
    private let timeoutNanoseconds: UInt64
    private var pageId: String?, retired = false
    private var generation: Int?
    private struct Pending {
        let continuation: CheckedContinuation<String, Error>
        let operation: Task<Void, Never>, timer: Task<Void, Never>
    }
    private var pending: [UUID: Pending] = [:]
    public enum Failure: Error { case stale, timeout }
    private struct Identity: Decodable { let version: Int, digest: String, pageId: String, generation: Int }
    private struct BindRequest: Encodable { let scope: LocalVaultMirrorScope, generation: Int }
    private struct Binding: Decodable { let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope }
    private struct Request: Encodable {
        let version = 1
        let digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String, observed: LocalVaultMirrorObservation
    }
    private struct Reply: Decodable {
        let version: Int, digest: String, pageId: String, generation: Int, scope: LocalVaultMirrorScope, requestId: String
        let observed: LocalVaultMirrorObservation, disposition: LocalVaultMirrorDisposition
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
                    catch { finish(id, .failure(error)) }
                }
                let timer = Task {
                    do { try await Task.sleep(nanoseconds: timeoutNanoseconds); expire(id) } catch {}
                }
                pending[id] = Pending(continuation: continuation, operation: operation, timer: timer)
            }
        } onCancel: { Task { await self.finish(id, .failure(CancellationError())) } }
        try Task.checkCancellation(); guard !retired else { throw Failure.stale }
        return try JSONDecoder().decode(T.self, from: Data(raw.utf8))
    }
    private func check(_ version: Int, _ digest: String, _ page: String, _ generation: Int) throws {
        guard version == 1, digest == self.digest, page == pageId,
            self.generation == nil || generation == self.generation else { throw Failure.stale }
    }
    public func ready() async throws {
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
        try await ready()
        guard let generation, let pageId else { throw Failure.stale }
        let request = Request(digest: digest, pageId: pageId, generation: generation, scope: scope, requestId: UUID().uuidString, observed: observed)
        let reply = try await call("evaluate", String(decoding: JSONEncoder().encode(request), as: UTF8.self), as: Reply.self)
        try check(reply.version, reply.digest, reply.pageId, reply.generation)
        guard reply.scope == scope, reply.requestId == request.requestId, reply.observed == observed else { throw Failure.stale }
        let current = try await call("handshake", as: Identity.self)
        try check(current.version, current.digest, current.pageId, current.generation)
        return reply.disposition
    }
}
