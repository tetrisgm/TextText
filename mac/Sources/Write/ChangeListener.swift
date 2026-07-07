import Foundation

/// Near-instant remote sync: long-polls GET /api/sync/v1/changes and fires
/// `onRemoteChange` whenever the workspace's change cursor moves, so a post
/// deleted or edited on the web reaches this Mac within a couple of seconds
/// instead of waiting for the 60s timer (which stays as the fallback).
///
/// Self-contained on purpose: it keeps its own URLSession and reads
/// credentials per cycle, so it never contends with SyncEngine/ServerClient
/// edits and simply idles (10s recheck) while the app is unlinked.
final class ChangeListener {
    /// Called on an arbitrary background queue whenever the cursor moves.
    var onRemoteChange: (() -> Void)?

    private let store: StateStore
    private let queue = DispatchQueue(label: "write.change-listener")
    private let session: URLSession
    private var running = false
    private var generation = 0
    private var cursor: String?

    /// Long-poll hold requested from the server (its cap is 25s).
    private let waitSeconds = 25
    /// Pause between cycles when unlinked or after a network error.
    private let idleRetrySeconds: TimeInterval = 10

    init(store: StateStore) {
        self.store = store
        let config = URLSessionConfiguration.ephemeral
        // Must comfortably outlive the server's held request.
        config.timeoutIntervalForRequest = TimeInterval(waitSeconds + 15)
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)
    }

    func start() {
        queue.async { [weak self] in
            guard let self, !self.running else { return }
            self.running = true
            self.generation += 1
            self.cycle(generation: self.generation)
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.running = false
            self.generation += 1
        }
    }

    // One long-poll round trip, then reschedule. Runs entirely on `queue`
    // except the network wait itself.
    private func cycle(generation: Int) {
        guard running, generation == self.generation else { return }
        guard let credentials = store.loadCredentials() else {
            reschedule(after: idleRetrySeconds, generation: generation)
            return
        }
        let origin = resolveServerOrigin(credentials: credentials)
        var components = URLComponents(
            url: origin.appendingPathComponent("api/sync/v1/changes"),
            resolvingAgainstBaseURL: false
        )
        var query = [URLQueryItem(name: "wait", value: String(waitSeconds))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        components?.queryItems = query
        guard let url = components?.url else {
            reschedule(after: idleRetrySeconds, generation: generation)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")

        let task = session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            self.queue.async {
                guard self.running, generation == self.generation else { return }
                var changed = false
                var delay: TimeInterval = 0
                if let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let data,
                   let body = try? JSONDecoder().decode(ChangesResponse.self, from: data) {
                    // First cycle only records the baseline; a move after
                    // that is a real remote change.
                    changed = self.cursor != nil && body.changed
                    self.cursor = body.cursor
                } else {
                    // Auth failure, server error, or network drop: back off,
                    // the 60s full-pass timer still covers correctness.
                    delay = self.idleRetrySeconds
                }
                if changed { self.onRemoteChange?() }
                self.reschedule(after: delay, generation: generation)
            }
        }
        task.resume()
    }

    private func reschedule(after delay: TimeInterval, generation: Int) {
        guard running, generation == self.generation else { return }
        if delay <= 0 {
            cycle(generation: generation)
        } else {
            queue.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.cycle(generation: generation)
            }
        }
    }

    private struct ChangesResponse: Decodable {
        let cursor: String
        let changed: Bool
    }
}
