import AppKit
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers
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
    // Hard ceiling on a downloaded PDF before it is handed to PDFKit, so a
    // multi-gigabyte (or streaming) PDF cannot exhaust the agent's memory.
    private let maxPDFBytes = 64 * 1024 * 1024
    private let maxReadableBytes = 2 * 1024 * 1024
    private let uploadRetryDelays: [TimeInterval] = [2, 6, 18]

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
            let result = uploadFailure(capture: capture, origin: origin, token: token,
                                       url: capture.url, reason: reason)
            switch result {
            case .success:
                activity("capture failed \(capture.slug): \(reason)")
            case .transient(let uploadReason):
                activity("capture pending \(capture.slug): \(uploadReason)")
            case .terminal(let uploadReason):
                activity("capture failed \(capture.slug): \(reason); upload rejected: \(uploadReason)")
            }
            return
        }

        switch self.capture(url: sourceURL, fallbackTitle: capture.title) {
        case .failure(let failure):
            let result = uploadFailure(capture: capture, origin: origin, token: token,
                                       url: failure.url.absoluteString, reason: failure.reason)
            reportFailureUpload(result, url: failure.url, reason: failure.reason)
        case .success(let page):
            let prepared: PreparedPageCapture
            switch prepare(page: page) {
            case .failure(let reason):
                let result = uploadFailure(capture: capture, origin: origin, token: token,
                                           url: page.finalURL.absoluteString, reason: reason.message)
                reportFailureUpload(result, url: page.finalURL, reason: reason.message)
                return
            case .success(let preparedPage):
                prepared = preparedPage
            }

            switch uploadSuccess(capture: capture, origin: origin, token: token, page: page, prepared: prepared) {
            case .success:
                activity("captured \(host(for: page.finalURL))")
            case .transient(let reason):
                activity("capture pending \(host(for: page.finalURL)): \(reason)")
            case .terminal(let reason):
                let failureReason = "upload rejected: \(reason.message)"
                let result = uploadFailure(capture: capture, origin: origin, token: token,
                                           url: page.finalURL.absoluteString, reason: failureReason)
                reportFailureUpload(result, url: page.finalURL, reason: failureReason)
            }
        }
    }

    private func reportFailureUpload(_ result: CaptureUploadResult, url: URL, reason: String) {
        switch result {
        case .success:
            activity("capture failed \(host(for: url)): \(reason)")
        case .transient(let uploadReason):
            activity("capture pending \(host(for: url)): \(uploadReason)")
        case .terminal(let uploadReason):
            activity("capture failed \(host(for: url)): \(reason); upload rejected: \(uploadReason)")
        }
    }

    private func capture(url: URL, fallbackTitle: String?) -> Result<PageCapture, PageCaptureFailure> {
        if isPDFURL(url) {
            return capturePDF(url: url, fallbackTitle: fallbackTitle)
        }
        if let pdfURL = pdfURLFromContentTypeProbe(url: url) {
            return capturePDF(url: pdfURL, fallbackTitle: fallbackTitle)
        }

        let result = capturePage(url: url, fallbackTitle: fallbackTitle)
        if case .failure(let failure) = result, failure.reason == pdfContentFailureReason {
            return capturePDF(url: failure.url, fallbackTitle: fallbackTitle)
        }
        return result
    }

    private func pdfURLFromContentTypeProbe(url: URL) -> URL? {
        guard isWebURL(url) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 15
        request.setValue("application/pdf,*/*;q=0.8", forHTTPHeaderField: "Accept")

        switch send(request) {
        case .failure:
            return nil
        case .success(let reply):
            guard (200..<400).contains(reply.status),
                  isPDFContentType(reply.contentType) else {
                return nil
            }
            return reply.finalURL ?? url
        }
    }

    private func capturePDF(url: URL, fallbackTitle: String?) -> Result<PageCapture, PageCaptureFailure> {
        switch fetchPDF(url: url) {
        case .failure(let failure):
            return .failure(failure)
        case .success(let pdf):
            return renderPDF(data: pdf.data, finalURL: pdf.finalURL, fallbackTitle: fallbackTitle)
        }
    }

    private func fetchPDF(url: URL) -> Result<PDFDownload, PageCaptureFailure> {
        if url.isFileURL {
            do {
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size > maxPDFBytes {
                    return .failure(PageCaptureFailure(url: url, reason: "PDF is too large"))
                }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                guard !data.isEmpty else {
                    return .failure(PageCaptureFailure(url: url, reason: "PDF download was empty"))
                }
                guard data.count <= maxPDFBytes else {
                    return .failure(PageCaptureFailure(url: url, reason: "PDF is too large"))
                }
                return .success(PDFDownload(data: data, finalURL: url))
            } catch {
                return .failure(PageCaptureFailure(url: url, reason: error.localizedDescription))
            }
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 60
        request.setValue("application/pdf,*/*;q=0.8", forHTTPHeaderField: "Accept")

        // Bounded download: a hostile or runaway PDF must not buffer gigabytes
        // into RAM. BoundedDownloader cancels the transfer the moment the body
        // exceeds the cap (and rejects a Content-Length that already exceeds
        // it), so memory stays bounded regardless of the server.
        switch BoundedDownloader.fetch(request, maxBytes: maxPDFBytes) {
        case .failure(let reason):
            return .failure(PageCaptureFailure(url: url, reason: reason.message))
        case .success(let reply):
            let finalURL = reply.finalURL ?? url
            guard (200..<300).contains(reply.status) else {
                return .failure(PageCaptureFailure(
                    url: finalURL,
                    reason: httpErrorMessage(status: reply.status, data: reply.data)
                ))
            }
            guard isPDFContentType(reply.contentType) || isPDFURL(finalURL) || isPDFURL(url) else {
                return .failure(PageCaptureFailure(url: finalURL, reason: "non-PDF content"))
            }
            guard !reply.data.isEmpty else {
                return .failure(PageCaptureFailure(url: finalURL, reason: "PDF download was empty"))
            }
            return .success(PDFDownload(data: reply.data, finalURL: finalURL))
        }
    }

    private func renderPDF(
        data: Data, finalURL: URL, fallbackTitle: String?
    ) -> Result<PageCapture, PageCaptureFailure> {
        var result: Result<PageCapture, PageCaptureFailure>?
        let semaphore = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            result = self.renderPDFOnMain(data: data, finalURL: finalURL, fallbackTitle: fallbackTitle)
            semaphore.signal()
        }
        semaphore.wait()
        return result ?? .failure(PageCaptureFailure(url: finalURL, reason: "PDF capture cancelled"))
    }

    private func renderPDFOnMain(
        data: Data, finalURL: URL, fallbackTitle: String?
    ) -> Result<PageCapture, PageCaptureFailure> {
        guard Thread.isMainThread else {
            return .failure(PageCaptureFailure(url: finalURL, reason: "PDF capture off main thread"))
        }
        guard let document = PDFDocument(data: data) else {
            return .failure(PageCaptureFailure(url: finalURL, reason: "PDF document failed to load"))
        }
        guard let text = cleaned(document.string) else {
            return .failure(PageCaptureFailure(url: finalURL, reason: "PDF text extraction failed"))
        }
        guard let screenshot = renderFirstPDFPage(document: document) else {
            return .failure(PageCaptureFailure(url: finalURL, reason: "PDF screenshot failed"))
        }

        let title = pdfTitle(document: document, fallbackTitle: fallbackTitle, url: finalURL)
        let page = PageCapture(
            finalURL: finalURL,
            title: title,
            siteName: nil,
            description: nil,
            readable: pdfMarkdown(text: text, url: finalURL, title: title),
            screenshot: screenshot,
            html: nil
        )
        return .success(page)
    }

    private func renderFirstPDFPage(document: PDFDocument) -> Data? {
        guard let page = document.page(at: 0) else { return nil }
        var box: PDFDisplayBox = .cropBox
        var bounds = page.bounds(for: .cropBox)
        if bounds.width <= 0 || bounds.height <= 0 {
            box = .mediaBox
            bounds = page.bounds(for: .mediaBox)
        }
        guard bounds.width > 0, bounds.height > 0 else { return nil }

        let targetWidth: CGFloat = 1280
        let targetHeight = max(1, bounds.height * (targetWidth / bounds.width))
        let targetSize = NSSize(width: targetWidth, height: targetHeight)
        let image = page.thumbnail(of: targetSize, for: box)
        return pngData(from: image, size: targetSize)
    }

    private func pdfTitle(document: PDFDocument, fallbackTitle: String?, url: URL) -> String? {
        if let title = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String,
           let cleaned = cleaned(title) {
            return cleaned
        }
        if let fallback = cleaned(fallbackTitle) {
            return fallback
        }
        return cleaned(url.deletingPathExtension().lastPathComponent.removingPercentEncoding)
    }

    private func pdfMarkdown(text: String, url: URL, title: String?) -> String {
        let host = url.host ?? url.absoluteString
        var parts = ["[\(host)](\(url.absoluteString))"]
        if let title { parts.append("# \(title)") }
        parts.append(text)
        return parts.joined(separator: "\n\n")
    }

    private func prepare(page: PageCapture) -> Result<PreparedPageCapture, CaptureAgentError> {
        let readable = truncateReadable(page.readable)
        guard let screenshot = fitScreenshot(page.screenshot) else {
            return .failure(CaptureAgentError("screenshot too large"))
        }
        let html = page.html.flatMap { data -> Data? in
            guard data.count <= maxArtifactBytes else { return nil }
            return data
        }
        return .success(PreparedPageCapture(readable: readable, screenshot: screenshot, html: html))
    }

    private func truncateReadable(_ readable: String) -> String {
        guard Data(readable.utf8).count > maxReadableBytes else { return readable }

        let note = "\n\n[Captured text truncated by Write because it exceeded the 2 MB upload limit.]\n"
        let noteBytes = Data(note.utf8).count
        let limit = max(0, maxReadableBytes - noteBytes)
        var used = 0
        var end = readable.startIndex
        var boundary = readable.startIndex
        var foundBoundary = false

        var index = readable.startIndex
        while index < readable.endIndex {
            let next = readable.index(after: index)
            let character = readable[index]
            let count = String(character).utf8.count
            guard used + count <= limit else { break }
            used += count
            end = next
            if character.isWhitespace {
                boundary = next
                foundBoundary = true
            }
            index = next
        }

        let cut = foundBoundary ? boundary : end
        let prefix = readable[..<cut].trimmingCharacters(in: .whitespacesAndNewlines)
        return String(prefix) + note
    }

    private func fitScreenshot(_ screenshot: Data) -> Data? {
        guard screenshot.count > maxArtifactBytes else { return screenshot }
        guard let source = CGImageSourceCreateWithData(screenshot as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return nil
        }

        var scale = min(0.92, sqrt(Double(maxArtifactBytes) / Double(screenshot.count)) * 0.92)
        for _ in 0..<10 {
            guard let resized = resizedPNG(image: image, scale: scale) else { return nil }
            if resized.count <= maxArtifactBytes {
                return resized
            }
            let next = sqrt(Double(maxArtifactBytes) / Double(resized.count)) * 0.9
            scale *= min(0.85, next)
        }
        return nil
    }

    private func resizedPNG(image: CGImage, scale: Double) -> Data? {
        let width = max(1, Int((Double(image.width) * scale).rounded()))
        let height = max(1, Int((Double(image.height) * scale).rounded()))
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }
        context.interpolationQuality = .medium
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        guard let resized = context.makeImage() else { return nil }
        return pngData(from: resized)
    }

    private func isWebURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    private func cleaned(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed
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
    ) -> CaptureUploadResult {
        let meta = CaptureMeta(url: url, capturedBy: "mac", error: reason)
        guard let body = multipartBody(meta: meta) else {
            return .terminal(CaptureAgentError("could not encode upload"))
        }
        return uploadWithRetry(capture: capture, origin: origin, token: token, body: body)
    }

    private func uploadSuccess(
        capture: PendingCapture, origin: URL, token: String, page: PageCapture, prepared: PreparedPageCapture
    ) -> CaptureUploadResult {
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
            readable: prepared.readable,
            screenshot: prepared.screenshot,
            html: prepared.html
        ) else {
            return .terminal(CaptureAgentError("could not encode upload"))
        }
        return uploadWithRetry(capture: capture, origin: origin, token: token, body: body)
    }

    private func uploadWithRetry(
        capture: PendingCapture, origin: URL, token: String, body: MultipartBody
    ) -> CaptureUploadResult {
        var lastTransient = CaptureAgentError("upload failed")
        for attempt in 0...uploadRetryDelays.count {
            switch upload(capture: capture, origin: origin, token: token, body: body) {
            case .success:
                return .success
            case .terminal(let reason):
                return .terminal(reason)
            case .transient(let reason):
                lastTransient = reason
                guard attempt < uploadRetryDelays.count else { return .transient(reason) }
                Thread.sleep(forTimeInterval: uploadRetryDelays[attempt])
            }
        }
        return .transient(lastTransient)
    }

    private func upload(
        capture: PendingCapture, origin: URL, token: String, body: MultipartBody
    ) -> CaptureUploadResult {
        guard let url = endpoint(origin: origin, path: "/api/sync/v1/captures/\(capture.id)") else {
            return .terminal(CaptureAgentError("bad upload URL"))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.httpBody = body.data
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(body.boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.data.count), forHTTPHeaderField: "Content-Length")

        switch send(request) {
        case .failure(let reason):
            return .transient(reason)
        case .success(let reply):
            if reply.status == 200 {
                return .success
            }
            let reason = CaptureAgentError(httpErrorMessage(status: reply.status, data: reply.data))
            if reply.status == 429 || (500...599).contains(reply.status) {
                return .transient(reason)
            }
            if (400...499).contains(reply.status) {
                return .terminal(reason)
            }
            return .terminal(reason)
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
            result = .success(NetworkReply(
                status: http.statusCode,
                data: data ?? Data(),
                finalURL: http.url,
                contentType: http.value(forHTTPHeaderField: "Content-Type") ?? http.mimeType
            ))
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
                if isPDFContentType(extracted.contentType) {
                    self.fail(url: self.currentURL, reason: pdfContentFailureReason)
                } else {
                    self.fail(url: self.currentURL, reason: "non-HTML content")
                }
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
    let html: Data?
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
    let finalURL: URL?
    let contentType: String?
}

private struct MultipartBody {
    let data: Data
    let boundary: String
}

private struct PDFDownload {
    let data: Data
    let finalURL: URL
}

private struct PreparedPageCapture {
    let readable: String
    let screenshot: Data
    let html: Data?
}

private enum CaptureUploadResult {
    case success
    case transient(CaptureAgentError)
    case terminal(CaptureAgentError)
}

private extension Data {
    mutating func appendUTF8(_ string: String) {
        append(Data(string.utf8))
    }
}

private let pdfContentFailureReason = "PDF content"

private func isPDFURL(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == "pdf"
}

private func isPDFContentType(_ contentType: String?) -> Bool {
    guard let type = contentType?.lowercased().split(separator: ";").first else { return false }
    let trimmed = type.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed == "application/pdf" || trimmed == "application/x-pdf"
}

private func pngData(from image: NSImage, size: NSSize) -> Data? {
    let width = max(1, Int(size.width.rounded()))
    let height = max(1, Int(size.height.rounded()))
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        return nil
    }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

private func pngData(from image: CGImage) -> Data? {
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
        output,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        return nil
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return output as Data
}

/// A URLSession download that cancels the transfer as soon as the response
/// body exceeds `maxBytes` (and rejects a Content-Length that already does),
/// so a hostile or runaway resource cannot buffer unbounded data into memory.
/// Used for PDF fetches, where the body is opaque and could be arbitrarily
/// large.
struct BoundedDownloadError: Error { let message: String }

final class BoundedDownloader: NSObject, URLSessionDataDelegate {
    struct Reply {
        let status: Int
        let data: Data
        let finalURL: URL?
        let contentType: String?
    }

    private let maxBytes: Int
    private var buffer = Data()
    private var response: HTTPURLResponse?
    private var overflow = false

    private init(maxBytes: Int) {
        self.maxBytes = maxBytes
    }

    static func fetch(_ request: URLRequest, maxBytes: Int) -> Result<Reply, BoundedDownloadError> {
        let delegate = BoundedDownloader(maxBytes: maxBytes)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 120
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let semaphore = DispatchSemaphore(value: 0)
        var taskError: Error?
        let task = session.dataTask(with: request) { _, _, error in
            taskError = error
            semaphore.signal()
        }
        task.resume()
        semaphore.wait()

        if delegate.overflow {
            return .failure(BoundedDownloadError(message: "resource exceeds \(maxBytes / (1024 * 1024)) MB"))
        }
        if let taskError {
            return .failure(BoundedDownloadError(message: taskError.localizedDescription))
        }
        guard let http = delegate.response else {
            return .failure(BoundedDownloadError(message: "not an HTTP response"))
        }
        return .success(Reply(
            status: http.statusCode,
            data: delegate.buffer,
            finalURL: http.url,
            contentType: http.value(forHTTPHeaderField: "Content-Type") ?? http.mimeType
        ))
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        self.response = response as? HTTPURLResponse
        // Reject early when the server advertises a body over the cap.
        if response.expectedContentLength > Int64(maxBytes) {
            overflow = true
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        if overflow { return }
        if buffer.count + data.count > maxBytes {
            overflow = true
            dataTask.cancel()
            return
        }
        buffer.append(data)
    }
}
