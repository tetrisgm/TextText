import AppKit
import AuthenticationServices
import Foundation

/// Sign in the way an app on this platform is supposed to.
///
/// ASWebAuthenticationSession is a system browser sheet, not an embedded web
/// view. That distinction is the whole reason this exists: Google refuses OAuth
/// inside an embedded view (disallowed_useragent) and Apple restricts it, which
/// is why sign-in used to detour through the device-code flow and ask people to
/// confirm a code in an external browser. A sheet has neither problem, shares
/// the person's Safari session so they are usually already signed in, and hands
/// the result straight back to this app.
///
/// LinkController stays for the CLI and anything headless, where there is no
/// one at a keyboard and a device code is the right answer.
final class AuthSessionController: NSObject {
    enum State {
        case idle
        case presenting
        case failed(String)
    }

    private(set) var state: State = .idle
    var onChange: (() -> Void)?              // main thread
    var onLinked: ((Credentials) -> Void)?   // main thread
    var onActivity: ((String) -> Void)?      // main thread

    /// The scheme this app registers in Info.plist. macOS delivers it only to
    /// the installed copy of TextText, which is what makes the callback safe to
    /// carry a secret.
    static let callbackScheme = "texttext-app"

    private let store: StateStore
    private let queue = DispatchQueue(label: "app.texttext.mac.authsession", qos: .userInitiated)
    private var session: ASWebAuthenticationSession?
    /// The state this app issued for the sheet now open. A callback carrying
    /// anything else was started by someone else and is dropped.
    private var pendingState: String?

    init(store: StateStore) {
        self.store = store
    }

    var isPresenting: Bool {
        if case .presenting = state { return true }
        return false
    }

    /// A URL-safe secret with enough entropy that guessing it is not a strategy.
    static func makeState() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            bytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func authorizeURL(serverOrigin: URL, state: String, device: String) -> URL? {
        guard var components = URLComponents(url: serverOrigin, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = "/connect/app/native"
        components.queryItems = [
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "device", value: device),
        ]
        return components.url
    }

    /// The one-time secret out of a callback, or nil when the callback is not
    /// ours. Separated from the session so the checks are testable without a
    /// browser: an unexpected state, a missing code, and a foreign scheme all
    /// have to fail here.
    static func codeFromCallback(_ url: URL, expectedState: String?) -> String? {
        guard let expectedState, !expectedState.isEmpty else { return nil }
        guard url.scheme?.lowercased() == callbackScheme else { return nil }
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return nil
        }
        let value = { (name: String) in
            items.first { $0.name == name }?.value
        }
        guard let returnedState = value("state"), returnedState == expectedState else { return nil }
        guard let code = value("code"), !code.isEmpty else { return nil }
        return code
    }

    /// Open the sheet. Call on the main thread.
    func begin(serverOrigin: URL) {
        guard !isPresenting else { return }
        let state = Self.makeState()
        let device = "TextText on \(Host.current().localizedName ?? "this Mac")"
        guard let url = Self.authorizeURL(serverOrigin: serverOrigin, state: state, device: device) else {
            setState(.failed("Could not build the sign-in URL"))
            return
        }

        pendingState = state
        setState(.presenting)

        let session = ASWebAuthenticationSession(
            url: url, callbackURLScheme: Self.callbackScheme
        ) { [weak self] callbackURL, error in
            guard let self else { return }
            if let error = error as? ASWebAuthenticationSessionError,
               error.code == .canceledLogin {
                // Closing the sheet is a decision, not a failure.
                self.finishIdle()
                return
            }
            if let error {
                self.finishFailed("Sign-in did not complete: \(error.localizedDescription)")
                return
            }
            guard let callbackURL,
                  let code = Self.codeFromCallback(callbackURL, expectedState: self.pendingState) else {
                self.finishFailed("The sign-in reply did not match this request")
                return
            }
            self.claim(code: code, serverOrigin: serverOrigin)
        }
        session.presentationContextProvider = self
        // Deliberately NOT ephemeral: reusing the Safari session is why this is
        // usually one tap instead of a password.
        session.prefersEphemeralWebBrowserSession = false
        self.session = session

        if !session.start() {
            pendingState = nil
            setState(.failed("Could not open the sign-in sheet"))
        }
    }

    func cancel() {
        session?.cancel()
        session = nil
        pendingState = nil
        setState(.idle)
    }

    /// Exchange the one-time secret for the API token. This is the existing
    /// device-link claim, which already mints exactly once: a second attempt
    /// gets "expired" rather than a second token.
    private func claim(code: String, serverOrigin: URL) {
        queue.async { [weak self] in
            guard let self else { return }
            let client = ServerClient(origin: serverOrigin, token: nil)
            switch client.pollLink(pollToken: code) {
            case .failure(let error):
                self.finishFailed("Could not finish signing in: \(error)")
            case .success(let reply):
                guard reply.status == "approved", let token = reply.token, !token.isEmpty else {
                    self.finishFailed("The server did not return a sign-in token")
                    return
                }
                let credentials = Credentials(
                    token: token,
                    serverOrigin: serverOrigin.absoluteString,
                    tokenName: reply.tokenName ?? "TextText",
                    linkedAt: Date()
                )
                self.store.saveCredentials(credentials)
                // Warm the offline cache so the UI can name the workspace at
                // once, matching what the device-link path has always done.
                let authed = ServerClient(origin: serverOrigin, token: token)
                if case .success(let (_, data)) = authed.workspace() {
                    self.store.cacheWorkspace(data)
                }
                DispatchQueue.main.async {
                    self.session = nil
                    self.pendingState = nil
                    self.state = .idle
                    self.onChange?()
                    self.onActivity?("Signed in")
                    self.onLinked?(credentials)
                }
            }
        }
    }

    private func finishIdle() {
        DispatchQueue.main.async {
            self.session = nil
            self.pendingState = nil
            self.setState(.idle)
        }
    }

    private func finishFailed(_ message: String) {
        DispatchQueue.main.async {
            self.session = nil
            self.pendingState = nil
            self.setState(.failed(message))
            self.onActivity?(message)
        }
    }

    private func setState(_ next: State) {
        state = next
        onChange?()
    }
}

extension AuthSessionController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }
}
