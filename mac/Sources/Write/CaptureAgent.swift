import AppKit
import Foundation
import WebKit

/// Bookmark capture agent: drains GET /api/sync/v1/captures on this Mac,
/// loading each pending URL in an offscreen WKWebView to produce the
/// readable extraction, the original page HTML, and a full screenshot, then
/// PUTs the result to /api/sync/v1/captures/{id} as multipart/form-data
/// (fields: meta JSON, readable text, screenshot PNG, html file).
final class CaptureAgent {
    private let store: StateStore
    private let queue = DispatchQueue(label: "write.capture-agent", qos: .utility)
    private let stateLock = NSLock()
    private let session: URLSession
    private var draining = false
    private var pendingDrain = false

    private let maxArtifactBytes = 25 * 1024 * 1024

    var onActivity: ((String) -> Void)?

    init(store: StateStore) {
        self.store = store
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.waitsForConnectivity = false
        config.httpAdditionalHeaders = ["User-Agent": "Write-Mac/\(appVersion)"]
        self.session = URLSession(configuration: config)
    }

    /// Begin watching for pending captures (called once at launch).
    func start() {
        poke()
    }

    /// Check for pending captures now (called after each remote change).
    func poke() {
        var shouldStart = false
        stateLock.lock()
        if draining {
            pendingDrain = true
        } else {
            draining = true
            shouldStart = true
        }
        stateLock.unlock()

        guard shouldStart else { return }
        queue.async { [weak self] in self?.drain() }
    }

    private func drain() {
        guard let credentials = store.loadCredentials() else {
            completeDrain()
            return
        }

        let origin = resolveServerOrigin(credentials: credentials)
        let captures = fetchCaptures(origin: origin, token: credentials.token)
        for capture in captures {
            process(capture, origin: origin, token: credentials.token)
        }
        completeDrain()
    }

    private func completeDrain() {
        var shouldContinue = false
        stateLock.lock()
        if pendingDrain {
            pendingDrain = false
            shouldContinue = true
        } else {
            draining = false
        }
        stateLock.unlock()

        guard shouldContinue else { return }
        queue.async { [weak self] in self?.drain() }
    }

    private func fetchCaptures(origin: URL, token: String) -> [PendingCapture] {
        guard let url = endpoint(origin: origin, path: "/api/sync/v1/captures") else { return [] }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        switch send(request) {
        case .failure:
            return []
        case .success(let reply):
            guard reply.status == 200,
                  let response = try? JSONDecoder().decode(CapturesResponse.self, from: reply.data) else {
                return []
            }
            return response.captures
        }
    }

    private func process(_ capture: PendingCapture, origin: URL, token: String) {
        guard let sourceURL = URL(string: capture.url), sourceURL.scheme != nil else {
            let reason = "bad URL"
            _ = uploadFailure(capture: capture, origin: origin, token: token,
                              url: capture.url, reason: reason)
            activity("capture failed \(capture.slug): \(reason)")
            return
        }

        switch capturePage(url: sourceURL, fallbackTitle: capture.title) {
        case .failure(let failure):
            _ = uploadFailure(capture: capture, origin: origin, token: token,
                              url: failure.url.absoluteString, reason: failure.reason)
            activity("capture failed \(host(for: failure.url)): \(failure.reason)")
        case .success(let page):
            guard Data(page.readable.utf8).count <= maxArtifactBytes,
                  page.screenshot.count <= maxArtifactBytes,
                  page.html.count <= maxArtifactBytes else {
                let reason = "artifact too large"
                _ = uploadFailure(capture: capture, origin: origin, token: token,
                                  url: page.finalURL.absoluteString, reason: reason)
                activity("capture failed \(host(for: page.finalURL)): \(reason)")
                return
            }

            switch uploadSuccess(capture: capture, origin: origin, token: token, page: page) {
            case .failure(let reason):
                activity("capture failed \(host(for: page.finalURL)): \(reason)")
            case .success:
                activity("captured \(host(for: page.finalURL))")
            }
        }
    }

    private func capturePage(url: URL, fallbackTitle: String?) -> Result<PageCapture, PageCaptureFailure> {
        var result: Result<PageCapture, PageCaptureFailure>?
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            let capture = BookmarkPageCapture(url: url, fallbackTitle: fallbackTitle) { pageResult in
                result = pageResult
                semaphore.signal()
            }
            capture.start()
        }
        semaphore.wait()
        return result ?? .failure(PageCaptureFailure(url: url, reason: "capture cancelled"))
    }

    private func uploadFailure(
        capture: PendingCapture, origin: URL, token: String, url: String, reason: String
    ) -> Bool {
        let meta = CaptureMeta(url: url, capturedBy: "mac", error: reason)
        guard let body = multipartBody(meta: meta) else { return false }
        return upload(capture: capture, origin: origin, token: token, body: body).isSuccess
    }

    private func uploadSuccess(
        capture: PendingCapture, origin: URL, token: String, page: PageCapture
    ) -> Result<Void, CaptureAgentError> {
        let meta = CaptureMeta(
            url: page.finalURL.absoluteString,
            title: page.title,
            siteName: page.siteName,
            description: page.description,
            capturedBy: "mac",
            error: nil
        )
        guard let body = multipartBody(
            meta: meta,
            readable: page.readable,
            screenshot: page.screenshot,
            html: page.html
        ) else {
            return .failure(CaptureAgentError("could not encode upload"))
        }
        return upload(capture: capture, origin: origin, token: token, body: body)
    }

    private func upload(
        capture: PendingCapture, origin: URL, token: String, body: MultipartBody
    ) -> Result<Void, CaptureAgentError> {
        guard let url = endpoint(origin: origin, path: "/api/sync/v1/captures/\(capture.id)") else {
            return .failure(CaptureAgentError("bad upload URL"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.httpBody = body.data
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(body.boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.data.count), forHTTPHeaderField: "Content-Length")

        switch send(request) {
        case .failure(let reason):
            return .failure(reason)
        case .success(let reply):
            guard reply.status == 200 else {
                return .failure(CaptureAgentError(httpErrorMessage(status: reply.status, data: reply.data)))
            }
            return .success(())
        }
    }

    private func multipartBody(
        meta: CaptureMeta, readable: String? = nil, screenshot: Data? = nil, html: Data? = nil
    ) -> MultipartBody? {
        guard let metaData = try? JSONEncoder().encode(meta),
              let metaJSON = String(data: metaData, encoding: .utf8) else {
            return nil
        }

        let boundary = "----WriteCapture\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var data = Data()
        appendField(name: "meta", value: metaJSON, contentType: "application/json; charset=utf-8",
                    to: &data, boundary: boundary)
        if let readable {
            appendField(name: "readable", value: readable, contentType: "text/markdown; charset=utf-8",
                        to: &data, boundary: boundary)
        }
        if let screenshot {
            appendFile(name: "screenshot", filename: "screenshot.png", contentType: "image/png",
                       fileData: screenshot, to: &data, boundary: boundary)
        }
        if let html {
            appendFile(name: "html", filename: "page.html", contentType: "text/html; charset=utf-8",
                       fileData: html, to: &data, boundary: boundary)
        }
        data.appendUTF8("--\(boundary)--\r\n")
        return MultipartBody(data: data, boundary: boundary)
    }

    private func appendField(
        name: String, value: String, contentType: String, to data: inout Data, boundary: String
    ) {
        data.appendUTF8("--\(boundary)\r\n")
        data.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"\r\n")
        data.appendUTF8("Content-Type: \(contentType)\r\n\r\n")
        data.appendUTF8(value)
        data.appendUTF8("\r\n")
    }

    private func appendFile(
        name: String, filename: String, contentType: String, fileData: Data,
        to data: inout Data, boundary: String
    ) {
        data.appendUTF8("--\(boundary)\r\n")
        data.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        data.appendUTF8("Content-Type: \(contentType)\r\n\r\n")
        data.append(fileData)
        data.appendUTF8("\r\n")
    }

    private func send(_ request: URLRequest) -> Result<NetworkReply, CaptureAgentError> {
        var result: Result<NetworkReply, CaptureAgentError> = .failure(CaptureAgentError("no response"))
        let semaphore = DispatchSemaphore(value: 0)
        session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error {
                result = .failure(CaptureAgentError(error.localizedDescription))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                result = .failure(CaptureAgentError("not an HTTP response"))
                return
            }
            result = .success(NetworkReply(status: http.statusCode, data: data ?? Data()))
        }.resume()
        semaphore.wait()
        return result
    }

    private func endpoint(origin: URL, path: String) -> URL? {
        var raw = origin.absoluteString
        while raw.hasSuffix("/") { raw.removeLast() }
        return URL(string: raw + path)
    }

    private func host(for url: URL) -> String {
        url.host ?? url.absoluteString
    }

    private func httpErrorMessage(status: Int, data: Data) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let message = object["error"] as? String, !message.isEmpty {
            return "HTTP \(status): \(message)"
        }
        return "HTTP \(status)"
    }

    private func activity(_ message: String) {
        if Thread.isMainThread {
            onActivity?(message)
        } else {
            DispatchQueue.main.async { [weak self] in self?.onActivity?(message) }
        }
    }
}

private final class BookmarkPageCapture: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let requestedURL: URL
    private let fallbackTitle: String?
    private let completion: (Result<PageCapture, PageCaptureFailure>) -> Void
    private var webView: WKWebView?
    private var loadTimeout: DispatchWorkItem?
    private var settleDelay: DispatchWorkItem?
    private var completed = false

    init(
        url: URL, fallbackTitle: String?,
        completion: @escaping (Result<PageCapture, PageCaptureFailure>) -> Void
    ) {
        self.requestedURL = url
        self.fallbackTitle = fallbackTitle
        self.completion = completion
    }

    func start() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.start() }
            return
        }

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let view = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 1280, height: 2000),
            configuration: configuration
        )
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = false
        webView = view

        let timeout = DispatchWorkItem { self.fail(url: self.currentURL, reason: "timeout") }
        loadTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)

        var request = URLRequest(url: requestedURL)
        request.timeoutInterval = 30
        view.load(request)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !completed else { return }
        loadTimeout?.cancel()
        loadTimeout = nil

        let delay = DispatchWorkItem { self.extract() }
        settleDelay = delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: delay)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !isCancelled(error) else { return }
        fail(url: currentURL, reason: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !isCancelled(error) else { return }
        fail(url: currentURL, reason: error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        completionHandler()
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(false)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        completionHandler(nil)
    }

    private func extract() {
        guard let webView, !completed else { return }
        webView.evaluateJavaScript(readableExtractionScript) { value, error in
            if let error {
                self.fail(url: self.currentURL, reason: error.localizedDescription)
                return
            }
            guard let json = value as? String,
                  let data = json.data(using: .utf8),
                  let extracted = try? JSONDecoder().decode(ReadableExtraction.self, from: data) else {
                self.fail(url: self.currentURL, reason: "readable extraction failed")
                return
            }
            if let ok = extracted.ok, !ok {
                self.fail(url: self.currentURL, reason: extracted.error ?? "readable extraction failed")
                return
            }
            guard let contentType = extracted.contentType?.lowercased(),
                  contentType.contains("html") else {
                self.fail(url: self.currentURL, reason: "non-HTML content")
                return
            }
            self.extractHTML(readable: extracted)
        }
    }

    private func extractHTML(readable: ReadableExtraction) {
        guard let webView, !completed else { return }
        webView.evaluateJavaScript("document.documentElement ? document.documentElement.outerHTML : ''") { value, error in
            if let error {
                self.fail(url: self.currentURL, reason: error.localizedDescription)
                return
            }
            guard let html = value as? String, !html.isEmpty,
                  let htmlData = html.data(using: .utf8) else {
                self.fail(url: self.currentURL, reason: "HTML extraction failed")
                return
            }
            self.takeScreenshot(readable: readable, html: htmlData)
        }
    }

    private func takeScreenshot(readable: ReadableExtraction, html: Data) {
        guard let webView, !completed else { return }
        webView.frame = NSRect(x: 0, y: 0, width: 1280, height: 2000)
        webView.layoutSubtreeIfNeeded()

        let config = WKSnapshotConfiguration()
        config.rect = NSRect(x: 0, y: 0, width: 1280, height: 2000)
        webView.takeSnapshot(with: config) { image, error in
            if let error {
                self.fail(url: self.currentURL, reason: error.localizedDescription)
                return
            }
            guard let image,
                  let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                self.fail(url: self.currentURL, reason: "screenshot failed")
                return
            }

            let title = self.cleaned(readable.title) ?? self.cleaned(self.fallbackTitle)
            let page = PageCapture(
                finalURL: self.currentURL,
                title: title,
                siteName: self.cleaned(readable.siteName),
                description: self.cleaned(readable.description),
                readable: self.markdown(from: readable, title: title),
                screenshot: png,
                html: html
            )
            self.finish(.success(page))
        }
    }

    private func markdown(from readable: ReadableExtraction, title: String?) -> String {
        let finalURL = currentURL
        let host = finalURL.host ?? finalURL.absoluteString
        var parts = ["[\(host)](\(finalURL.absoluteString))"]
        if let title { parts.append("# \(title)") }
        for paragraph in readable.paragraphs ?? [] {
            guard let cleaned = cleaned(paragraph) else { continue }
            parts.append(cleaned)
        }
        return parts.joined(separator: "\n\n")
    }

    private func fail(url: URL, reason: String) {
        finish(.failure(PageCaptureFailure(url: url, reason: reason)))
    }

    private func finish(_ result: Result<PageCapture, PageCaptureFailure>) {
        guard !completed else { return }
        completed = true
        loadTimeout?.cancel()
        settleDelay?.cancel()
        loadTimeout = nil
        settleDelay = nil
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView = nil
        completion(result)
    }

    private var currentURL: URL {
        webView?.url ?? requestedURL
    }

    private func cleaned(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private func isCancelled(_ error: Error) -> Bool {
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled
    }
}

private let readableExtractionScript = #"""
(function() {
  try {
    function attr(selector, name) {
      var el = document.querySelector(selector);
      if (!el) return "";
      return (el.getAttribute(name) || "").trim();
    }
    function text(selector) {
      var el = document.querySelector(selector);
      if (!el) return "";
      return (el.textContent || "").trim();
    }
    function clean(value) {
      return (value || "").replace(/[ \t]+/g, " ").trim();
    }

    var title = clean(attr('meta[property="og:title"]', "content")) ||
      clean(text("title")) ||
      clean(document.title);
    var siteName = clean(attr('meta[property="og:site_name"]', "content"));
    var description = clean(attr('meta[property="og:description"]', "content")) ||
      clean(attr('meta[name="description"]', "content"));
    var root = document.querySelector("article") ||
      document.querySelector("main") ||
      document.body;
    var raw = root ? (root.innerText || root.textContent || "") : "";
    var blocks = raw.replace(/\r/g, "\n").split(/\n{2,}/);
    var paragraphs = [];
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split(/\n+/).map(clean).filter(Boolean);
      var paragraph = lines.join(" ");
      if (paragraph) paragraphs.push(paragraph);
    }

    return JSON.stringify({
      ok: true,
      contentType: document.contentType || "",
      title: title,
      siteName: siteName,
      description: description,
      paragraphs: paragraphs
    });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: String((e && e.message) || e || "extraction failed")
    });
  }
})();
"""#

private struct CapturesResponse: Decodable {
    let captures: [PendingCapture]
}

private struct PendingCapture: Decodable {
    let id: String
    let slug: String
    let title: String?
    let url: String
}

private struct CaptureMeta: Encodable {
    let url: String
    var title: String?
    var siteName: String?
    var description: String?
    let capturedBy: String
    var error: String?
}

private struct PageCapture {
    let finalURL: URL
    let title: String?
    let siteName: String?
    let description: String?
    let readable: String
    let screenshot: Data
    let html: Data
}

private struct PageCaptureFailure: Error {
    let url: URL
    let reason: String
}

private struct CaptureAgentError: Error, CustomStringConvertible {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var description: String { message }
}

private struct ReadableExtraction: Decodable {
    let ok: Bool?
    let error: String?
    let contentType: String?
    let title: String?
    let siteName: String?
    let description: String?
    let paragraphs: [String]?
}

private struct NetworkReply {
    let status: Int
    let data: Data
}

private struct MultipartBody {
    let data: Data
    let boundary: String
}

private extension Result where Success == Void, Failure == CaptureAgentError {
    var isSuccess: Bool {
        guard case .success = self else { return false }
        return true
    }
}

private extension Data {
    mutating func appendUTF8(_ string: String) {
        append(Data(string.utf8))
    }
}
