import AppKit
import WebKit

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

/// The main window: the full Write web experience in a native window. The app
/// is account-gated, so it opens on the sign-in flow (never the public landing)
/// until the account signs in. That one sign-in both authenticates the web view
/// and, on an unlinked Mac, mints a sync token: an injected script POSTs
/// /api/app/token from the first signed-in page and hands the token back over
/// the `writeApp` bridge, so linking is invisible (no code, no approval page).
final class WebAppWindowController: NSWindowController, WKNavigationDelegate,
    WKUIDelegate, WKScriptMessageHandler {
    private let origin: URL
    private var webView: WKWebView!
    /// Called with (token, origin) when the web view links this Mac.
    private let onLinked: (String, URL) -> Void
    private var startupNavigation: WebAppStartupNavigation
    /// On-device AI over the `nativeAI` bridge; owned here, weak-proxied into
    /// the user content controller like the `writeApp` handler.
    private let aiBridge = NativeAIBridge()

    static let cacheWebView = true

    private static let authHosts: Set<String> = [
        "accounts.google.com",
        "appleid.apple.com",
    ]

    // A normal macOS Safari user agent so identity providers run their OAuth
    // flow inside the app instead of refusing an embedded web view.
    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    /// - needsToken: true on an unlinked Mac. The web view then mints a sync
    ///   token in the background as soon as it lands on a signed-in page and
    ///   hands it back over `writeApp` (see the mint script below); a linked
    ///   Mac skips minting entirely and just opens the workspace.
    init(
        origin: URL,
        startPath: String,
        needsToken: Bool,
        onLinked: @escaping (String, URL) -> Void
    ) {
        self.origin = origin
        self.onLinked = onLinked
        self.startupNavigation = WebAppStartupNavigation(path: startPath)

        Self.configureURLCacheForStartup()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // login sticks across launches

        let ucc = WKUserContentController()
        let device = Host.current().localizedName ?? "this Mac"
        let escapedDevice = device.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        // The server reads none of this; it is the client contract with the web
        // app (AppLinkBridge / mint script). __WRITE_NEEDS_TOKEN__ gates minting
        // so a linked Mac never spends a token on every launch.
        //
        // Guarded to the app's own origin: forMainFrameOnly still injects this on
        // EVERY navigation, including the Google/Apple OAuth pages this window
        // visits mid-sign-in. Without the host check the device NAME would be
        // written into those third-party page contexts (and the mint script,
        // which keys off __WRITE_APP__, would fire there too).
        ucc.addUserScript(WKUserScript(
            source: """
            (function () {
              var h = location.hostname, base = "\(origin.host ?? "")";
              if (base && h !== base && !h.endsWith("." + base)) return;
              window.__WRITE_APP__ = true;
              window.__WRITE_DEVICE__ = "\(escapedDevice)";
              window.__WRITE_NEEDS_TOKEN__ = \(needsToken ? "true" : "false");
            })();
            """,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // On-device AI: same origin gate as the flags above, so the bridge
        // never exists in third-party OAuth page contexts.
        ucc.addUserScript(WKUserScript(
            source: """
            (function () {
              var h = location.hostname, base = "\(origin.host ?? "")";
              if (base && h !== base && !h.endsWith("." + base)) return;
              \(NativeAIBridge.shimScript)
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
        webView.customUserAgent = Self.userAgent
        webView.allowsBackForwardNavigationGestures = true
        self.webView = webView

        let window = NSWindow(
            contentRect: webView.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Texttext"
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = webView
        window.setFrameAutosaveName("WriteMainWindow")
        window.tabbingMode = .disallowed

        super.init(window: window)
        // Registered AFTER super.init so self is available; the weak proxy
        // keeps the retain cycle from pinning the window open.
        ucc.add(WeakScriptHandler(self), name: "writeApp")
        aiBridge.webView = webView
        ucc.add(WeakScriptHandler(aiBridge), name: NativeAIBridge.handlerName)
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
            self.webView.load(self.request(for: path))
        }
    }

    // Minting runs entirely client-side; the token is bound to the signed-in
    // session cookie and the x-write-app header keeps the route from being
    // driven cross-site.
    private static let mintScript = """
    (function () {
      if (!window.__WRITE_APP__ || !window.__WRITE_NEEDS_TOKEN__) return;
      try { if (sessionStorage.getItem("__write_linked")) return; } catch (e) {}
      var mh = window.webkit && window.webkit.messageHandlers
        && window.webkit.messageHandlers.writeApp;
      if (!mh) return;
      fetch("/api/app/token", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-write-app": "1",
          "x-write-device": window.__WRITE_DEVICE__ || "this Mac"
        }
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.token) {
            try { sessionStorage.setItem("__write_linked", "1"); } catch (e) {}
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
        if host == origin.host?.lowercased() { return true }
        return Self.authHosts.contains(host)
    }

    private func openExternally(_ url: URL) {
        guard url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto"
        else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: WKScriptMessageHandler (JS -> Swift)

    func userContentController(
        _ ucc: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard message.name == "writeApp",
              let body = message.body as? [String: Any],
              body["action"] as? String == "linked",
              let token = body["token"] as? String,
              let originString = body["origin"] as? String,
              let linkedOrigin = URL(string: originString)
        else { return }
        onLinked(token, linkedOrigin)
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           navigationAction.navigationType == .linkActivated,
           !isInApp(url) {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.title = webView.title?.isEmpty == false ? webView.title! : "Texttext"
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { openExternally(url) }
        return nil
    }
}
