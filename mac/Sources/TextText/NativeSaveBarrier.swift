import Foundation

/// Bounds native requests and coalesces them around one renderer save receipt.
/// A request that timed out cannot later authorize a different close or sign-out.
@MainActor
final class NativeSaveBarrier {
    typealias Finish = @MainActor (Bool) -> Bool
    typealias Schedule = (TimeInterval, @escaping @MainActor () -> Void) -> () -> Void
    private struct Request {
        let id: UUID
        var completions: [(Bool) -> Void]
        var cancelTimeout: (() -> Void)?
    }
    private let schedule: Schedule
    private var pending: Request?

    init(schedule: Schedule? = nil) {
        self.schedule = schedule ?? { delay, action in
            let work = DispatchWorkItem { MainActor.assumeIsolated { action() } }
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
            return { work.cancel() }
        }
    }

    func request(timeout: TimeInterval = 8,
                 operation: (@escaping Finish) -> Void,
                 completion: @escaping (Bool) -> Void) {
        if pending != nil { pending?.completions.append(completion); return }
        let id = UUID()
        pending = Request(id: id, completions: [completion])
        pending?.cancelTimeout = schedule(timeout) { [weak self] in
            _ = self?.finish(id: id, saved: false)
        }
        operation { [weak self] saved in self?.finish(id: id, saved: saved) ?? false }
    }

    func cancel() { if let id = pending?.id { _ = finish(id: id, saved: false) } }

    private func finish(id: UUID, saved: Bool) -> Bool {
        guard let request = pending, request.id == id else { return false }
        pending = nil
        request.cancelTimeout?()
        for completion in request.completions { completion(saved) }
        return true
    }
}
