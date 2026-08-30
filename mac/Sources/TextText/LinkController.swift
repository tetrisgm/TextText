import AppKit
import Foundation

/// The device-link client (a simplified RFC 8628 flow; the server half lives
/// in the TextText repo's /api/link/*):
///   1. POST link/start, show the human code IN THE APP.
///   2. Validate verifyUrl (host must match the configured server, comparing
///      case-insensitively as DNS does, and the port must match; https required
///      unless the host is localhost), then open the browser.
///   3. Poll link/poll every `interval` seconds until approved or expired.
///   4. Persist the credential, cache the workspace.
/// The app is never walled behind sign-in; this is a banner, not a gate.
final class LinkController {
    private static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plainISO = ISO8601DateFormatter()

    enum State {
        case idle
        case starting
        case waiting(code: String, expiresAt: Date, verifyURL: URL)
        case failed(String)
    }

    /// Main-thread confined.
    private(set) var state: State = .idle
    var onChange: (() -> Void)?              // main thread
    var onLinked: ((Credentials) -> Void)?   // main thread
    var onActivity: ((String) -> Void)?      // main thread

    private let store: StateStore
    private let queue = DispatchQueue(label: "com.example.texttext.mac.link", qos: .userInitiated)
    private let generationLock = NSLock()
    private var generation = 0

    init(store: StateStore) {
        self.store = store
    }

    var isLinking: Bool {
        switch state {
        case .starting, .waiting: return true
        default: return false
        }
    }

    /// Kick off a link against the given server. Call on the main thread.
    func begin(serverOrigin: URL) {
        let gen = bumpGeneration()
        setState(.starting)

        let deviceName = "TextText on \(Host.current().localizedName ?? "this Mac")"
        queue.async { [weak self] in
            guard let self else { return }
            let client = ServerClient(origin: serverOrigin, token: nil)
            switch client.startLink(name: deviceName) {
            case .failure(let error):
                self.finish(gen, .failed("Could not start linking: \(error)"))
            case .success(let start):
                guard let verifyURL = Self.validatedVerifyURL(start.verifyUrl, serverOrigin: serverOrigin) else {
                    // A bad server response must never become an
                    // arbitrary-URL launch.
                    self.finish(gen, .failed("The server sent an unexpected verify URL"))
                    return
                }
                let expiresAt = Self.parseISO(start.expiresAt) ?? Date().addingTimeInterval(600)
                DispatchQueue.main.async {
                    guard !self.isStale(gen) else { return }
                    self.state = .waiting(
                        code: start.code, expiresAt: expiresAt, verifyURL: verifyURL)
                    self.onChange?()
                    self.onActivity?("Linking: confirm code \(start.code) in your browser")
                    NSWorkspace.shared.open(verifyURL)
                }
                self.poll(gen, client: client, pollToken: start.pollToken,
                          interval: max(1, start.interval ?? 3),
                          expiresAt: expiresAt, serverOrigin: serverOrigin)
            }
        }
    }

    /// Call on the main thread.
    func cancel() {
        _ = bumpGeneration()
        setState(.idle)
    }

    /// Re-open the SAME approval page for the pending code (a lost or stale
    /// browser tab must never require minting a fresh code: two live codes
    /// mean the user can approve one the app no longer polls).
    func reopenApproval() {
        guard case .waiting(_, _, let verifyURL) = state else { return }
        NSWorkspace.shared.open(verifyURL)
    }

    // MARK: Internals

    private func poll(
        _ gen: Int, client: ServerClient, pollToken: String,
        interval: Double, expiresAt: Date, serverOrigin: URL
    ) {
        while true {
            if isStale(gen) { return }
            if Date() > expiresAt {
                finish(gen, .failed("The link code expired. Try again."))
                return
            }
            Thread.sleep(forTimeInterval: interval)
            if isStale(gen) { return }

            switch client.pollLink(pollToken: pollToken) {
            case .failure:
                continue // transient network trouble: keep polling until expiry
            case .success(let reply):
                switch reply.status {
                case "pending":
                    continue
                case "approved":
                    guard let token = reply.token, !token.isEmpty else {
                        finish(gen, .failed("The server approved the link but sent no token"))
                        return
                    }
                    let credentials = Credentials(
                        token: token,
                        serverOrigin: serverOrigin.absoluteString,
                        tokenName: reply.tokenName ?? "TextText",
                        linkedAt: Date()
                    )
                    store.saveCredentials(credentials)
                    // Warm the offline cache so the UI can name the blog
                    // immediately (and later, without a network).
                    let authed = ServerClient(origin: serverOrigin, token: token)
                    if case .success(let (_, data)) = authed.workspace() {
                        store.cacheWorkspace(data)
                    }
                    DispatchQueue.main.async {
                        guard !self.isStale(gen) else { return }
                        self.state = .idle
                        self.onChange?()
                        self.onActivity?("Linked as \(credentials.tokenName)")
                        self.onLinked?(credentials)
                    }
                    return
                default: // "expired" or anything unknown
                    finish(gen, .failed("The link expired before it was approved. Try again."))
                    return
                }
            }
        }
    }

    private func bumpGeneration() -> Int {
        generationLock.lock(); defer { generationLock.unlock() }
        generation += 1
        return generation
    }

    private func isStale(_ gen: Int) -> Bool {
        generationLock.lock(); defer { generationLock.unlock() }
        return gen != generation
    }

    private func finish(_ gen: Int, _ newState: State) {
        DispatchQueue.main.async {
            guard !self.isStale(gen) else { return }
            self.state = newState
            self.onChange?()
            if case .failed(let message) = newState { self.onActivity?(message) }
        }
    }

    private func setState(_ newState: State) {
        state = newState
        onChange?()
    }

    /// partyparty's StartInstallLink rule, mapped to the device flow: the URL
    /// must have a non-empty host equal to the configured server's, compared
    /// the way DNS compares them, and the same port, and must be https unless
    /// the host is localhost.
    static func validatedVerifyURL(_ raw: String, serverOrigin: URL) -> URL? {
        // Hosts compare case-insensitively, because DNS is case-insensitive and
        // these two spellings come from different places: the configured origin
        // is written by hand in the release script as https://TextText.app,
        // while the server returns its own canonical https://texttext.app. A
        // case-sensitive == rejected the app's own server, and the failure was
        // silent from the outside: the link row had already been created
        // server-side, so the only visible effect of pressing a sign-in button
        // was the page reloading. That is what "Sign in with Apple does
        // nothing" was.
        guard let url = URL(string: raw),
              let host = url.host?.lowercased(), !host.isEmpty,
              let serverHost = serverOrigin.host?.lowercased(),
              host == serverHost,
              url.port == serverOrigin.port else {
            return nil
        }
        let isLocalhost = host == "localhost" || host == "127.0.0.1" || host == "::1"
        if url.scheme == "https" { return url }
        if url.scheme == "http" && isLocalhost { return url }
        return nil
    }

    private static func parseISO(_ raw: String) -> Date? {
        fractionalISO.date(from: raw) ?? plainISO.date(from: raw)
    }
}
