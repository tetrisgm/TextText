import AppKit
import WebKit

/// A separate reader for the original profile. It has no message handler,
/// native workspace commands, account credential, or network transport.
@MainActor
final class LegacyDraftsWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let entry: URL
    let webView: WKWebView
    init(entry: URL, dataStore: WKWebsiteDataStore = .default()) {
        self.entry = entry
        let config = WKWebViewConfiguration(); config.websiteDataStore = dataStore
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 720), configuration: config)
        let window = NSWindow(contentRect: webView.frame, styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Older TextText drafts"; window.contentView = webView; window.minSize = NSSize(width: 600, height: 420)
        super.init(window: window)
        webView.navigationDelegate = self; webView.uiDelegate = self
        webView.loadFileURL(entry, allowingReadAccessTo: entry.deletingLastPathComponent())
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    func present() { showWindow(nil); window?.makeKeyAndOrderFront(nil) }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload, action.request.url?.scheme == "blob" { decisionHandler(.download) }
        else { decisionHandler(action.request.url?.standardizedFileURL == entry.standardizedFileURL ? .allow : .cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let window else { completionHandler(nil); return }
        let panel = NSSavePanel(); panel.title = "Save recovery copy"
        panel.nameFieldStringValue = LocalVaultWindowController.downloadFileName(suggested: suggestedFilename)
        panel.beginSheetModal(for: window) { answer in
            guard answer == .OK, let destination = panel.url, !FileManager.default.fileExists(atPath: destination.path) else { completionHandler(nil); return }
            completionHandler(destination)
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let window else { return }
        let alert = NSAlert(); alert.messageText = "The recovery copy could not be saved."
        alert.informativeText = "Choose a new filename and try again. The original drafts remain in this profile."
        alert.beginSheetModal(for: window)
    }
}
