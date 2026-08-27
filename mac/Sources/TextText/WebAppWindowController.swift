import AppKit
import WebKit
import TextTextWorkspaceCore
import os

// WKUserContentController retains its message handler STRONGLY; adding the
// controller directly would cycle (controller -> webView -> config -> ucc ->
// controller) and the window could never deallocate. This weak proxy breaks
// the cycle (the partyparty pattern).
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(
        _ ucc: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        target?.userContentController(ucc, didReceive: message)
    }
}

/// Keeps a Finder-opened item from being overwritten by the asynchronous app
/// cookie setup that precedes the first web navigation on a cold launch.
struct WebAppStartupNavigation {
    private(set) var path: String
    private(set) var hasStarted = false

    mutating func replaceBeforeStart(with path: String) -> Bool {
        guard !hasStarted else { return false }
        self.path = path
        return true
    }

    mutating func begin() -> String {
        hasStarted = true
        return path
    }
}

/// The main window: the full TextText web experience in a native window. A
/// linked Mac exchanges its app token for a web session before opening the
/// workspace. An unlinked Mac sends account authentication and device approval
/// to the system browser, then returns to the workspace with both credentials.
final class WebAppWindowController: NSWindowController, WKNavigationDelegate,
    WKUIDelegate, WKScriptMessageHandler {
    private enum CodexRequestKind: Equatable {
        case initialize
        case accountRead
        case configRead
        case loginStart
        case threadStart(String?)
        case turnStart
        case turnInterrupt
    }

    private let origin: URL
    private var webView: WKWebView!
    /// Called with (token, origin) when the web view links this Mac.
    private let onLinked: (String, URL) -> Void
    /// Starts the system-browser account and device approval flow.
    private let onSystemSignInRequested: () -> Void
    /// Clears the native credential when the web workspace signs out.
    private let onSignOutRequested: () -> Void
    private var startupNavigation: WebAppStartupNavigation
    private var appToken: String?
    private let ocrBridge = NativeOCRBridge()
    private var codexServer: CodexAppServerController?
    private var codexRequestCounter = 0
    private var codexThreadID: String?
    private var codexConversationThreads = CodexConversationThreadRouter()
    private var codexAwaitingThreadConversationID: String?
    private var codexAwaitingThreadPrompt: String?
    private var codexDisabledMCPServerNames: [String] = []
    private var codexDynamicTools: [[String: Any]] = []
    private var codexPendingToolCalls: [String: AnyHashable] = [:]
    private var codexToolDeadlines: [String: DispatchWorkItem] = [:]
    private var codexPendingRequests: [String: CodexRequestKind] = [:]
    private var codexAccount: CodexAccountSummary?
    private var codexLoginInFlight = false
    private var codexShouldStartLogin = false
    private var codexAccountKnownSignedOut = false
    private var codexActiveTurnID: String?
    private var codexActiveConversationID: String?
    private var codexActiveThreadID: String?
    private var codexTurnDeadline: DispatchWorkItem?
    private var codexTimeoutRecoveryDeadline: DispatchWorkItem?
    private var codexTurnTimedOut = false
    private var codexTurnInterruptSent = false
    private var codexTurnCancelRequested = false
    private var codexAgentMessagePhases: [String: CodexAgentMessage.Phase] = [:]

    /// How long the agent may go SILENT, not how long a turn may take. See
    /// `codexTurnProgress(method:)`.
    private static let codexTurnSilenceSeconds: TimeInterval = 30
    private static let codexToolTimeoutSeconds: TimeInterval = 8
    private static let codexTimeoutRecoverySeconds: TimeInterval = 2
    private static let webLog = Logger(
        subsystem: "app.texttext.mac",
        category: "web-navigation")
    private static let codexLog = Logger(
        subsystem: "app.texttext.mac",
        category: "native-assistant")

    static let cacheWebView = true

    private static let authHosts: Set<String> = [
        "accounts.google.com",
        "appleid.apple.com",
    ]

    /// `appToken` is exchanged for an Auth.js session without exposing the token
    /// in a URL or page script. It is nil before this Mac has been linked.
    init(
        origin: URL,
        startPath: String,
        appToken: String?,
        onSystemSignInRequested: @escaping () -> Void,
        onSignOutRequested: @escaping () -> Void,
        onLinked: @escaping (String, URL) -> Void
    ) {
        self.origin = origin
        self.onLinked = onLinked
        self.onSystemSignInRequested = onSystemSignInRequested
        self.onSignOutRequested = onSignOutRequested
        self.startupNavigation = WebAppStartupNavigation(path: startPath)
        self.appToken = appToken

        Self.configureURLCacheForStartup()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // login sticks across launches

        let ucc = WKUserContentController()
        let device = Host.current().localizedName ?? "this Mac"
        let escapedDevice = device.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        #if TEXTTEXT_STORE
        let embeddedAgentAvailable = "false"
        #else
        let embeddedAgentAvailable = "true"
        #endif
        // The server reads none of this; it is the client contract with the web
        // app. __TEXTTEXT_NEEDS_TOKEN__ keeps the legacy in-web linking fallback
        // inert after this Mac has credentials.
        //
        // Guarded to the app's own origin so the device name and native bridge
        // never appear in an external page context.
        ucc.addUserScript(WKUserScript(
            source: """
            (function () {
              var h = location.hostname, base = "\(origin.host ?? "")";
              if (base && h !== base) return;
              window.__TEXTTEXT_APP__ = true;
              window.__TEXTTEXT_EMBEDDED_AGENT__ = \(embeddedAgentAvailable);
              window.__TEXTTEXT_DEVICE__ = "\(escapedDevice)";
              window.__TEXTTEXT_NEEDS_TOKEN__ = \(appToken == nil ? "true" : "false");
            })();
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Next.js handles same-origin links with history.pushState, so its
        // transitions never reach WKNavigationDelegate. Capture exact public
        // workspace-home links before the client router does and ask the
        // native shell to re-enter through its authenticated app-token path.
        ucc.addUserScript(WKUserScript(
            source: """
            (function () {
            var h = location.hostname, base = "\(origin.host ?? "")";
            if (base && h !== base) return;
            document.addEventListener("click", function (event) {
              if (event.defaultPrevented || event.button !== 0 ||
                  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              var target = event.target;
              if (!target || !target.closest) return;
              var anchor = target.closest("a[href]");
              if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
              var url;
              try { url = new URL(anchor.href, location.href); } catch (_) { return; }
              if (url.origin !== location.origin || url.search || url.hash) return;
              var parts = url.pathname.split("/").filter(Boolean);
              var publicHome =
                (parts.length === 2 && parts[0] === "t" && parts[1]) ||
                (parts.length === 1 && parts[0].charAt(0) === "@" && parts[0].length > 1);
              if (!publicHome) return;
              var handler = window.webkit && window.webkit.messageHandlers &&
                window.webkit.messageHandlers.textTextApp;
              if (!handler) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              handler.postMessage({ action: "workspaceHome" });
            }, true);
            })();
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Vision OCR is origin-gated so the native bridge never exists in a
        // third-party OAuth page context.
        ucc.addUserScript(WKUserScript(
            source: """
            (function () {
              var h = location.hostname, base = "\(origin.host ?? "")";
              if (base && h !== base) return;
              \(NativeOCRBridge.shimScript)
            })();
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Silent link: on an unlinked Mac, the first signed-in page mints a
        // token and posts it back. On /signin (401) it no-ops and retries on
        // the next navigation; the sessionStorage guard mints at most once.
        ucc.addUserScript(WKUserScript(
            source: Self.mintScript,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = ucc

        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        // A development build pointed at a local server is the only place the
        // inspector belongs; a release origin is always https, so this never
        // ships enabled.
        if #available(macOS 13.3, *), origin.scheme == "http" {
            webView.isInspectable = true
        }
        self.webView = webView

        let window = NSWindow(
            contentRect: webView.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "TextText"
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = webView
        window.setFrameAutosaveName("TextTextMainWindow")
        window.tabbingMode = .disallowed

        super.init(window: window)
        // Registered AFTER super.init so self is available; the weak proxy
        // keeps the retain cycle from pinning the window open.
        ucc.add(WeakScriptHandler(self), name: "textTextApp")
        ocrBridge.webView = webView
        ucc.add(WeakScriptHandler(ocrBridge), name: NativeOCRBridge.handlerName)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // Tag every request as coming from the app BEFORE the first load, so
        // even the very first workspace render opens the sidebar and drops the
        // feeds footer (the server keys this off the wr_app cookie). Setting a
        // cookie is async, so the initial navigation waits on it.
        setAppCookie(on: webView.configuration.websiteDataStore.httpCookieStore) {
            [weak self] in
            guard let self else { return }
            let path = self.startupNavigation.begin()
            if let appToken {
                self.webView.load(Self.sessionRequest(
                    origin: self.origin, token: appToken, nextPath: path))
            } else {
                self.webView.load(self.request(for: path))
            }
        }
    }

    // Minting runs entirely client-side; the token is bound to the signed-in
    // session cookie and the x-texttext-app header keeps the route from being
    // driven cross-site.
    private static let mintScript = """
    (function () {
      if (!window.__TEXTTEXT_APP__ || !window.__TEXTTEXT_NEEDS_TOKEN__) return;
      try { if (sessionStorage.getItem("__texttext_linked")) return; } catch (e) {}
      var mh = window.webkit && window.webkit.messageHandlers
        && window.webkit.messageHandlers.textTextApp;
      if (!mh) return;
      fetch("/api/app/token", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-texttext-app": "1",
          "x-texttext-device": window.__TEXTTEXT_DEVICE__ || "this Mac"
        }
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.token) {
            try { sessionStorage.setItem("__texttext_linked", "1"); } catch (e) {}
            mh.postMessage({ action: "linked", token: d.token, origin: d.origin });
          }
        })
        .catch(function () {});
    })();
    """

    private func setAppCookie(
        on store: WKHTTPCookieStore, completion: @escaping () -> Void
    ) {
        var props: [HTTPCookiePropertyKey: Any] = [
            .domain: origin.host ?? "",
            .path: "/",
            .name: "wr_app",
            .value: "1",
            .expires: Date(timeIntervalSinceNow: 60 * 60 * 24 * 365 * 5),
        ]
        if origin.scheme == "https" { props[.secure] = "TRUE" }
        guard let cookie = HTTPCookie(properties: props) else {
            completion() // never block the window on a cookie we couldn't build
            return
        }
        store.setCookie(cookie) {
            DispatchQueue.main.async(execute: completion)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

    private func url(for path: String) -> URL {
        URL(string: path, relativeTo: origin)?.absoluteURL ?? origin
    }

    static func configureURLCacheForStartup() {
        guard !cacheWebView else { return }
        URLCache.shared = URLCache(memoryCapacity: 0, diskCapacity: 0, diskPath: nil)
    }

    private func request(for path: String) -> URLRequest {
        var request = URLRequest(url: url(for: path))
        if !Self.cacheWebView {
            request.cachePolicy = .reloadIgnoringLocalCacheData
        }
        return request
    }

    static func sessionRequest(
        origin: URL, token: String, nextPath: String
    ) -> URLRequest {
        var components = URLComponents(
            url: origin.appendingPathComponent("api/app/session"),
            resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "next", value: nextPath)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("1", forHTTPHeaderField: "x-texttext-app")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    static func sessionRecoveryPath(for statusCode: Int) -> String? {
        if statusCode == 401 || statusCode == 403 {
            return "/signin?app=1"
        }
        if statusCode >= 400 {
            return "/signin?error=Configuration"
        }
        return nil
    }

    func establishSession(token: String, nextPath: String = "/start?to=home") {
        appToken = token
        webView.load(Self.sessionRequest(
            origin: origin, token: token, nextPath: nextPath))
    }

    static func isAuthSessionCookieName(_ name: String) -> Bool {
        name == "authjs.session-token" || name == "__Secure-authjs.session-token"
    }

    /// Clear the web half of the native account and navigate only after WebKit
    /// has deleted it. Loading /signin first would see the old cookie and send
    /// the person straight back into the workspace.
    func signOut(nextPath: String = "/signin") {
        appToken = nil
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let sessions = cookies.filter {
                Self.isAuthSessionCookieName($0.name) &&
                    $0.domain.lowercased().trimmingCharacters(
                        in: CharacterSet(charactersIn: ".")) ==
                    (self.origin.host ?? "").lowercased()
            }
            let group = DispatchGroup()
            for cookie in sessions {
                group.enter()
                store.delete(cookie) { group.leave() }
            }
            group.notify(queue: .main) { [weak self] in
                guard let self else { return }
                self.webView.load(self.request(for: nextPath))
            }
        }
    }

    func present() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        observeVisibilityForRepaint()
    }

    func hide() {
        window?.orderOut(nil)
    }

    /// WKWebView stops compositing while its window is occluded (another Space,
    /// the display asleep, the screen locked). On some returns to visibility it
    /// keeps showing the stale, blank surface until something forces a repaint,
    /// which reads as a white window even though the DOM is fully present.
    /// Nudge the layer whenever the window becomes visible again.
    private var repaintObserversInstalled = false
    private func observeVisibilityForRepaint() {
        guard !repaintObserversInstalled, let window else { return }
        repaintObserversInstalled = true
        let center = NotificationCenter.default
        for name: NSNotification.Name in [
            NSWindow.didChangeOcclusionStateNotification,
            NSApplication.didBecomeActiveNotification,
        ] {
            center.addObserver(
                forName: name, object: name == NSWindow.didChangeOcclusionStateNotification ? window : nil,
                queue: .main
            ) { [weak self] _ in
                self?.forceWebViewRepaintIfVisible()
            }
        }
    }

    private func forceWebViewRepaintIfVisible() {
        guard let window, window.occlusionState.contains(.visible) else { return }
        // Toggling the hosted layer's hidden state forces WebKit to recomposite
        // the current DOM without a reload (which would drop scroll and state).
        let layer = webView.layer
        layer?.isHidden = true
        DispatchQueue.main.async { layer?.isHidden = false }
    }

    /// Navigate the web view to a path on the origin (used after linking).
    func load(path: String) {
        if startupNavigation.replaceBeforeStart(with: path) { return }
        webView.load(request(for: path))
    }

    func reloadFromOrigin() {
        webView.reloadFromOrigin()
    }

    private func isInApp(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == origin.host?.lowercased()
    }

    private func isAuthenticationHost(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return Self.authHosts.contains(host)
    }

    private func isSessionExchange(_ url: URL) -> Bool {
        isInApp(url) && url.path == "/api/app/session"
    }

    static func isPublicWorkspaceHome(_ url: URL, on origin: URL) -> Bool {
        guard url.scheme?.lowercased() == origin.scheme?.lowercased(),
              url.host?.lowercased() == origin.host?.lowercased(),
              url.port == origin.port,
              url.query == nil,
              url.fragment == nil else { return false }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true)
        if parts.count == 2, parts[0] == "t", !parts[1].isEmpty {
            return true
        }
        return parts.count == 1 && parts[0].hasPrefix("@") && parts[0].count > 1
    }

    private func loadWorkspaceHome() {
        if let appToken {
            webView.load(Self.sessionRequest(
                origin: origin, token: appToken, nextPath: "/start?to=home"))
        } else {
            webView.load(request(for: "/start?to=home"))
        }
    }

    private func openExternally(_ url: URL) {
        guard url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto"
        else { return }
        NSWorkspace.shared.open(url)
    }

    private func nextCodexRequestID() -> String {
        codexRequestCounter += 1
        return "texttext-" + String(codexRequestCounter)
    }

    @discardableResult
    private func sendCodexRequest(
        _ kind: CodexRequestKind,
        method: String,
        params: [String: Any]
    ) throws -> String {
        guard let server = codexServer else { throw CodexAppServerError.notRunning }
        let requestID = nextCodexRequestID()
        codexPendingRequests[requestID] = kind
        do {
            try server.send(id: requestID, method: method, params: params)
            return requestID
        } catch {
            codexPendingRequests.removeValue(forKey: requestID)
            throw error
        }
    }

    private func prepareCodexServer() -> CodexAppServerController? {
        #if TEXTTEXT_STORE
        return nil
        #else
        if let codexServer { return codexServer }
        let locator = CodexRuntimeLocator(bundleURL: Bundle.main.bundleURL)
        guard let executableURL = locator.executableURL else { return nil }
        let server = CodexAppServerController(executableURL: executableURL)
        server.onEvent = { [weak self] message in
            DispatchQueue.main.async { self?.handleCodexMessage(message) }
        }
        server.onExit = { [weak self, weak server] status in
            DispatchQueue.main.async {
                guard let self, self.codexServer === server else { return }
                let interruptedConversationID = self.codexActiveConversationID
                self.codexServer = nil
                self.codexThreadID = nil
                self.codexConversationThreads.reset()
                self.codexAwaitingThreadConversationID = nil
                self.codexAwaitingThreadPrompt = nil
                self.codexDisabledMCPServerNames = []
                self.codexAccount = nil
                self.codexLoginInFlight = false
                self.codexShouldStartLogin = false
                self.codexAccountKnownSignedOut = false
                self.codexPendingRequests.removeAll()
                self.codexPendingToolCalls.removeAll()
                for deadline in self.codexToolDeadlines.values { deadline.cancel() }
                self.codexToolDeadlines.removeAll()
                self.codexTurnDeadline?.cancel()
                self.codexTurnDeadline = nil
                self.codexTimeoutRecoveryDeadline?.cancel()
                self.codexTimeoutRecoveryDeadline = nil
                self.codexActiveTurnID = nil
                self.codexActiveConversationID = nil
                self.codexActiveThreadID = nil
                self.codexTurnTimedOut = false
                self.codexTurnInterruptSent = false
                self.codexTurnCancelRequested = false
                self.codexAgentMessagePhases.removeAll()
                if let interruptedConversationID {
                    self.emitCodexTurnEvent(
                        [
                            "type": "error",
                            "message": "The TextText Agent connection closed before that reply finished.",
                        ],
                        conversationID: interruptedConversationID)
                }
                self.emitCodexEvent([
                    "type": "status",
                    "state": status == 0 ? "signed-out" : "failed",
                    "embeddedChatSupported": true,
                    "recoveryAction": status == 0 ? "connect" : "retry",
                ])
            }
        }
        codexServer = server
        return server
        #endif
    }

    private func emitCodexEvent(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(
                "window.dispatchEvent(new CustomEvent('texttext:assistant', { detail: " + json + " }));",
                completionHandler: nil)
        }
    }

    private func emitCodexTurnEvent(
        _ payload: [String: Any],
        conversationID: String? = nil
    ) {
        var tagged = payload
        if let conversationID = conversationID ?? codexActiveConversationID {
            tagged["conversationId"] = conversationID
        }
        emitCodexEvent(tagged)
    }

    private func codexStatus() {
        #if TEXTTEXT_STORE
        emitCodexEvent([
            "type": "status",
            "state": "unavailable",
            "embeddedChatSupported": false,
            "recoveryAction": "open-settings",
        ])
        #else
        guard let server = prepareCodexServer() else {
            emitCodexEvent([
                "type": "status",
                "state": "runtime-missing",
                "embeddedChatSupported": false,
                "recoveryAction": "install-runtime",
            ])
            return
        }
        if !server.isRunning {
            codexShouldStartLogin = false
            do {
                try server.start()
                try sendCodexRequest(
                    .initialize,
                    method: "initialize",
                    params: [
                        "clientInfo": [
                            "name": "texttext",
                            "title": "TextText",
                            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev",
                        ],
                        "capabilities": ["experimentalApi": true],
                    ])
            } catch {
                emitCodexEvent([
                    "type": "status",
                    "state": "failed",
                    "embeddedChatSupported": true,
                    "recoveryAction": "retry",
                ])
                return
            }
        }
        let state = codexThreadID != nil ? "ready" : (codexAccountKnownSignedOut ? "signed-out" : "connecting")
        emitCodexEvent([
            "type": "status",
            "state": state,
            "embeddedChatSupported": true,
            "runtimeVersion": "available",
            "providerLabel": "Codex with ChatGPT",
            "accountEmail": codexAccount?.email ?? NSNull(),
            "planLabel": codexAccount?.planType ?? NSNull(),
            "recoveryAction": state == "ready" ? NSNull() : "connect",
        ])
        #endif
    }

    private func connectCodex() {
        #if TEXTTEXT_STORE
        codexStatus()
        #else
        guard let server = prepareCodexServer() else {
            codexStatus()
            return
        }
        codexShouldStartLogin = true
        codexAccountKnownSignedOut = false
        do {
            if server.isRunning {
                if codexThreadID != nil {
                    codexStatus()
                    return
                }
                let starting = codexPendingRequests.values.contains(where: { $0 == .initialize })
                let readingAccount = codexPendingRequests.values.contains(where: { $0 == .accountRead })
                let readingConfig = codexPendingRequests.values.contains(where: { $0 == .configRead })
                if !starting && !readingAccount && !readingConfig {
                    try sendCodexRequest(.accountRead, method: "account/read", params: [:])
                }
            } else {
                try server.start()
                try sendCodexRequest(
                    .initialize,
                    method: "initialize",
                    params: [
                        "clientInfo": [
                            "name": "texttext",
                            "title": "TextText",
                            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev",
                        ],
                        "capabilities": ["experimentalApi": true],
                    ])
            }
            emitCodexEvent(["type": "status", "state": "connecting", "embeddedChatSupported": true])
        } catch {
            emitCodexEvent(["type": "status", "state": "failed", "embeddedChatSupported": false, "recoveryAction": "retry"])
        }
        #endif
    }

    /// Ends TextText's embedded Codex session and stops the bundled runtime.
    /// Codex owns its account credential, so this intentionally does not claim
    /// to sign the person out of Codex in other applications.
    private func disconnectCodex() {
        #if TEXTTEXT_STORE
        codexStatus()
        #else
        let server = codexServer
        codexServer = nil
        codexThreadID = nil
        codexConversationThreads.reset()
        codexAwaitingThreadConversationID = nil
        codexAwaitingThreadPrompt = nil
        codexDisabledMCPServerNames = []
        codexAccount = nil
        codexLoginInFlight = false
        codexShouldStartLogin = false
        codexAccountKnownSignedOut = true
        codexPendingRequests.removeAll()
        codexPendingToolCalls.removeAll()
        for deadline in codexToolDeadlines.values { deadline.cancel() }
        codexToolDeadlines.removeAll()
        codexTurnDeadline?.cancel()
        codexTurnDeadline = nil
        codexTimeoutRecoveryDeadline?.cancel()
        codexTimeoutRecoveryDeadline = nil
        codexActiveTurnID = nil
        codexActiveConversationID = nil
        codexActiveThreadID = nil
        codexTurnTimedOut = false
        codexTurnInterruptSent = false
        codexTurnCancelRequested = false
        codexAgentMessagePhases.removeAll()
        server?.stop()
        emitCodexEvent([
            "type": "status",
            "state": "signed-out",
            "embeddedChatSupported": true,
            "providerLabel": "Codex with ChatGPT",
            "recoveryAction": "connect",
        ])
        #endif
    }

    private func sendCodexTurn(
        _ prompt: String,
        conversationID: String,
        history: [[String: Any]] = []
    ) {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !conversationID.isEmpty,
              codexThreadID != nil else {
            emitCodexTurnEvent(
                ["type": "error", "message": "Connect the TextText Agent before sending a message."],
                conversationID: conversationID)
            return
        }
        if codexTurnTimedOut || codexActiveConversationID != nil ||
            codexAwaitingThreadConversationID != nil {
            emitCodexTurnEvent([
                "type": "error",
                "message": "The previous TextText Agent turn is still stopping. Try again in a moment.",
            ], conversationID: conversationID)
            return
        }
        let alreadyMapped = codexConversationThreads.hasThread(for: conversationID)
        if let threadID = codexConversationThreads.threadID(for: conversationID) {
            startCodexTurn(
                prompt: alreadyMapped
                    ? prompt
                    : CodexAppServerRequests.promptRestoringConversation(
                        currentPrompt: prompt,
                        history: history),
                conversationID: conversationID,
                threadID: threadID)
            return
        }

        codexAwaitingThreadConversationID = conversationID
        codexAwaitingThreadPrompt = CodexAppServerRequests.promptRestoringConversation(
            currentPrompt: prompt,
            history: history)
        do {
            try sendCodexRequest(
                .threadStart(conversationID),
                method: "thread/start",
                params: CodexAppServerRequests.threadStart(
                    dynamicTools: codexDynamicTools,
                    disabledMCPServers: codexDisabledMCPServerNames,
                    workingDirectory: FileManager.default.temporaryDirectory.path))
        } catch {
            codexAwaitingThreadConversationID = nil
            codexAwaitingThreadPrompt = nil
            emitCodexTurnEvent(
                ["type": "error", "message": "The TextText Agent could not start a private chat thread."],
                conversationID: conversationID)
        }
    }

    private func startCodexTurn(
        prompt: String,
        conversationID: String,
        threadID: String
    ) {
        codexActiveConversationID = conversationID
        codexActiveThreadID = threadID
        do {
            try sendCodexRequest(
                .turnStart,
                method: "turn/start",
                params: [
                    "threadId": threadID,
                    "input": [["type": "text", "text": prompt]],
                    "approvalPolicy": "never",
                ])
            startCodexTurnDeadline(threadID: threadID)
            emitCodexTurnEvent(["type": "turn-started"])
        } catch {
            finishCodexTurn()
            emitCodexTurnEvent(
                ["type": "error", "message": "The TextText Agent could not start that turn."],
                conversationID: conversationID)
        }
    }

    /// Whether an App Server message is proof the turn is still working.
    ///
    /// The deadline used to be an absolute clock started at `turn/start`:
    /// thirty seconds for the whole turn, whether the agent was streaming an
    /// answer, waiting on a tool, or genuinely wedged. A long prompt outlives
    /// that easily, so the person was told the agent took too long while it
    /// was still typing, and the turn was interrupted mid-answer. Every event
    /// below is the agent showing it is alive, so each one starts the clock
    /// over and the deadline measures silence rather than work.
    static func codexTurnProgress(method: String?) -> Bool {
        switch method {
        case "turn/started",
             "item/started",
             "item/agentMessage/delta",
             "item/completed",
             "item/tool/call":
            return true
        default:
            return false
        }
    }

    private func startCodexTurnDeadline(threadID: String) {
        codexTurnTimedOut = false
        codexTurnInterruptSent = false
        codexTurnCancelRequested = false
        scheduleCodexTurnDeadline(threadID: threadID)
    }

    /// Start the silence clock over. Only the clock: a refresh must not clear
    /// the timed-out or cancelled flags, which is why this is separate from
    /// `startCodexTurnDeadline(threadID:)`.
    private func scheduleCodexTurnDeadline(threadID: String) {
        codexTurnDeadline?.cancel()
        let deadline = DispatchWorkItem { [weak self] in
            guard let self else { return }
            Self.codexLog.error(
                "turn went quiet for \(Self.codexTurnSilenceSeconds, privacy: .public)s with \(self.codexPendingToolCalls.count, privacy: .public) pending tool calls")
            self.codexTurnTimedOut = true
            self.emitCodexTurnEvent([
                "type": "error",
                "message": "The TextText Agent stopped responding. Try the request again.",
            ])
            self.interruptTimedOutCodexTurnIfPossible(threadID: threadID)
            self.scheduleCodexTimeoutRecovery()
        }
        codexTurnDeadline = deadline
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.codexTurnSilenceSeconds,
            execute: deadline)
    }

    /// Called for every message that arrives while a turn is open.
    private func refreshCodexTurnDeadline(for message: CodexAppServerMessage) {
        guard codexTurnDeadline != nil,
              !codexTurnTimedOut,
              !codexTurnCancelRequested,
              Self.codexTurnProgress(method: message.method),
              codexMessageBelongsToActiveThread(message),
              let threadID = codexActiveThreadID
        else { return }
        scheduleCodexTurnDeadline(threadID: threadID)
    }

    private func finishCodexTurn() {
        codexTurnDeadline?.cancel()
        codexTurnDeadline = nil
        codexTimeoutRecoveryDeadline?.cancel()
        codexTimeoutRecoveryDeadline = nil
        for deadline in codexToolDeadlines.values { deadline.cancel() }
        codexToolDeadlines.removeAll()
        codexPendingToolCalls.removeAll()
        codexActiveTurnID = nil
        codexActiveConversationID = nil
        codexActiveThreadID = nil
        codexTurnTimedOut = false
        codexTurnInterruptSent = false
        codexTurnCancelRequested = false
        codexAgentMessagePhases.removeAll()
    }

    /// A provider can accept `turn/start` but delay its response beyond the
    /// user-facing deadline. In that state there is no turn id to interrupt,
    /// and the old implementation left the composer blocked forever. Give a
    /// late response a brief chance to provide the id, then restart the owned
    /// child process so Retry always has a clean path forward.
    private func scheduleCodexTimeoutRecovery() {
        codexTimeoutRecoveryDeadline?.cancel()
        let recovery = DispatchWorkItem { [weak self] in
            guard let self, self.codexTurnTimedOut else { return }
            Self.codexLog.error("restarting native assistant after timed-out turn")
            self.codexServer?.stop()
        }
        codexTimeoutRecoveryDeadline = recovery
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.codexTimeoutRecoverySeconds,
            execute: recovery)
    }

    private func interruptTimedOutCodexTurnIfPossible(threadID: String) {
        guard codexTurnTimedOut,
              !codexTurnInterruptSent,
              !threadID.isEmpty,
              let turnID = codexActiveTurnID else { return }
        do {
            try sendCodexRequest(
                .turnInterrupt,
                method: "turn/interrupt",
                params: CodexAppServerRequests.turnInterrupt(
                    threadID: threadID,
                    turnID: turnID))
            codexTurnInterruptSent = true
        } catch {
            // The forced process recovery below remains the bounded fallback.
        }
    }

    private func cancelCodexTurn(requestedConversationID: String?) {
        if let awaitingConversationID = codexAwaitingThreadConversationID {
            if let requestedConversationID,
               requestedConversationID != awaitingConversationID {
                emitCodexTurnEvent(
                    [
                        "type": "error",
                        "message": "No TextText Agent turn is running in this chat.",
                    ],
                    conversationID: requestedConversationID)
                return
            }
            // App Server does not expose a thread/start cancellation. Keep the
            // pending conversation id so its eventual thread can be registered,
            // but discard the prompt so no turn starts after the UI stops it.
            codexAwaitingThreadPrompt = nil
            emitCodexTurnEvent(
                ["type": "error", "message": "The TextText Agent was stopped."],
                conversationID: awaitingConversationID)
            return
        }
        guard let activeConversationID = codexActiveConversationID,
              let activeThreadID = codexActiveThreadID else {
            emitCodexTurnEvent(
                ["type": "error", "message": "No TextText Agent turn is running."],
                conversationID: requestedConversationID)
            return
        }
        if let requestedConversationID,
           requestedConversationID != activeConversationID {
            emitCodexTurnEvent(
                ["type": "error", "message": "No TextText Agent turn is running in this chat."],
                conversationID: requestedConversationID)
            return
        }
        codexTurnCancelRequested = true
        interruptCancelledCodexTurnIfPossible(threadID: activeThreadID)
    }

    private func interruptCancelledCodexTurnIfPossible(threadID: String) {
        guard codexTurnCancelRequested,
              !codexTurnInterruptSent,
              !threadID.isEmpty,
              let turnID = codexActiveTurnID else { return }
        do {
            try sendCodexRequest(
                .turnInterrupt,
                method: "turn/interrupt",
                params: CodexAppServerRequests.turnInterrupt(
                    threadID: threadID,
                    turnID: turnID))
            codexTurnInterruptSent = true
        } catch {
            emitCodexTurnEvent(["type": "error", "message": "The TextText Agent could not be stopped."])
        }
    }

    private func codexMessageBelongsToActiveThread(
        _ message: CodexAppServerMessage
    ) -> Bool {
        guard let activeThreadID = codexActiveThreadID else { return false }
        guard let messageThreadID = message.rawParams?["threadId"] as? String
        else { return true }
        return messageThreadID == activeThreadID
    }

    private func startCodexToolDeadline(
        callID: String,
        requestID: AnyHashable,
        toolName: String
    ) {
        codexToolDeadlines.removeValue(forKey: callID)?.cancel()
        let deadline = DispatchWorkItem { [weak self] in
            guard let self,
                  self.codexPendingToolCalls.removeValue(forKey: callID) != nil
            else { return }
            self.codexToolDeadlines.removeValue(forKey: callID)
            Self.codexLog.error(
                "tool \(toolName, privacy: .public) did not return within \(Self.codexToolTimeoutSeconds, privacy: .public) seconds")
            try? self.codexServer?.respond(
                id: requestID,
                result: CodexAppServerRequests.dynamicToolResult(
                    text: "The in-app \(toolName) tool did not return in time.",
                    success: false))
        }
        codexToolDeadlines[callID] = deadline
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.codexToolTimeoutSeconds,
            execute: deadline)
    }

    private func handleCodexMessage(_ message: CodexAppServerMessage) {
        if message.method == "remoteControl/status/changed" {
            return
        }
        refreshCodexTurnDeadline(for: message)
        if let requestID = message.id,
           message.method == nil,
           let requestKind = codexPendingRequests.removeValue(forKey: requestID) {
            if let errorMessage = message.errorMessage {
                if requestKind == .turnInterrupt { return }
                if requestKind == .turnStart {
                    let conversationID = codexActiveConversationID
                    finishCodexTurn()
                    emitCodexTurnEvent(
                        ["type": "error", "message": errorMessage],
                        conversationID: conversationID)
                } else if case .threadStart(let conversationID) = requestKind,
                          let conversationID {
                    codexAwaitingThreadConversationID = nil
                    codexAwaitingThreadPrompt = nil
                    emitCodexTurnEvent(
                        [
                            "type": "error",
                            "message": "The TextText Agent could not start a private chat thread.",
                        ],
                        conversationID: conversationID)
                } else {
                    emitCodexEvent([
                        "type": "status",
                        "state": "failed",
                        "embeddedChatSupported": true,
                        "recoveryAction": "retry",
                    ])
                }
                return
            }
            switch requestKind {
            case .initialize:
                try? codexServer?.notify(method: "initialized")
                _ = try? sendCodexRequest(.accountRead, method: "account/read", params: [:])
            case .accountRead:
                guard let account = CodexAccountSummary(result: message.rawResult) else {
                    codexAccount = nil
                    codexThreadID = nil
                    codexConversationThreads.reset()
                    codexAwaitingThreadConversationID = nil
                    codexAwaitingThreadPrompt = nil
                    codexDisabledMCPServerNames = []
                    codexAccountKnownSignedOut = true
                    emitCodexEvent([
                        "type": "status",
                        "state": "signed-out",
                        "embeddedChatSupported": true,
                        "recoveryAction": "connect",
                    ])
                    if codexShouldStartLogin && !codexLoginInFlight {
                        codexLoginInFlight = true
                        do {
                            try sendCodexRequest(
                                .loginStart,
                                method: "account/login/start",
                                params: CodexAppServerRequests.chatGPTLoginStart)
                        } catch {
                            codexLoginInFlight = false
                            emitCodexEvent([
                                "type": "status",
                                "state": "failed",
                                "embeddedChatSupported": true,
                                "recoveryAction": "retry",
                            ])
                        }
                    }
                    return
                }
                codexAccount = account
                codexAccountKnownSignedOut = false
                codexShouldStartLogin = false
                do {
                    try sendCodexRequest(
                        .configRead,
                        method: "config/read",
                        params: [:])
                    emitCodexEvent([
                        "type": "status",
                        "state": "connecting",
                        "embeddedChatSupported": true,
                        "providerLabel": "Codex with ChatGPT",
                    ])
                } catch {
                    emitCodexEvent([
                        "type": "status",
                        "state": "failed",
                        "embeddedChatSupported": true,
                        "recoveryAction": "retry",
                    ])
                }
            case .configRead:
                guard let serverNames = CodexAppServerRequests.effectiveMCPServerNames(
                    configReadResult: message.rawResult) else {
                    emitCodexEvent([
                        "type": "status",
                        "state": "failed",
                        "embeddedChatSupported": true,
                        "recoveryAction": "retry",
                    ])
                    return
                }
                codexDisabledMCPServerNames = serverNames
                do {
                    try sendCodexRequest(
                        .threadStart(nil),
                        method: "thread/start",
                        params: CodexAppServerRequests.threadStart(
                            dynamicTools: codexDynamicTools,
                            disabledMCPServers: serverNames,
                            workingDirectory: FileManager.default.temporaryDirectory.path))
                } catch {
                    emitCodexEvent([
                        "type": "status",
                        "state": "failed",
                        "embeddedChatSupported": true,
                        "recoveryAction": "retry",
                    ])
                }
            case .loginStart:
                guard let authURLString = message.rawResult?["authUrl"] as? String,
                      let authURL = URL(string: authURLString) else {
                    codexLoginInFlight = false
                    emitCodexEvent([
                        "type": "status",
                        "state": "failed",
                        "embeddedChatSupported": true,
                        "recoveryAction": "retry",
                    ])
                    return
                }
                openExternally(authURL)
                emitCodexEvent([
                    "type": "status",
                    "state": "connecting",
                    "embeddedChatSupported": true,
                ])
            case .threadStart:
                // App Server emits thread/started after this response. Do not
                // advertise readiness until that notification supplies the
                // thread ID used by every subsequent turn.
                break
            case .turnStart:
                if let turn = message.rawResult?["turn"] as? [String: Any],
                   let turnID = turn["id"] as? String {
                    codexActiveTurnID = turnID
                    if codexTurnTimedOut {
                        interruptTimedOutCodexTurnIfPossible(
                            threadID: codexActiveThreadID ?? "")
                    } else if codexTurnCancelRequested {
                        interruptCancelledCodexTurnIfPossible(
                            threadID: codexActiveThreadID ?? "")
                    }
                }
            case .turnInterrupt:
                break
            }
            return
        }
        if message.method == "account/login/completed" {
            codexLoginInFlight = false
            if message.rawParams?["success"] as? Bool == true {
                _ = try? sendCodexRequest(.accountRead, method: "account/read", params: [:])
            } else {
                emitCodexEvent([
                    "type": "status",
                    "state": "failed",
                    "embeddedChatSupported": true,
                    "recoveryAction": "retry",
                ])
            }
            return
        }
        if message.method == "thread/started",
           let thread = message.rawParams?["thread"] as? [String: Any],
           let threadID = thread["id"] as? String {
            if let conversationID = codexAwaitingThreadConversationID {
                let prompt = codexAwaitingThreadPrompt
                codexAwaitingThreadConversationID = nil
                codexAwaitingThreadPrompt = nil
                codexConversationThreads.register(
                    threadID: threadID,
                    for: conversationID)
                if let prompt {
                    startCodexTurn(
                        prompt: prompt,
                        conversationID: conversationID,
                        threadID: threadID)
                }
            } else {
                codexThreadID = threadID
                codexConversationThreads.setInitialThreadID(threadID)
                emitCodexEvent([
                    "type": "status",
                    "state": "ready",
                    "embeddedChatSupported": true,
                    "providerLabel": "Codex with ChatGPT",
                    "accountEmail": codexAccount?.email ?? NSNull(),
                    "planLabel": codexAccount?.planType ?? NSNull(),
                    "recoveryAction": NSNull(),
                ])
            }
            return
        }
        let turnScopedMethods: Set<String> = [
            "turn/started",
            "item/started",
            "item/agentMessage/delta",
            "item/completed",
            "item/tool/call",
            "turn/completed",
        ]
        if let method = message.method,
           turnScopedMethods.contains(method),
           !codexMessageBelongsToActiveThread(message) {
            if method == "item/tool/call", let requestID = message.jsonRPCID {
                try? codexServer?.respond(
                    id: requestID,
                    result: CodexAppServerRequests.dynamicToolResult(
                        text: "That tool call belongs to an inactive TextText chat.",
                        success: false))
            }
            return
        }
        if message.method == "turn/started",
           let turn = message.rawParams?["turn"] as? [String: Any],
           let turnID = turn["id"] as? String {
            codexActiveTurnID = turnID
            if codexTurnTimedOut {
                interruptTimedOutCodexTurnIfPossible(
                    threadID: codexActiveThreadID ?? "")
            } else if codexTurnCancelRequested {
                interruptCancelledCodexTurnIfPossible(
                    threadID: codexActiveThreadID ?? "")
            }
            return
        }
        if message.method == "item/started",
           let agentMessage = CodexAgentMessage(params: message.rawParams) {
            codexAgentMessagePhases[agentMessage.id] = agentMessage.phase
            return
        }
        if message.method == "item/agentMessage/delta",
           let itemID = message.rawParams?["itemId"] as? String,
           codexAgentMessagePhases[itemID] == .finalAnswer,
           let delta = message.params?["delta"] as? String {
            if codexTurnTimedOut || codexTurnCancelRequested { return }
            emitCodexTurnEvent(["type": "text-delta", "text": delta])
            return
        }
        if message.method == "item/completed",
           let agentMessage = CodexAgentMessage(params: message.rawParams) {
            codexAgentMessagePhases.removeValue(forKey: agentMessage.id)
            if !codexTurnTimedOut,
               !codexTurnCancelRequested,
               agentMessage.phase == .finalAnswer,
               !agentMessage.text.isEmpty {
                emitCodexTurnEvent([
                    "type": "final-text",
                    "text": agentMessage.text,
                ])
            }
            return
        }
        if message.method == "item/tool/call" {
            let params = message.rawParams ?? [:]
            let callId = (params["callId"] as? String) ?? (params["id"] as? String) ?? UUID().uuidString
            if (codexTurnTimedOut || codexTurnCancelRequested), let requestId = message.jsonRPCID {
                try? codexServer?.respond(
                    id: requestId,
                    result: CodexAppServerRequests.dynamicToolResult(
                        text: codexTurnCancelRequested
                            ? "The TextText Agent turn was stopped."
                            : "The TextText Agent turn timed out.", success: false))
                return
            }
            if let requestId = message.jsonRPCID { codexPendingToolCalls[callId] = requestId }
            let toolName = (params["tool"] as? String) ?? (params["name"] as? String) ?? ""
            Self.codexLog.info("tool requested: \(toolName, privacy: .public)")
            if let requestID = message.jsonRPCID {
                startCodexToolDeadline(
                    callID: callId,
                    requestID: requestID,
                    toolName: toolName)
            }
            emitCodexTurnEvent([
                "type": "tool-call",
                "callId": callId,
                "tool": toolName,
                "arguments": params["arguments"] ?? [:],
            ])
            return
        }
        if message.method == "turn/completed" {
            let timedOut = codexTurnTimedOut
            let cancelled = codexTurnCancelRequested
            let conversationID = codexActiveConversationID
            finishCodexTurn()
            if timedOut { return }
            if cancelled {
                emitCodexTurnEvent(
                    ["type": "error", "message": "The TextText Agent was stopped."],
                    conversationID: conversationID)
                return
            }
            switch CodexTurnOutcome(params: message.rawParams) {
            case .completed:
                emitCodexTurnEvent(
                    ["type": "turn-completed"],
                    conversationID: conversationID)
            case .failed(let message):
                emitCodexTurnEvent(
                    [
                        "type": "error",
                        "message": message ?? "The TextText Agent could not finish that turn.",
                    ],
                    conversationID: conversationID)
            case .interrupted:
                emitCodexTurnEvent(
                    [
                        "type": "error",
                        "message": "That TextText Agent turn was interrupted.",
                    ],
                    conversationID: conversationID)
            case nil:
                emitCodexTurnEvent(
                    [
                        "type": "error",
                        "message": "The TextText Agent returned an unknown turn result.",
                    ],
                    conversationID: conversationID)
            }
            return
        }
        if message.errorMessage != nil {
            emitCodexEvent(["type": "status", "state": "failed", "embeddedChatSupported": false, "recoveryAction": "retry"])
        }
    }

    // MARK: WKScriptMessageHandler (JS -> Swift)

    func userContentController(
        _ ucc: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard message.name == "textTextApp",
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host.lowercased() ==
                (origin.host ?? "").lowercased(),
              let body = message.body as? [String: Any]
        else { return }
        // The unreachable-origin page's Retry button.
        if body["action"] as? String == "retry" {
            webView.load(request(for: startupNavigation.path))
            return
        }
        if body["action"] as? String == "workspaceHome" {
            loadWorkspaceHome()
            return
        }
        if body["action"] as? String == "signOut" {
            onSignOutRequested()
            return
        }
        if body["action"] as? String == "assistantStatus" {
            codexStatus()
            return
        }
        if body["action"] as? String == "assistantConnect" {
            connectCodex()
            return
        }
        if body["action"] as? String == "assistantDisconnect" {
            disconnectCodex()
            return
        }
        if body["action"] as? String == "assistantCancel" {
            cancelCodexTurn(
                requestedConversationID: body["conversationId"] as? String)
            return
        }
        if body["action"] as? String == "assistantTurn",
           let prompt = body["prompt"] as? String {
            sendCodexTurn(
                prompt,
                conversationID: body["conversationId"] as? String ?? "legacy",
                history: body["history"] as? [[String: Any]] ?? [])
            return
        }
        if body["action"] as? String == "assistantTools",
           let tools = body["tools"] as? [[String: Any]] {
            codexDynamicTools = tools.map { tool in
                ["type": "function", "name": tool["name"] ?? "", "description": tool["description"] ?? "", "inputSchema": tool["inputSchema"] ?? [:]]
            }
            Self.codexLog.info(
                "registered \(self.codexDynamicTools.count, privacy: .public) in-app tools")
            return
        }
        // Local MCP cannot use the durable exact-argument owner review required
        // for every external tool call, so even the standalone bridge refuses
        // it. Do not read a URL, token, headers, or payload from web content.
        if body["action"] as? String == "localMcpRequest",
           let requestId = body["requestId"] as? String {
            emitCodexEvent([
                "type": "local-mcp-response",
                "requestId": requestId,
                "error": "Local MCP execution is disabled until it can use durable owner review.",
            ])
            return
        }
        if body["action"] as? String == "assistantToolResult",
           let callId = body["callId"] as? String,
           let requestId = codexPendingToolCalls.removeValue(forKey: callId) {
            codexToolDeadlines.removeValue(forKey: callId)?.cancel()
            let output = body["output"] ?? NSNull()
            let success = !(body["isError"] as? Bool ?? false)
            Self.codexLog.info(
                "tool returned success=\(success, privacy: .public)")
            let text: String
            if let data = try? JSONSerialization.data(withJSONObject: output), let encoded = String(data: data, encoding: .utf8) { text = encoded } else { text = String(describing: output) }
            try? codexServer?.respond(
                id: requestId,
                result: CodexAppServerRequests.dynamicToolResult(text: text, success: success))
            return
        }
        guard body["action"] as? String == "linked",
              let token = body["token"] as? String,
              let originString = body["origin"] as? String,
              let linkedOrigin = URL(string: originString)
        else { return }
        appToken = token
        onLinked(token, linkedOrigin)
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           navigationAction.targetFrame?.isMainFrame != false,
           isAuthenticationHost(url) {
            decisionHandler(.cancel)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onSystemSignInRequested()
                // Cancelling leaves the page exactly as it was, which means the
                // button the person just pressed stays in its pending state -
                // "Continuing with Apple" forever. Nothing tells the page the
                // navigation was taken away from it, so from the outside the
                // button simply does nothing, whether or not the browser
                // opened behind the window. Reload so the form returns to rest.
                self.webView.reload()
            }
            return
        }
        // Workspace-home URLs are public reader surfaces. Inside the native
        // shell, a title/back link must return through the authenticated entry
        // point instead, re-exchanging the app token if the web cookie expired.
        if let url = navigationAction.request.url,
           navigationAction.targetFrame?.isMainFrame != false,
           navigationAction.navigationType == .linkActivated,
           Self.isPublicWorkspaceHome(url, on: origin) {
            decisionHandler(.cancel)
            DispatchQueue.main.async { [weak self] in
                self?.loadWorkspaceHome()
            }
            return
        }
        if let url = navigationAction.request.url,
           navigationAction.navigationType == .linkActivated,
           !isInApp(url) {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        guard let response = navigationResponse.response as? HTTPURLResponse,
              let url = response.url,
              isSessionExchange(url),
              response.statusCode >= 400
        else {
            decisionHandler(.allow)
            return
        }

        guard let recoveryPath = Self.sessionRecoveryPath(
            for: response.statusCode
        ) else {
            decisionHandler(.allow)
            return
        }

        decisionHandler(.cancel)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if response.statusCode == 401 || response.statusCode == 403 {
                // A token from a retired or reset database must never leave
                // the native window as a blank WebKit surface. Keep a useful
                // sign-in state visible while the system-browser device flow
                // replaces the stale credential.
                self.appToken = nil
                self.webView.load(self.request(for: recoveryPath))
                self.onSystemSignInRequested()
            } else {
                self.webView.load(self.request(for: recoveryPath))
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.title = webView.title?.isEmpty == false ? webView.title! : "TextText"
        logLayoutDiagnostics(webView)
    }

    /// Dev builds only: one line of layout truth per load, because the class
    /// of bug where the page overflows or reserves phantom space is invisible
    /// from outside the web view and has burned days of guessing. Read it with
    /// `log stream --predicate 'subsystem == "app.texttext.mac"'`.
    private func logLayoutDiagnostics(_ webView: WKWebView) {
        guard origin.scheme == "http" else { return }
        let probe = """
        (() => { try {
          const r = s => { const e = document.querySelector(s);
            if (!e) return null; const b = e.getBoundingClientRect();
            return { x: Math.round(b.x), w: Math.round(b.width) }; };
          return JSON.stringify({
            vw: document.documentElement.clientWidth,
            vh: document.documentElement.clientHeight,
            scrollW: document.documentElement.scrollWidth,
            scrollX: Math.round(window.scrollX),
            dpr: window.devicePixelRatio,
            sidebar: r('.workspace-sidebar, [class*="workspace-sidebar"]'),
            content: r('.post-editor-content'),
            rail: (() => { const e = document.querySelector('.workspace-assistant-shell');
              if (!e) return null; const b = e.getBoundingClientRect();
              return { x: Math.round(b.x), w: Math.round(b.width), state: e.dataset.state }; })(),
            saved: {
              state: localStorage.getItem('texttext:workspace-assistant-state'),
              width: localStorage.getItem('texttext:workspace-assistant-width'),
            },
          });
        } catch (e) { return "probe failed: " + e; } })()
        """
        webView.evaluateJavaScript(probe) { result, _ in
            guard let line = result as? String else { return }
            // The unified log filters third-party NSLog unpredictably; a dev
            // diagnostic that sometimes vanishes is worse than none. A plain
            // file in the temp dir is boring and always there.
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("texttext-layout.log")
            let stamped = "\(Date()) \(line)\n"
            if let data = stamped.data(using: .utf8) {
                if let handle = try? FileHandle(forWritingTo: url) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    try? handle.close()
                } else {
                    try? data.write(to: url)
                }
            }
        }
    }

    // A window is a native shell around the web app, so an origin that does not
    // answer used to leave a blank white rectangle with no explanation: it
    // looks exactly like the app being broken. Say what it tried to reach and
    // what to do about it.
    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showUnreachable(error)
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        showUnreachable(error)
    }

    private func showUnreachable(_ error: Error) {
        let failure = error as NSError
        // -999 is "a newer navigation replaced this one", which is normal.
        if failure.code == NSURLErrorCancelled { return }
        // Which URL, and which failure. "Cannot reach" with neither is a dead
        // end: a policy cancel, a DNS failure and a refused connection all read
        // the same, and the difference is the whole diagnosis.
        let failingURL =
            (failure.userInfo[NSURLErrorFailingURLStringErrorKey] as? String)
            ?? (failure.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.absoluteString
            ?? webView.url?.absoluteString
            ?? origin.absoluteString
        Self.webLog.error(
            "navigation failed: \(failure.domain, privacy: .public) \(failure.code, privacy: .public) at \(failingURL, privacy: .public)")
        window?.title = "TextText"
        let isLocal = ["localhost", "127.0.0.1", "::1"].contains(origin.host ?? "")
        let hint = isLocal
            ? "Start the web app in a terminal, then press Retry:"
            : "Check that the server is reachable, then press Retry:"
        let command = isLocal
            ? "npm run dev        # in your TextText checkout"
            : "TEXTTEXT_SERVER=&lt;origin&gt; npm run mac:dev"
        let reason = (error as NSError).localizedDescription
        let html = """
        <!doctype html><meta charset="utf-8">
        <meta name="color-scheme" content="light dark">
        <style>
          body{margin:0;display:grid;place-items:center;min-height:100vh;
            font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
            color:#1d1d1f;background:#fff}
          main{width:min(30rem,calc(100% - 4rem))}
          h1{font-size:19px;margin:0 0 .4rem}
          p{margin:0 0 1rem;color:#6e6e73}
          code{display:block;padding:.7rem .8rem;border-radius:8px;
            background:rgba(118,118,128,.12);
            font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1d1d1f}
          button{margin-top:1.2rem;min-height:32px;padding:0 14px;border:0;
            border-radius:8px;background:#0071e3;color:#fff;font:600 14px/1 inherit;
            cursor:pointer}
          @media(prefers-color-scheme:dark){
            body{color:#f5f5f7;background:#1c1c1e}p{color:#a1a1a6}
            code{background:rgba(118,118,128,.24);color:#f5f5f7}}
        </style>
        <main>
          <h1>Cannot reach \(origin.absoluteString)</h1>
          <p>\(reason) (\(failure.domain) \(failure.code))</p>
          <p>\(failingURL)</p>
          <p>\(hint)</p>
          <code>\(command)</code>
          <button onclick="window.webkit.messageHandlers.textTextApp.postMessage({action:'retry'})">
            Retry
          </button>
        </main>
        """
        webView.loadHTMLString(html, baseURL: origin)
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isAuthenticationHost(url) {
                onSystemSignInRequested()
            } else {
                openExternally(url)
            }
        }
        return nil
    }
}
