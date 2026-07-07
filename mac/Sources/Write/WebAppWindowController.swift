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

/// The main window: the full Write web experience in a native window. The app
/// is account-gated, so it opens on the sign-in flow (never the public
/// landing) until the Mac is linked. One in-app sign-in both authenticates the
/// web view and, on a fresh Mac, mints a sync token which the web page hands
/// back over the `writeApp` bridge (see AppLinkBridge on the web side).
final class WebAppWindowController: NSWindowController, WKNavigationDelegate,
    WKUIDelegate, WKScriptMessageHandler {
    private let origin: URL
    private var webView: WKWebView!
    /// Called with (token, origin) when the web view links this Mac.
    private let onLinked: (String, URL) -> Void

    private static let authHosts: Set<String> = [
        "accounts.google.com",
        "appleid.apple.com",
    ]

    // A normal macOS Safari user agent so identity providers run their OAuth
    // flow inside the app instead of refusing an embedded web view.
    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    init(origin: URL, startPath: String, onLinked: @escaping (String, URL) -> Void) {
        self.origin = origin
        self.onLinked = onLinked

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // login sticks across launches

        let ucc = WKUserContentController()
        let device = Host.current().localizedName ?? "this Mac"
        let escapedDevice = device.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        ucc.addUserScript(WKUserScript(
            source: "window.__WRITE_APP__ = true; window.__WRITE_DEVICE__ = \"\(escapedDevice)\";",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
        window.title = "Write"
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = webView
        window.setFrameAutosaveName("WriteMainWindow")
        window.tabbingMode = .disallowed

        super.init(window: window)
        // Registered AFTER super.init so self is available; the weak proxy
        // keeps the retain cycle from pinning the window open.
        ucc.add(WeakScriptHandler(self), name: "writeApp")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: url(for: startPath)))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

    private func url(for path: String) -> URL {
        URL(string: path, relativeTo: origin)?.absoluteURL ?? origin
    }

    func present() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    /// Navigate the web view to a path on the origin (used after linking).
    func load(path: String) {
        webView.load(URLRequest(url: url(for: path)))
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
        window?.title = webView.title?.isEmpty == false ? webView.title! : "Write"
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
