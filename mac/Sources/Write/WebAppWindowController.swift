import AppKit
import WebKit

/// The main window: the full Write web experience in a native window, so the
/// app is the workspace (write, edit, publish, share) and not only a sync
/// status pane. It loads the product origin in a WKWebView with a persistent
/// session, so signing in inside the app sticks across launches.
///
/// Link policy:
/// - Same-origin navigation and OAuth redirects (Google, Apple, the callback
///   back to us) stay in the web view, so sign-in completes in the app.
/// - A user clicking a third-party link, or any target=_blank / window.open,
///   opens in the default browser instead of a stray in-app window.
final class WebAppWindowController: NSWindowController, WKNavigationDelegate,
    WKUIDelegate {
    private let origin: URL
    private var webView: WKWebView!

    // Hosts that must stay inside the web view for sign-in to work.
    private static let authHosts: Set<String> = [
        "accounts.google.com",
        "appleid.apple.com",
    ]

    // A normal macOS Safari user agent: some identity providers refuse to run
    // their OAuth flow inside an obviously-embedded web view, and this keeps
    // the site treating the app like a real browser.
    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

    init(origin: URL) {
        self.origin = origin

        let config = WKWebViewConfiguration()
        // Default (persistent) store so the login cookie survives relaunch.
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: config)
        webView.customUserAgent = Self.userAgent
        webView.allowsBackForwardNavigationGestures = true
        self.webView = webView

        let window = NSWindow(
            contentRect: webView.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Write"
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = webView
        window.setFrameAutosaveName("WriteMainWindow")
        window.tabbingMode = .disallowed

        super.init(window: window)
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

    /// Show the window, loading the site the first time.
    func present() {
        if webView.url == nil {
            webView.load(URLRequest(url: origin))
        }
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    /// Reload from the origin (used after a relink or a sign-in change).
    func reloadFromOrigin() {
        webView.load(URLRequest(url: origin))
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

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           navigationAction.navigationType == .linkActivated,
           !isInApp(url) {
            // A user-clicked third-party link goes to the default browser.
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
        // target=_blank / window.open: open in the default browser, never a
        // stray in-app window.
        if let url = navigationAction.request.url { openExternally(url) }
        return nil
    }
}
