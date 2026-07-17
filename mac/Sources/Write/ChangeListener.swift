import Foundation
import Network

/// Equal-jitter exponential backoff. The deterministic jitter input keeps the
/// retry policy directly testable without replacing global randomness.
struct ChangeListenerBackoff {
    let initialDelay: TimeInterval
    let maximumDelay: TimeInterval
    private(set) var attempt = 0

    init(initialDelay: TimeInterval = 1, maximumDelay: TimeInterval = 30) {
        precondition(initialDelay > 0)
        precondition(maximumDelay >= initialDelay)
        self.initialDelay = initialDelay
        self.maximumDelay = maximumDelay
    }

    mutating func nextDelay(randomUnitInterval sample: Double) -> TimeInterval {
        let exponent = min(attempt, 62)
        let exponential = initialDelay * pow(2, Double(exponent))
        let ceiling = min(maximumDelay, exponential)
        let unit = sample.isFinite ? min(max(sample, 0), 1) : 0.5

        attempt = min(attempt + 1, 63)
        return ceiling * (0.5 + unit * 0.5)
    }

    mutating func reset() {
        attempt = 0
    }
}

/// Near-instant remote sync: long-polls GET /api/sync/v1/changes and fires
/// `onRemoteChange` whenever the workspace's change cursor moves, so a post
/// deleted or edited on the web reaches this Mac within a couple of seconds
/// instead of waiting for a periodic refresh.
///
/// Self-contained on purpose: it keeps its own URLSession and reads
/// credentials per cycle and simply idles (10s recheck) while the app is unlinked.
final class ChangeListener {
    /// Called on the main queue whenever the cursor moves.
    var onRemoteChange: (() -> Void)?

    private static let waitSeconds = 25

    private let store: StateStore
    private let queue = DispatchQueue(label: "write.change-listener")
    private let session: URLSession

    // All mutable state below is confined to `queue`.
    private var running = false
    private var generation: UInt64 = 0
    private var cursor: String?
    private var activeTask: URLSessionDataTask?
    private var scheduledCycle: DispatchWorkItem?
    private var pathMonitor: NWPathMonitor?
    private var pathWasSatisfied: Bool?
    private var backoff = ChangeListenerBackoff()

    /// Missing credentials are not a network failure. Keep probing at a fixed
    /// interval so a newly linked app starts polling promptly.
    private let unlinkedRetrySeconds: TimeInterval = 10

    init(store: StateStore) {
        self.store = store
        let config = URLSessionConfiguration.ephemeral
        // Must comfortably outlive the server's held request.
        config.timeoutIntervalForRequest = TimeInterval(Self.waitSeconds + 15)
        config.timeoutIntervalForResource = TimeInterval(Self.waitSeconds + 30)
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
    }

    deinit {
        scheduledCycle?.cancel()
        activeTask?.cancel()
        pathMonitor?.pathUpdateHandler = nil
        pathMonitor?.cancel()
        session.invalidateAndCancel()
    }

    func start() {
        queue.async { [weak self] in
            guard let self, !self.running else { return }
            self.running = true
            self.startPathMonitoring()
            self.restartPolling(resetBackoff: true)
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.running = false
            self.generation &+= 1
            self.cancelPendingCycle()
            self.stopPathMonitoring()
            self.backoff.reset()
        }
    }

    /// Interrupts an in-flight request or delayed retry and polls immediately.
    func nudge() {
        queue.async { [weak self] in
            guard let self, self.running else { return }
            self.restartPolling(resetBackoff: true)
        }
    }

    private func restartPolling(resetBackoff: Bool) {
        guard running else { return }
        generation &+= 1
        cancelPendingCycle()
        if resetBackoff { backoff.reset() }
        cycle(generation: generation)
    }

    private func cancelPendingCycle() {
        scheduledCycle?.cancel()
        scheduledCycle = nil
        activeTask?.cancel()
        activeTask = nil
    }

    private func startPathMonitoring() {
        guard pathMonitor == nil else { return }
        pathWasSatisfied = nil

        let monitor = NWPathMonitor()
        pathMonitor = monitor
        monitor.pathUpdateHandler = { [weak self, weak monitor] path in
            guard let self, let monitor, self.pathMonitor === monitor, self.running else { return }

            let isSatisfied = path.status == .satisfied
            let reconnected = self.pathWasSatisfied == false && isSatisfied
            self.pathWasSatisfied = isSatisfied

            if reconnected {
                self.restartPolling(resetBackoff: true)
            }
        }
        monitor.start(queue: queue)
    }

    private func stopPathMonitoring() {
        let monitor = pathMonitor
        pathMonitor = nil
        pathWasSatisfied = nil
        monitor?.pathUpdateHandler = nil
        monitor?.cancel()
    }

    // One long-poll round trip, then reschedule. Runs entirely on `queue`
    // except the network wait itself and the main-queue callback.
    private func cycle(generation: UInt64) {
        guard running, generation == self.generation, activeTask == nil else { return }
        guard let credentials = store.loadCredentials() else {
            backoff.reset()
            schedule(after: unlinkedRetrySeconds, generation: generation)
            return
        }

        let origin = resolveServerOrigin(credentials: credentials)
        var components = URLComponents(
            url: origin.appendingPathComponent("api/sync/v1/changes"),
            resolvingAgainstBaseURL: false
        )
        var query = [URLQueryItem(name: "wait", value: String(Self.waitSeconds))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        components?.queryItems = query
        guard let url = components?.url else {
            scheduleAfterFailure(generation: generation)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")

        let task = session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            self.queue.async {
                self.handleCompletion(data: data, response: response, generation: generation)
            }
        }
        activeTask = task
        task.resume()
    }

    private func handleCompletion(data: Data?, response: URLResponse?, generation: UInt64) {
        // A canceled task may complete after a nudge has already installed its
        // replacement. Never let that stale completion clear or reschedule it.
        guard running, generation == self.generation else { return }
        activeTask = nil

        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              let data,
              let body = try? JSONDecoder().decode(ChangesResponse.self, from: data) else {
            scheduleAfterFailure(generation: generation)
            return
        }

        backoff.reset()
        // First cycle only records the baseline; a move after that is a real
        // remote change.
        let changed = cursor != nil && body.changed
        cursor = body.cursor
        if changed { dispatchRemoteChange(generation: generation) }
        schedule(after: 0, generation: generation)
    }

    private func scheduleAfterFailure(generation: UInt64) {
        let delay = backoff.nextDelay(randomUnitInterval: Double.random(in: 0...1))
        schedule(after: delay, generation: generation)
    }

    private func schedule(after delay: TimeInterval, generation: UInt64) {
        guard running, generation == self.generation, activeTask == nil else { return }

        scheduledCycle?.cancel()
        scheduledCycle = nil
        if delay <= 0 {
            cycle(generation: generation)
            return
        }

        let workItem = DispatchWorkItem { [weak self] in
            guard let self,
                  self.running,
                  generation == self.generation else { return }
            self.scheduledCycle = nil
            self.cycle(generation: generation)
        }
        scheduledCycle = workItem
        queue.asyncAfter(deadline: .now() + delay, execute: workItem)
    }

    private func dispatchRemoteChange(generation: UInt64) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let callback: (() -> Void)? = self.queue.sync {
                guard self.running, generation == self.generation else { return nil }
                return self.onRemoteChange
            }
            callback?()
        }
    }

    private struct ChangesResponse: Decodable {
        let cursor: String
        let changed: Bool
    }
}
