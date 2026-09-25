import AppKit
import AuthenticationServices
import Foundation

/// The Mac App Store edition uses Apple's native account sheet. Apple does not
/// authorize this entitlement for Developer ID distribution.
#if TEXTTEXT_STORE
final class NativeAppleSignInController: NSObject {
    enum State {
        case idle
        case presenting
        case failed(String)
    }

    private(set) var state: State = .idle
    var onChange: (() -> Void)?
    var onLinked: ((Credentials) -> Void)?
    var onActivity: ((String) -> Void)?

    private let store: StateStore
    private var authorizationController: ASAuthorizationController?
    private weak var anchorWindow: NSWindow?
    private var serverOrigin: URL?
    private var nonce: String?
    private var generation = 0

    init(store: StateStore) { self.store = store }

    var isPresenting: Bool {
        if case .presenting = state { return true }
        return false
    }

    func begin(serverOrigin: URL, presentationWindow: NSWindow?) {
        guard !isPresenting else { return }
        generation += 1
        self.serverOrigin = serverOrigin
        anchorWindow = presentationWindow ?? NSApp.keyWindow ?? NSApp.mainWindow
        let nonce = AuthSessionController.makeState()
        self.nonce = nonce

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email, .fullName]
        request.nonce = nonce
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        authorizationController = controller
        state = .presenting
        onChange?()
        controller.performRequests()
    }

    func cancel() {
        generation += 1
        authorizationController = nil
        serverOrigin = nil
        nonce = nil
        state = .idle
        onChange?()
    }

    private func fail(_ message: String, generation expected: Int) {
        guard generation == expected else { return }
        authorizationController = nil
        serverOrigin = nil
        nonce = nil
        state = .failed(message)
        onChange?()
        onActivity?(message)
    }

    private func exchange(
        code: String, nonce: String, name: String?, origin: URL, generation expected: Int
    ) {
        guard var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
            fail("Could not build the sign-in URL", generation: expected)
            return
        }
        components.path = "/api/app/apple-native"
        components.query = nil
        var fields = ["code": code, "nonce": nonce]
        if let name { fields["name"] = name }
        guard let url = components.url,
              let body = try? JSONSerialization.data(withJSONObject: fields) else {
            fail("Could not prepare Apple sign-in", generation: expected)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration)
        session.dataTask(with: request) { [weak self] data, response, error in
            if let error {
                DispatchQueue.main.async {
                    self?.fail("Could not finish Apple sign-in: \(error.localizedDescription)", generation: expected)
                }
                return
            }
            struct Reply: Decodable { let token: String; let tokenName: String }
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let data, let reply = try? JSONDecoder().decode(Reply.self, from: data),
                  !reply.token.isEmpty else {
                DispatchQueue.main.async {
                    self?.fail("Apple sign-in could not be verified. Try again.", generation: expected)
                }
                return
            }
            let credentials = Credentials(
                token: reply.token,
                serverOrigin: origin.absoluteString,
                tokenName: reply.tokenName,
                linkedAt: Date()
            )
            let client = ServerClient(origin: origin, token: reply.token)
            var workspaceData: Data?
            if case .success(let (_, data)) = client.workspace() { workspaceData = data }
            DispatchQueue.main.async {
                guard let self, self.generation == expected else { return }
                self.store.saveCredentials(credentials)
                if let workspaceData { self.store.cacheWorkspace(workspaceData) }
                self.authorizationController = nil
                self.serverOrigin = nil
                self.nonce = nil
                self.state = .idle
                self.onChange?()
                self.onActivity?("Signed in")
                self.onLinked?(credentials)
            }
        }.resume()
    }
}

extension NativeAppleSignInController: ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchorWindow ?? NSApp.keyWindow ?? NSApp.mainWindow ?? ASPresentationAnchor()
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.authorizationController === controller,
                  let origin = self.serverOrigin, let nonce = self.nonce else { return }
            let expected = self.generation
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.authorizationCode,
                  let code = String(data: data, encoding: .utf8), !code.isEmpty else {
                self.fail("Apple did not return a sign-in code", generation: expected)
                return
            }
            let name = credential.fullName.map {
                PersonNameComponentsFormatter().string(from: $0)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
            self.exchange(code: code, nonce: nonce, name: name, origin: origin, generation: expected)
        }
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.authorizationController === controller else { return }
            let expected = self.generation
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                self.cancel()
            } else {
                self.fail("Apple sign-in did not complete: \(error.localizedDescription)", generation: expected)
            }
        }
    }
}
#endif
