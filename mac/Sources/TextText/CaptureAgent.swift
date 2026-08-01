import AppKit
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers
import WebKit
import libwebp

@_silgen_name("WebPEncodeRGBA")
private func textTextWebPEncodeRGBA(
    _ rgba: UnsafePointer<UInt8>,
    _ width: Int32,
    _ height: Int32,
    _ stride: Int32,
    _ qualityFactor: Float,
    _ output: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>
) -> Int

@_silgen_name("WebPFree")
private func textTextWebPFree(_ pointer: UnsafeMutableRawPointer?)

/// Bookmark capture agent: drains GET /api/sync/v1/captures on this Mac,
/// loading each pending URL in an offscreen WKWebView to produce the
/// readable extraction, locally stored article images, and tiled screenshots, then
/// PUTs partial results to /api/sync/v1/captures/{id} as multipart/form-data
/// (fields: meta JSON, readable text, screenshot images, and readable assets).
final class CaptureAgent {
    private let store: StateStore
    private let queue = DispatchQueue(label: "texttext.capture-agent", qos: .utility)
    private let stateLock = NSLock()
    private let session: URLSession
    private var draining = false
    private var pendingDrain = false

    private let maxUploadBodyBytes = 4 * 1024 * 1024
    private let maxScreenshotBytes = 3 * 1024 * 1024
    private let maxReadableAssetBytes = 3 * 1024 * 1024
    private let maxReadableAssetDownloadBytes = 16 * 1024 * 1024
    private let maxReadableAssetCount = 200
    private let maxReadableAssetsPerUpload = 4
    private let readableAssetMaxEdge = 1800.0
    // Hard ceiling on a downloaded PDF before it is handed to PDFKit, so a
    // multi-gigabyte (or streaming) PDF cannot exhaust the agent's memory.
    private let maxPDFBytes = 40 * 1024 * 1024
    private let maxReadableBytes = 1_792 * 1024
    private let snapshotWidth: CGFloat = 1280
    private let minimumSnapshotHeight: CGFloat = 2000
    private let maxSnapshotHeight: CGFloat = 14_000
    private let maxSnapshotPixels: CGFloat = 18_000_000
    private let captureRetryDelays: [TimeInterval] = [2, 6]
    private let uploadRetryDelays: [TimeInterval] = [2, 6, 18]

    var onActivity: ((String) -> Void)?

    init(store: StateStore) {
        self.store = store
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.waitsForConnectivity = false
        config.httpAdditionalHeaders = ["User-Agent": "TextText-Mac/\(appVersion)"]
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

        switch self.captureWithRetry(url: sourceURL, fallbackTitle: capture.title) {
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

    private func captureWithRetry(url: URL, fallbackTitle: String?) -> Result<PageCapture, PageCaptureFailure> {
        var lastFailure = PageCaptureFailure(url: url, reason: "capture failed")
        for attempt in 0...captureRetryDelays.count {
            switch capture(url: url, fallbackTitle: fallbackTitle) {
            case .success(let page):
                return .success(page)
            case .failure(let failure):
                lastFailure = failure
                guard attempt < captureRetryDelays.count, shouldRetryCapture(failure: failure) else {
                    return .failure(failure)
                }
                activity("capture retry \(host(for: failure.url)): \(failure.reason)")
                Thread.sleep(forTimeInterval: captureRetryDelays[attempt])
            }
        }
        return .failure(lastFailure)
    }

    private func shouldRetryCapture(failure: PageCaptureFailure) -> Bool {
        let reason = failure.reason.lowercased()
        if reason == "bad url" ||
            reason == "non-html content" ||
            reason == "non-pdf content" ||
            reason == pdfContentFailureReason.lowercased() ||
            reason.contains("too large") {
            return false
        }
        if reason.contains("http 4") &&
            !reason.contains("http 408") &&
            !reason.contains("http 409") &&
            !reason.contains("http 425") &&
            !reason.contains("http 429") {
            return false
        }
        return true
    }

    private func capture(url: URL, fallbackTitle: String?) -> Result<PageCapture, PageCaptureFailure> {
        if isPDFURL(url) {
            return capturePDF(url: url, fallbackTitle: fallbackTitle)
        }
        if let pdfURL = pdfURLFromContentTypeProbe(url: url) {
            let pdfResult = capturePDF(url: pdfURL, fallbackTitle: fallbackTitle)
            if case .success = pdfResult {
                return pdfResult
            }
            if case .failure(let failure) = pdfResult,
               failure.reason != "non-PDF content",
               failure.reason != "PDF document failed to load" {
                return pdfResult
            }
        }

        let result = capturePage(url: url, fallbackTitle: fallbackTitle)
        if case .failure(let failure) = result, shouldRetryAsPDF(failure: failure) {
            let pdfResult = capturePDF(url: failure.url, fallbackTitle: fallbackTitle)
            if case .success = pdfResult {
                return pdfResult
            }
            if failure.reason == pdfContentFailureReason {
                return pdfResult
            }
        }
        return result
    }

    private func shouldRetryAsPDF(failure: PageCaptureFailure) -> Bool {
        guard isWebURL(failure.url) else { return false }
        if failure.reason == pdfContentFailureReason { return true }
        let reason = failure.reason.lowercased()
        return reason.contains("not an http response") ||
            reason.contains("unsupported") ||
            reason.contains("frame load interrupted") ||
            reason.contains("plugin handled load") ||
            reason.contains("webkiterrordomain error 102")
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
                guard looksLikePDF(data) || isPDFURL(url) else {
                    return .failure(PageCaptureFailure(url: url, reason: "non-PDF content"))
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
            guard isPDFContentType(reply.contentType) || isPDFURL(finalURL) || isPDFURL(url) || looksLikePDF(reply.data) else {
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
        let screenshot = renderPDFPages(document: document)

        let title = pdfTitle(document: document, fallbackTitle: fallbackTitle, url: finalURL)
        let page = PageCapture(
            finalURL: finalURL,
            title: title,
            siteName: nil,
            description: nil,
            readable: pdfMarkdown(text: cleaned(document.string), url: finalURL, title: title),
            screenshots: screenshot.map { [$0] } ?? []
        )
        return .success(page)
    }

    private func renderPDFPages(document: PDFDocument) -> Data? {
        guard document.pageCount > 0 else { return nil }

        let maxHeight = maxScreenshotHeightForWidth(snapshotWidth)
        let pageGap: CGFloat = document.pageCount > 1 ? 16 : 0
        var renderPlan: [PDFPageRenderPlan] = []
        var usedHeight: CGFloat = 0

        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex),
                  let geometry = pdfPageGeometry(page: page) else {
                continue
            }

            let gap = renderPlan.isEmpty ? 0 : pageGap
            let remainingHeight = maxHeight - usedHeight - gap
            guard remainingHeight > 1 else { break }

            let fullWidthHeight = geometry.bounds.height * (snapshotWidth / geometry.bounds.width)
            var targetSize = NSSize(width: snapshotWidth, height: fullWidthHeight)
            if targetSize.height > remainingHeight {
                guard renderPlan.isEmpty else { break }
                let scale = remainingHeight / geometry.bounds.height
                targetSize = NSSize(
                    width: max(1, geometry.bounds.width * scale),
                    height: max(1, remainingHeight)
                )
            }

            usedHeight += gap + targetSize.height
            renderPlan.append(PDFPageRenderPlan(
                page: page,
                box: geometry.box,
                size: targetSize,
                gapBefore: gap
            ))
        }

        guard !renderPlan.isEmpty else { return nil }
        let canvasSize = NSSize(width: snapshotWidth, height: max(1, usedHeight.rounded(.up)))
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: max(1, Int(canvasSize.width.rounded(.up))),
            pixelsHigh: max(1, Int(canvasSize.height.rounded(.up))),
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
        rep.size = canvasSize

        NSGraphicsContext.saveGraphicsState()
        guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
            NSGraphicsContext.restoreGraphicsState()
            return nil
        }
        context.imageInterpolation = .high
        NSGraphicsContext.current = context
        NSColor.white.setFill()
        NSRect(origin: .zero, size: canvasSize).fill()

        var y = canvasSize.height
        for item in renderPlan {
            y -= item.gapBefore
            y -= item.size.height
            let x = max(0, (canvasSize.width - item.size.width) / 2)
            let thumbnail = item.page.thumbnail(of: item.size, for: item.box)
            thumbnail.draw(
                in: NSRect(x: x, y: y, width: item.size.width, height: item.size.height),
                from: .zero,
                operation: .sourceOver,
                fraction: 1
            )
        }

        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    private func pdfPageGeometry(page: PDFPage) -> PDFPageGeometry? {
        var box: PDFDisplayBox = .cropBox
        var bounds = page.bounds(for: .cropBox)
        if bounds.width <= 0 || bounds.height <= 0 {
            box = .mediaBox
            bounds = page.bounds(for: .mediaBox)
        }
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        return PDFPageGeometry(box: box, bounds: bounds)
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

    private func pdfMarkdown(text: String?, url: URL, title: String?) -> String {
        let host = url.host ?? url.absoluteString
        var parts = ["[\(host)](\(url.absoluteString))"]
        if let title { parts.append("# \(title)") }
        if let text {
            parts.append(text)
        } else {
            parts.append("[No extractable PDF text found.]")
        }
        return parts.joined(separator: "\n\n")
    }

    private func prepare(page: PageCapture) -> Result<PreparedPageCapture, CaptureAgentError> {
        let readable = page.readable.flatMap { cleaned(truncateReadable($0)) }
        guard readable != nil || !page.screenshots.isEmpty else {
            return .failure(CaptureAgentError("no readable text or screenshot captured"))
        }
        return .success(PreparedPageCapture(
            readable: readable,
            screenshots: page.screenshots
        ))
    }

    private func truncateReadable(_ readable: String) -> String {
        guard Data(readable.utf8).count > maxReadableBytes else { return readable }

        let note = "\n\n[Captured text truncated by TextText because it exceeded the 1.75 MB upload limit.]\n"
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

    private func maxScreenshotHeightForWidth(_ width: CGFloat) -> CGFloat {
        min(maxSnapshotHeight, floor(maxSnapshotPixels / max(1, width)))
    }

    private func remoteMarkdownImageURLs(from markdown: String) -> [String] {
        let pattern = #"!\[[^\]]*\]\(\s*<?(https?://[^\s<>)]+)>?(?:\s+["'][^)]*["'])?\s*\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }
        let range = NSRange(markdown.startIndex..<markdown.endIndex, in: markdown)
        var seen = Set<String>()
        var urls: [String] = []
        for match in regex.matches(in: markdown, range: range) {
            guard match.numberOfRanges > 1,
                  let srcRange = Range(match.range(at: 1), in: markdown) else { continue }
            let src = String(markdown[srcRange])
            guard isHTTPImageURL(src), !seen.contains(src) else { continue }
            seen.insert(src)
            urls.append(src)
        }
        return urls
    }

    private func isHTTPImageURL(_ value: String) -> Bool {
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased() else {
            return false
        }
        return scheme == "http" || scheme == "https"
    }

    private func downloadReadableAsset(source: String, index: Int) -> CaptureReadableAsset? {
        guard let originalURL = URL(string: source) else { return nil }
        for candidate in assetDownloadCandidates(for: originalURL) {
            guard let artifact = downloadReadableAssetCandidate(candidate, original: originalURL, index: index) else {
                continue
            }
            return CaptureReadableAsset(
                originalURL: source,
                field: "asset\(index)",
                artifact: artifact
            )
        }
        return nil
    }

    private func assetDownloadCandidates(for url: URL) -> [URL] {
        guard url.scheme?.lowercased() == "http",
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return [url]
        }
        components.scheme = "https"
        guard let upgraded = components.url, upgraded != url else { return [url] }
        return [upgraded, url]
    }

    private func downloadReadableAssetCandidate(_ url: URL, original: URL, index: Int) -> CaptureArtifact? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.setValue("image/avif,image/webp,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")

        guard case .success(let reply) = BoundedDownloader.fetch(request, maxBytes: maxReadableAssetDownloadBytes),
              (200...299).contains(reply.status),
              !reply.data.isEmpty else {
            return nil
        }
        guard let contentType = imageContentType(data: reply.data, contentType: reply.contentType, url: url) else { return nil }
        let filename = readableAssetFilename(url: original, contentType: contentType, index: index)
        return fitReadableAsset(
            CaptureArtifact(data: reply.data, filename: filename, contentType: contentType)
        )
    }

    private func fitReadableAsset(_ artifact: CaptureArtifact) -> CaptureArtifact? {
        if artifact.data.count <= maxReadableAssetBytes { return artifact }
        let lower = artifact.contentType.lowercased()
        if lower == "image/gif" || lower == "image/avif" { return nil }
        guard let source = CGImageSourceCreateWithData(artifact.data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return nil
        }
        let longest = Double(max(image.width, image.height))
        let scale = min(1.0, readableAssetMaxEdge / max(1.0, longest))
        let plans: [(type: UTType, contentType: String, ext: String, quality: Double)] = [
            (.webP, "image/webp", "webp", 0.78),
            (.webP, "image/webp", "webp", 0.62),
            (.webP, "image/webp", "webp", 0.48),
            (.jpeg, "image/jpeg", "jpg", 0.78),
            (.jpeg, "image/jpeg", "jpg", 0.62),
            (.jpeg, "image/jpeg", "jpg", 0.48),
        ]
        for plan in plans {
            guard let rendered = renderedImage(image: image, scale: scale),
                  let data = encodedImageData(image: rendered, type: plan.type, quality: plan.quality),
                  data.count <= maxReadableAssetBytes else {
                continue
            }
            return CaptureArtifact(
                data: data,
                filename: assetFilenameWithExtension(artifact.filename, ext: plan.ext),
                contentType: plan.contentType
            )
        }
        return nil
    }

    private func imageContentType(data: Data, contentType: String?, url: URL) -> String? {
        let header = contentType?.lowercased().split(separator: ";").first.map(String.init)
        if let normalized = normalizedImageContentType(header) { return normalized }
        if let normalized = normalizedImageContentType(contentTypeForExtension(url.pathExtension)) {
            return normalized
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let type = CGImageSourceGetType(source) as String? else {
            return nil
        }
        if type == UTType.png.identifier { return "image/png" }
        if type == UTType.jpeg.identifier { return "image/jpeg" }
        if type == UTType.gif.identifier { return "image/gif" }
        if type == UTType.webP.identifier { return "image/webp" }
        return nil
    }

    private func normalizedImageContentType(_ value: String?) -> String? {
        switch value?.lowercased() {
        case "image/avif": return "image/avif"
        case "image/gif": return "image/gif"
        case "image/jpeg", "image/jpg", "image/pjpeg": return "image/jpeg"
        case "image/png", "image/x-png": return "image/png"
        case "image/webp": return "image/webp"
        default: return nil
        }
    }

    private func contentTypeForExtension(_ ext: String) -> String? {
        switch ext.lowercased() {
        case "avif": return "image/avif"
        case "gif": return "image/gif"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "webp": return "image/webp"
        default: return nil
        }
    }

    private func readableAssetFilename(url: URL, contentType: String, index: Int) -> String {
        let raw = url.deletingPathExtension().lastPathComponent.removingPercentEncoding ?? ""
        let stem = safeAssetStem(raw, fallback: "image-\(index + 1)")
        return "\(stem).\(assetExtension(for: contentType))"
    }

    private func assetFilenameWithExtension(_ filename: String, ext: String) -> String {
        let stem = safeAssetStem(
            URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent,
            fallback: "image"
        )
        return "\(stem).\(ext)"
    }

    private func assetExtension(for contentType: String) -> String {
        switch contentType.lowercased() {
        case "image/avif": return "avif"
        case "image/gif": return "gif"
        case "image/png": return "png"
        case "image/webp": return "webp"
        default: return "jpg"
        }
    }

    private func safeAssetStem(_ value: String, fallback: String) -> String {
        let allowed = CharacterSet.alphanumerics
        let scalars = value.lowercased().unicodeScalars.map { scalar -> Character in
            allowed.contains(scalar) ? Character(scalar) : "-"
        }
        let joined = String(scalars)
            .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        if joined.isEmpty { return fallback }
        return String(joined.prefix(64))
    }

    private func truncateUTF8(_ value: String, maxBytes: Int, note: String) -> String {
        guard Data(value.utf8).count > maxBytes else { return value }
        let noteBytes = Data(note.utf8).count
        let limit = max(0, maxBytes - noteBytes)
        var used = 0
        var end = value.startIndex

        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(after: index)
            let count = String(value[index]).utf8.count
            guard used + count <= limit else { break }
            used += count
            end = next
            index = next
        }

        return String(value[..<end]) + note
    }

    private func screenshotArtifacts(from screenshot: Data) -> [CaptureArtifact] {
        guard let source = CGImageSourceCreateWithData(screenshot as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              let codec = screenshotCodec(for: image) else {
            return []
        }

        let plans: [(scale: Double, quality: Double)] = [
            (1.0, 0.78),
            (1.0, 0.62),
            (1.0, 0.48),
            (0.85, 0.62),
            (0.72, 0.56),
            (0.60, 0.50),
            (0.48, 0.45),
        ]
        var artifacts: [CaptureArtifact] = []
        var seenSizes = Set<Int>()

        for plan in plans {
            guard let artifact = screenshotArtifact(
                image: image,
                codec: codec,
                scale: plan.scale,
                quality: plan.quality
            ) else {
                continue
            }
            guard artifact.data.count <= maxScreenshotBytes,
                  seenSizes.insert(artifact.data.count).inserted else {
                continue
            }
            artifacts.append(artifact)
        }

        if artifacts.isEmpty {
            var scale = 0.40
            for _ in 0..<4 {
                guard let artifact = screenshotArtifact(
                    image: image,
                    codec: codec,
                    scale: scale,
                    quality: 0.42
                ) else {
                    break
                }
                if artifact.data.count <= maxScreenshotBytes,
                   seenSizes.insert(artifact.data.count).inserted {
                    artifacts.append(artifact)
                    break
                }
                scale *= 0.75
            }
        }

        return artifacts
    }

    private func screenshotCodec(for image: CGImage) -> ScreenshotCodec? {
        guard let rendered = renderedImage(image: image, scale: 1.0) else { return nil }
        if encodedImageData(image: rendered, type: .webP, quality: 0.78) != nil {
            return .webP
        }
        if encodedImageData(image: rendered, type: .jpeg, quality: 0.78) != nil {
            return .jpeg
        }
        return nil
    }

    private func screenshotArtifact(
        image: CGImage, codec: ScreenshotCodec, scale: Double, quality: Double
    ) -> CaptureArtifact? {
        guard let rendered = renderedImage(image: image, scale: scale),
              let data = encodedImageData(image: rendered, type: codec.utType, quality: quality) else {
            return nil
        }
        return CaptureArtifact(
            data: data,
            filename: "screenshot.\(codec.fileExtension)",
            contentType: codec.contentType
        )
    }

    private func renderedImage(image: CGImage, scale: Double) -> CGImage? {
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
        return context.makeImage()
    }

    private func encodedImageData(image: CGImage, type: UTType, quality: Double) -> Data? {
        if type == .webP {
            return encodedWebPImageData(image: image, quality: quality)
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output,
            type.identifier as CFString,
            1,
            nil
        ) else {
            return nil
        }
        let options = [
            kCGImageDestinationLossyCompressionQuality as String: max(0.1, min(1.0, quality))
        ] as CFDictionary
        CGImageDestinationAddImage(destination, image, options)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }

    private func encodedWebPImageData(image: CGImage, quality: Double) -> Data? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0,
              width <= Int(Int32.max), height <= Int(Int32.max),
              let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ),
              let data = context.data else {
            return nil
        }

        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

        var output: UnsafeMutablePointer<UInt8>?
        let encodedSize = textTextWebPEncodeRGBA(
            data.assumingMemoryBound(to: UInt8.self),
            Int32(width),
            Int32(height),
            Int32(context.bytesPerRow),
            Float(max(0, min(1, quality)) * 100),
            &output
        )
        defer {
            if let output {
                textTextWebPFree(UnsafeMutableRawPointer(output))
            }
        }
        guard encodedSize > 0, let output else { return nil }
        return Data(bytes: output, count: encodedSize)
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
        var meta = CaptureMeta(url: url, capturedBy: "mac", error: reason)
        meta.generation = capture.generation
        guard let body = multipartBody(meta: meta) else {
            return .terminal(CaptureAgentError("could not encode upload"))
        }
        return uploadWithRetry(capture: capture, origin: origin, token: token, body: body)
    }

    private func uploadSuccess(
        capture: PendingCapture, origin: URL, token: String, page: PageCapture, prepared: PreparedPageCapture
    ) -> CaptureUploadResult {
        var meta = CaptureMeta(
            url: page.finalURL.absoluteString,
            title: page.title,
            siteName: page.siteName,
            description: page.description,
            capturedBy: "mac",
            error: nil
        )
        meta.generation = capture.generation

        var storedContent = false
        var lastTransient: CaptureAgentError?
        var lastTerminal: CaptureAgentError?
        var requiredArtifactFailure: CaptureUploadResult?

        if let readable = prepared.readable {
            let assetCount = uploadReadableAssets(
                capture: capture,
                origin: origin,
                token: token,
                meta: meta,
                readable: readable,
                url: page.finalURL
            )
            if assetCount > 0 {
                activity("captured \(assetCount) bookmark images \(host(for: page.finalURL))")
            }

            switch uploadPartial(capture: capture, origin: origin, token: token, meta: meta, readable: readable) {
            case .success:
                storedContent = true
            case .transient(let reason):
                lastTransient = reason
                activity("capture text pending \(host(for: page.finalURL)): \(reason)")
            case .terminal(let reason):
                lastTerminal = reason
                activity("capture text rejected \(host(for: page.finalURL)): \(reason)")
            }
        }

        for (index, screenshot) in prepared.screenshots.enumerated() {
            var screenshotMeta = meta
            screenshotMeta.screenshotIndex = index
            screenshotMeta.screenshotCount = prepared.screenshots.count
            switch uploadScreenshotBestEffort(
                capture: capture,
                origin: origin,
                token: token,
                meta: screenshotMeta,
                screenshot: screenshot,
                url: page.finalURL
            ) {
            case .success:
                storedContent = true
            case .transient(let reason):
                lastTransient = reason
                requiredArtifactFailure = .transient(reason)
                if storedContent {
                    activity("capture screenshot skipped \(host(for: page.finalURL)): \(reason)")
                }
            case .terminal(let reason):
                lastTerminal = reason
                requiredArtifactFailure = .terminal(reason)
                if storedContent {
                    activity("capture screenshot skipped \(host(for: page.finalURL)): \(reason)")
                }
            }
        }

        if storedContent {
            if let requiredArtifactFailure { return requiredArtifactFailure }
            var finalMeta = meta
            finalMeta.isFinal = true
            return uploadPartial(
                capture: capture,
                origin: origin,
                token: token,
                meta: finalMeta
            )
        }
        if let lastTransient { return .transient(lastTransient) }
        if let lastTerminal { return .terminal(lastTerminal) }
        return .terminal(CaptureAgentError("no uploadable readable text or screenshot"))
    }

    private func uploadPartial(
        capture: PendingCapture, origin: URL, token: String, meta: CaptureMeta,
        readable: String? = nil, screenshot: CaptureArtifact? = nil,
        assets: [CaptureReadableAsset] = []
    ) -> CaptureUploadResult {
        guard let body = multipartBody(
            meta: meta,
            readable: readable,
            screenshot: screenshot,
            assets: assets
        ) else {
            return .terminal(CaptureAgentError("could not encode upload"))
        }
        return uploadWithRetry(capture: capture, origin: origin, token: token, body: body)
    }

    private func uploadReadableAssets(
        capture: PendingCapture, origin: URL, token: String, meta: CaptureMeta, readable: String, url: URL
    ) -> Int {
        let allSources = remoteMarkdownImageURLs(from: readable)
        let sources = Array(allSources.prefix(maxReadableAssetCount))
        guard !sources.isEmpty else { return 0 }
        var uploaded = 0
        var batch: [CaptureReadableAsset] = []
        for (index, source) in sources.enumerated() {
            guard let asset = downloadReadableAsset(source: source, index: index) else { continue }
            batch.append(asset)
            if batch.count >= maxReadableAssetsPerUpload {
                uploaded += uploadReadableAssetBatch(
                    capture: capture,
                    origin: origin,
                    token: token,
                    meta: meta,
                    assets: batch,
                    url: url
                )
                batch.removeAll(keepingCapacity: true)
            }
        }
        uploaded += uploadReadableAssetBatch(
            capture: capture,
            origin: origin,
            token: token,
            meta: meta,
            assets: batch,
            url: url
        )
        let total = allSources.count
        if total > maxReadableAssetCount {
            activity("bookmark images capped \(host(for: url)): \(uploaded)/\(total)")
        }
        return uploaded
    }

    private func uploadReadableAssetBatch(
        capture: PendingCapture, origin: URL, token: String, meta: CaptureMeta,
        assets: [CaptureReadableAsset], url: URL
    ) -> Int {
        guard !assets.isEmpty else { return 0 }
        switch uploadPartial(capture: capture, origin: origin, token: token, meta: meta, assets: assets) {
        case .success:
            return assets.count
        case .transient(let reason):
            guard assets.count > 1 else {
                activity("bookmark image pending \(host(for: url)): \(reason)")
                return 0
            }
        case .terminal(let reason):
            guard assets.count > 1 else {
                activity("bookmark image skipped \(host(for: url)): \(reason)")
                return 0
            }
        }

        var uploaded = 0
        for asset in assets {
            switch uploadPartial(capture: capture, origin: origin, token: token, meta: meta, assets: [asset]) {
            case .success:
                uploaded += 1
            case .transient(let reason):
                activity("bookmark image pending \(host(for: url)): \(reason)")
            case .terminal(let reason):
                activity("bookmark image skipped \(host(for: url)): \(reason)")
            }
        }
        return uploaded
    }

    private func uploadScreenshotBestEffort(
        capture: PendingCapture, origin: URL, token: String, meta: CaptureMeta, screenshot: Data, url: URL
    ) -> CaptureUploadResult {
        let artifacts = screenshotArtifacts(from: screenshot)
        guard !artifacts.isEmpty else {
            return .terminal(CaptureAgentError("could not encode screenshot"))
        }

        var lastTransient: CaptureAgentError?
        var lastTerminal: CaptureAgentError?
        for (index, artifact) in artifacts.enumerated() {
            switch uploadPartial(capture: capture, origin: origin, token: token, meta: meta, screenshot: artifact) {
            case .success:
                return .success
            case .transient(let reason):
                lastTransient = reason
                if index + 1 < artifacts.count {
                    activity("capture screenshot retry \(host(for: url)): \(reason)")
                }
            case .terminal(let reason):
                lastTerminal = reason
                guard shouldDegradeScreenshotUpload(reason) && index + 1 < artifacts.count else {
                    return .terminal(reason)
                }
                activity("capture screenshot retry \(host(for: url)): \(reason)")
            }
        }

        if let lastTransient { return .transient(lastTransient) }
        return .terminal(lastTerminal ?? CaptureAgentError("screenshot upload failed"))
    }

    private func shouldDegradeScreenshotUpload(_ reason: CaptureAgentError) -> Bool {
        let message = reason.message.lowercased()
        return message.contains("413") ||
            message.contains("too large") ||
            message.contains("payload") ||
            message.contains("request entity") ||
            message.contains("body")
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
        guard body.data.count <= maxUploadBodyBytes else {
            return .terminal(CaptureAgentError(
                "upload body is \(formatBytes(body.data.count)); limit is \(formatBytes(maxUploadBodyBytes))"
            ))
        }
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
        meta: CaptureMeta, readable: String? = nil, screenshot: CaptureArtifact? = nil,
        assets: [CaptureReadableAsset] = []
    ) -> MultipartBody? {
        guard let metaData = try? JSONEncoder().encode(meta),
              let metaJSON = String(data: metaData, encoding: .utf8) else {
            return nil
        }

        let boundary = "----TextTextCapture\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var data = Data()
        appendField(name: "meta", value: metaJSON, contentType: "application/json; charset=utf-8",
                    to: &data, boundary: boundary)
        if let readable {
            appendField(name: "readable", value: readable, contentType: "text/markdown; charset=utf-8",
                        to: &data, boundary: boundary)
        }
        if let screenshot {
            appendFile(name: "screenshot", filename: screenshot.filename, contentType: screenshot.contentType,
                       fileData: screenshot.data, to: &data, boundary: boundary)
        }
        if !assets.isEmpty {
            let manifest = assets.map {
                CaptureAssetManifestEntry(
                    field: $0.field,
                    originalUrl: $0.originalURL,
                    filename: $0.artifact.filename,
                    contentType: $0.artifact.contentType
                )
            }
            guard let manifestData = try? JSONEncoder().encode(manifest),
                  let manifestJSON = String(data: manifestData, encoding: .utf8) else {
                return nil
            }
            appendField(name: "assetManifest", value: manifestJSON, contentType: "application/json; charset=utf-8",
                        to: &data, boundary: boundary)
            for asset in assets {
                appendFile(name: asset.field, filename: asset.artifact.filename, contentType: asset.artifact.contentType,
                           fileData: asset.artifact.data, to: &data, boundary: boundary)
            }
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

    private func formatBytes(_ bytes: Int) -> String {
        let mb = Double(bytes) / (1024 * 1024)
        return String(format: "%.2f MB", mb)
    }

    private func activity(_ message: String) {
        if Thread.isMainThread {
            onActivity?(message)
        } else {
            DispatchQueue.main.async { [weak self] in self?.onActivity?(message) }
        }
    }
}

struct BookmarkCaptureScreenshotTile: Equatable {
    let index: Int
    let y: CGFloat
    let height: CGFloat
}

func bookmarkCaptureScreenshotTilePlan(
    pageHeight: CGFloat,
    tileHeight: CGFloat = 4000,
    maxTileCount: Int = 100
) -> [BookmarkCaptureScreenshotTile] {
    let safeTileHeight = max(1, tileHeight)
    let safePageHeight = max(1, pageHeight)
    let count = min(max(1, maxTileCount), max(1, Int(ceil(safePageHeight / safeTileHeight))))
    return (0..<count).map { index in
        let y = CGFloat(index) * safeTileHeight
        return BookmarkCaptureScreenshotTile(
            index: index,
            y: y,
            height: min(safeTileHeight, max(1, safePageHeight - y))
        )
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
    private let snapshotWidth: CGFloat = 1280
    private let minimumSnapshotHeight: CGFloat = 2000
    private let snapshotTileHeight: CGFloat = 4000
    private let maxSnapshotTileCount = 100

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
            frame: NSRect(x: 0, y: 0, width: snapshotWidth, height: minimumSnapshotHeight),
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

        let delay = DispatchWorkItem { self.prepareForExtraction() }
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

    private func prepareForExtraction() {
        guard let webView, !completed else { return }
        webView.evaluateJavaScript(snapshotSizeScript) { value, _ in
            guard let webView = self.webView, !self.completed else { return }
            let pageSize = self.pageSize(from: value)
            let viewportSize = NSSize(
                width: self.snapshotWidth,
                height: min(pageSize.height, self.snapshotTileHeight)
            )
            webView.frame = NSRect(origin: .zero, size: viewportSize)
            webView.layoutSubtreeIfNeeded()
            webView.callAsyncJavaScript(
                lazyImageHydrationScript,
                arguments: [:],
                in: nil,
                in: .page
            ) { _ in
                self.settleAfterLazyImageHydration()
            }
        }
    }

    private func settleAfterLazyImageHydration() {
        let delay = DispatchWorkItem {
            guard let webView = self.webView, !self.completed else { return }
            webView.evaluateJavaScript(lazyImageResetScrollScript) { _, _ in
                let finalDelay = DispatchWorkItem { self.extract() }
                self.settleDelay = finalDelay
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: finalDelay)
            }
        }
        settleDelay = delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: delay)
    }

    private func extract() {
        guard let webView, !completed else { return }
        webView.evaluateJavaScript(readableExtractionScript) { value, error in
            if let error {
                self.takeScreenshot(readable: nil, fallbackReason: error.localizedDescription)
                return
            }
            guard let json = value as? String,
                  let data = json.data(using: .utf8),
                  let extracted = try? JSONDecoder().decode(ReadableExtraction.self, from: data) else {
                self.takeScreenshot(readable: nil, fallbackReason: "readable extraction failed")
                return
            }
            if let ok = extracted.ok, !ok {
                self.takeScreenshot(
                    readable: nil,
                    fallbackReason: extracted.error ?? "readable extraction failed"
                )
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
            self.takeScreenshot(
                readable: extracted,
                fallbackReason: "screenshot failed"
            )
        }
    }

    private func takeScreenshot(readable: ReadableExtraction?, fallbackReason: String) {
        guard let webView, !completed else { return }
        webView.evaluateJavaScript(snapshotSizeScript) { value, error in
            if let error {
                self.finishPage(
                    readable: readable,
                    screenshots: [],
                    fallbackReason: error.localizedDescription
                )
                return
            }
            let size = self.pageSize(from: value)
            self.takeScreenshotTiles(
                readable: readable,
                pageHeight: size.height,
                fallbackReason: fallbackReason
            )
        }
    }

    private func takeScreenshotTiles(
        readable: ReadableExtraction?, pageHeight: CGFloat, fallbackReason: String
    ) {
        let tiles = bookmarkCaptureScreenshotTilePlan(
            pageHeight: pageHeight,
            tileHeight: snapshotTileHeight,
            maxTileCount: maxSnapshotTileCount
        )
        captureScreenshotTile(
            index: 0,
            tiles: tiles,
            screenshots: [],
            readable: readable,
            fallbackReason: fallbackReason
        )
    }

    private func captureScreenshotTile(
        index: Int,
        tiles: [BookmarkCaptureScreenshotTile],
        screenshots: [Data],
        readable: ReadableExtraction?,
        fallbackReason: String
    ) {
        guard let webView, !completed else { return }
        guard index < tiles.count else {
            finishPage(
                readable: readable,
                screenshots: screenshots,
                fallbackReason: fallbackReason
            )
            return
        }

        let tile = tiles[index]
        let tileSize = NSSize(width: snapshotWidth, height: tile.height)
        webView.frame = NSRect(origin: .zero, size: tileSize)
        webView.layoutSubtreeIfNeeded()
        let scrollScript = "window.scrollTo(0, \(Int(tile.y))); true;"
        webView.evaluateJavaScript(scrollScript) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                guard let webView = self.webView, !self.completed else { return }
                let config = WKSnapshotConfiguration()
                config.rect = NSRect(origin: .zero, size: tileSize)
                webView.takeSnapshot(with: config) { image, error in
                    guard error == nil, let image, let png = self.pngData(from: image) else {
                        self.finishPage(
                            readable: readable,
                            screenshots: screenshots,
                            fallbackReason: error?.localizedDescription ?? fallbackReason
                        )
                        return
                    }
                    self.captureScreenshotTile(
                        index: index + 1,
                        tiles: tiles,
                        screenshots: screenshots + [png],
                        readable: readable,
                        fallbackReason: fallbackReason
                    )
                }
            }
        }
    }

    private func pngData(from image: NSImage) -> Data? {
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }

    private func finishPage(
        readable: ReadableExtraction?, screenshots: [Data], fallbackReason: String
    ) {
        let title = self.cleaned(readable?.title) ?? self.cleaned(self.fallbackTitle)
        let readableMarkdown = readable.map { self.markdown(from: $0, title: title) }
        guard readableMarkdown != nil || !screenshots.isEmpty else {
            self.fail(url: self.currentURL, reason: fallbackReason)
            return
        }
        let page = PageCapture(
            finalURL: self.currentURL,
            title: title,
            siteName: self.cleaned(readable?.siteName),
            description: self.cleaned(readable?.description),
            readable: readableMarkdown,
            screenshots: screenshots
        )
        self.finish(.success(page))
    }

    private func pageSize(from value: Any?) -> NSSize {
        var measuredHeight = minimumSnapshotHeight
        if let json = value as? String,
           let data = json.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(PageSnapshotSize.self, from: data),
           decoded.height.isFinite {
            measuredHeight = max(minimumSnapshotHeight, CGFloat(decoded.height.rounded(.up)))
        }

        let maxHeight = snapshotTileHeight * CGFloat(maxSnapshotTileCount)
        return NSSize(width: snapshotWidth, height: min(maxHeight, max(1, measuredHeight)))
    }

    private func markdown(from readable: ReadableExtraction, title: String?) -> String {
        let finalURL = currentURL
        let host = finalURL.host ?? finalURL.absoluteString
        var parts = ["[\(host)](\(finalURL.absoluteString))"]
        if let title { parts.append("# \(title)") }
        if let blocks = readable.blocks, !blocks.isEmpty {
            for block in blocks {
                switch block.type {
                case "image":
                    guard let src = cleaned(block.src),
                          isHTTPImageURL(src) else { continue }
                    let image = "![\(markdownImageAlt(block.alt))](\(markdownURL(src)))"
                    if let href = cleaned(block.href), isHTTPURL(href) {
                        parts.append("[\(image)](\(markdownURL(href)))")
                    } else {
                        parts.append(image)
                    }
                default:
                    guard let cleaned = cleaned(block.text) else { continue }
                    parts.append(cleaned)
                }
            }
        } else {
            for paragraph in readable.paragraphs ?? [] {
                guard let cleaned = cleaned(paragraph) else { continue }
                parts.append(cleaned)
            }
        }
        return parts.joined(separator: "\n\n")
    }

    private func markdownImageAlt(_ value: String?) -> String {
        guard let cleaned = cleaned(value) else { return "" }
        let escaped = cleaned
            .replacingOccurrences(of: "[", with: "(")
            .replacingOccurrences(of: "]", with: ")")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
        guard escaped.count > 180 else { return escaped }
        return String(escaped.prefix(180)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func markdownURL(_ value: String) -> String {
        value
            .replacingOccurrences(of: "(", with: "%28")
            .replacingOccurrences(of: ")", with: "%29")
    }

    private func isHTTPImageURL(_ value: String) -> Bool {
        isHTTPURL(value)
    }

    private func isHTTPURL(_ value: String) -> Bool {
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased() else {
            return false
        }
        return scheme == "http" || scheme == "https"
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

private let lazyImageHydrationScript = #"""
function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}
function isPlaceholder(value) {
  var lower = clean(value).toLowerCase();
  if (!lower) return true;
  return /(^|[\/?&_.#=-])(default-cubic|placeholder|placehold|transparent|blank|spacer|pixel|1x1|lazy-placeholder|default[-_]?image)([\/?&_.#=-]|$)/.test(lower);
}
function firstDataValue(img, names) {
  for (var i = 0; i < names.length; i++) {
    var value = clean(img.getAttribute(names[i]));
    if (value && !/^data:/i.test(value)) return value;
  }
  return "";
}
function dispatchViewportEvents() {
  try { window.dispatchEvent(new Event("scroll")); } catch (_) {}
  try { document.dispatchEvent(new Event("scroll")); } catch (_) {}
  try { window.dispatchEvent(new Event("resize")); } catch (_) {}
}
function hydrateImages() {
  var imgs = Array.prototype.slice.call(document.images || []);
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    try { img.loading = "eager"; } catch (_) {}
    try { img.decoding = "async"; } catch (_) {}

    var src = clean(img.getAttribute("src"));
    var dataSrc = firstDataValue(img, [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-hi-res-src",
      "data-image"
    ]);
    if (dataSrc && (!src || isPlaceholder(src))) {
      try { img.setAttribute("src", dataSrc); } catch (_) {}
    }

    var srcset = clean(img.getAttribute("srcset"));
    var dataSrcset = firstDataValue(img, [
      "data-srcset",
      "data-lazy-srcset",
      "data-responsive-srcset"
    ]);
    if (dataSrcset && (!srcset || isPlaceholder(srcset))) {
      try { img.setAttribute("srcset", dataSrcset); } catch (_) {}
    }
  }
  return imgs;
}
function pageHeight(viewport) {
  var root = document.scrollingElement || document.documentElement || document.body;
  return Math.max(
    (root && root.scrollHeight) || 0,
    (document.body && document.body.scrollHeight) || 0,
    (document.documentElement && document.documentElement.scrollHeight) || 0,
    viewport
  );
}
function delay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

try {
  var viewport = Math.max(
    window.innerHeight || 0,
    (document.documentElement && document.documentElement.clientHeight) || 0,
    800
  );
  var step = Math.max(700, Math.floor(viewport * 0.7));
  var height = pageHeight(viewport);
  var y = 0;
  var count = 0;
  hydrateImages();
  window.scrollTo(0, 0);
  dispatchViewportEvents();

  // Give every viewport time to run IntersectionObserver callbacks and begin
  // image requests. Re-measure because infinite/lazy layouts grow while moving.
  while (y < height && count < 160) {
    window.scrollTo(0, y);
    dispatchViewportEvents();
    await delay(70);
    hydrateImages();
    height = Math.max(height, pageHeight(viewport));
    y += step;
    count += 1;
  }
  window.scrollTo(0, Math.max(0, height - viewport));
  dispatchViewportEvents();
  await delay(250);

  var imgs = hydrateImages();
  var pending = imgs.filter(function(img) {
    return !img.complete && !!clean(img.currentSrc || img.getAttribute("src"));
  });
  await Promise.race([
    Promise.all(pending.map(function(img) {
      return new Promise(function(resolve) {
        var done = function() { resolve(true); };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    })),
    delay(3500)
  ]);

  window.scrollTo(0, 0);
  dispatchViewportEvents();
  await delay(120);
  return JSON.stringify({ ok: true, images: imgs.length, height: pageHeight(viewport) });
} catch (e) {
  return JSON.stringify({ ok: false, error: String((e && e.message) || e || "lazy image hydration failed") });
}
"""#

private let lazyImageResetScrollScript = #"""
(function() {
  try {
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    return true;
  } catch (_) {
    return false;
  }
})();
"""#

let readableExtractionScript = #"""
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
      return (value || "").replace(/\s+/g, " ").trim();
    }
    function parseSrcset(srcset) {
      var entries = [];
      var values = (srcset || "").split(",");
      for (var i = 0; i < values.length; i++) {
        var pieces = clean(values[i]).split(/\s+/);
        var url = pieces.shift() || "";
        if (!url || /^data:/i.test(url)) continue;
        var descriptor = pieces[0] || "";
        var width = 0;
        var density = 0;
        if (/^\d+w$/.test(descriptor)) {
          width = parseInt(descriptor.slice(0, -1), 10) || 0;
        } else if (/^\d*\.?\d+x$/.test(descriptor)) {
          density = parseFloat(descriptor.slice(0, -1)) || 0;
        }
        entries.push({ url: url, width: width, density: density, index: entries.length });
      }
      return entries;
    }
    function absoluteURL(value) {
      var candidate = clean(value);
      if (!candidate || /^data:/i.test(candidate)) return "";
      try {
        if (candidate.indexOf("//") === 0) candidate = window.location.protocol + candidate;
        var url = new URL(candidate, document.baseURI || window.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.href;
      } catch (_) {
        return "";
      }
    }
    function absoluteLinkURL(value) {
      var candidate = clean(value);
      if (!candidate || candidate.length > 4096 || candidate.charAt(0) === "#") return "";
      if (/^(javascript|mailto):/i.test(candidate)) return "";
      try {
        if (candidate.indexOf("//") === 0) candidate = "https:" + candidate;
        var url = new URL(candidate, window.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        if (isSamePageAnchor(url)) return "";
        return url.href;
      } catch (_) {
        return "";
      }
    }
    function isSamePageAnchor(url) {
      if (!url.hash) return false;
      try {
        var page = new URL(window.location.href);
        return url.protocol === page.protocol &&
          url.host === page.host &&
          url.pathname === page.pathname &&
          url.search === page.search;
      } catch (_) {
        return false;
      }
    }
    function markdownLinkText(value) {
      return clean(value)
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
    }
    function markdownURL(value) {
      return (value || "")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
    }
    function knownPlaceholderPattern(value) {
      var lower = (value || "").toLowerCase();
      if (!lower) return false;
      return /(^|[\/?&_.#=-])(default-cubic|placeholder|placehold|transparent|blank|spacer|pixel|1x1|lazy-placeholder|default[-_]?image)([\/?&_.#=-]|$)/.test(lower);
    }
    function badImagePattern(value) {
      var lower = (value || "").toLowerCase();
      if (!lower) return false;
      if (knownPlaceholderPattern(lower)) return true;
      if (/(doubleclick|googlesyndication|google-analytics|scorecardresearch|quantserve|facebook\.com\/tr|pixel\.wp\.com|adservice|taboola|outbrain)/.test(lower)) {
        return true;
      }
      if (/(^|[\s\/?&_.#=-])(ad|ads|advert|advertisement|beacon|tracker|tracking|analytics|clear|favicon)([\s\/?&_.#=-]|$)/.test(lower)) {
        return true;
      }
      return /(^|[\s\/?&_.#=-])(logo|site-logo|brand-logo|sprite|icon|avatar|author-avatar|profile-photo)([\s\/?&_.#=-]|$)/.test(lower);
    }
    function nonPlaceholderURL(value) {
      var url = absoluteURL(value);
      if (!url || knownPlaceholderPattern(url)) return "";
      return url;
    }
    function realContentURL(value) {
      var url = nonPlaceholderURL(value);
      if (!url || badImagePattern(url)) return "";
      return url;
    }
    function largestSrcsetCandidate(srcset) {
      var entries = parseSrcset(srcset);
      if (!entries.length) return "";
      entries.sort(function(a, b) {
        var aRank = a.width || (a.density ? a.density * 1000 : 0);
        var bRank = b.width || (b.density ? b.density * 1000 : 0);
        if (aRank !== bRank) return bRank - aRank;
        return b.index - a.index;
      });
      for (var i = 0; i < entries.length; i++) {
        var candidate = nonPlaceholderURL(entries[i].url);
        if (candidate) return candidate;
      }
      return "";
    }
    function pictureSource(img) {
      var parent = img.parentElement;
      if (!parent || parent.tagName !== "PICTURE") return "";
      var sources = parent.querySelectorAll("source[srcset]");
      var fallback = "";
      for (var i = 0; i < sources.length; i++) {
        var candidate = largestSrcsetCandidate(sources[i].getAttribute("srcset"));
        if (!candidate) continue;
        if (!fallback) fallback = candidate;
        var media = sources[i].getAttribute("media");
        if (!media || !window.matchMedia || window.matchMedia(media).matches) {
          return candidate;
        }
      }
      return fallback;
    }
    function firstURL(candidates, resolver) {
      for (var i = 0; i < candidates.length; i++) {
        var url = resolver(candidates[i]);
        if (url) return url;
      }
      return "";
    }
    function imageSource(img) {
      var current = realContentURL(img.currentSrc);
      if (current) return current;

      var srcset = firstURL([
        pictureSource(img),
        largestSrcsetCandidate(img.getAttribute("srcset"))
      ], realContentURL);
      if (srcset) return srcset;

      var src = realContentURL(img.getAttribute("src"));
      if (src) return src;

      return firstURL([
        img.getAttribute("data-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-lazy-src"),
        img.getAttribute("data-hi-res-src"),
        img.getAttribute("data-image"),
        largestSrcsetCandidate(img.getAttribute("data-srcset")),
        largestSrcsetCandidate(img.getAttribute("data-lazy-srcset")),
        largestSrcsetCandidate(img.getAttribute("data-responsive-srcset"))
      ], realContentURL);
    }
    function dimensionValue(value) {
      if (value == null) return 0;
      var parsed = parseFloat(String(value).replace(/[^\d.]/g, ""));
      return isFinite(parsed) ? parsed : 0;
    }
    function imageDimensions(img) {
      var rect = img.getBoundingClientRect ? img.getBoundingClientRect() : {};
      return {
        renderedWidth: dimensionValue(rect && rect.width) ||
          dimensionValue(img.clientWidth) ||
          dimensionValue(img.offsetWidth),
        renderedHeight: dimensionValue(rect && rect.height) ||
          dimensionValue(img.clientHeight) ||
          dimensionValue(img.offsetHeight),
        naturalWidth: dimensionValue(img.naturalWidth) ||
          dimensionValue(img.getAttribute("width")) ||
          dimensionValue(img.getAttribute("data-width")),
        naturalHeight: dimensionValue(img.naturalHeight) ||
          dimensionValue(img.getAttribute("height")) ||
          dimensionValue(img.getAttribute("data-height"))
      };
    }
    function ancestorLabels(img) {
      var labels = [];
      var current = img.parentElement;
      var depth = 0;
      while (current && depth < 5) {
        labels.push(current.id || "");
        labels.push(current.className || "");
        labels.push(current.getAttribute("role") || "");
        current = current.parentElement;
        depth += 1;
      }
      return labels.join(" ");
    }
    function shouldSkipImage(img, src) {
      if (!src || src.length > 4096 || /^data:/i.test(src)) return true;
      if (isRecommendationRegion(img)) return true;
      var dimensions = imageDimensions(img);
      if (dimensions.renderedWidth > 0 && dimensions.renderedHeight > 0 &&
          (dimensions.renderedWidth < 64 || dimensions.renderedHeight < 64)) {
        return true;
      }
      if (dimensions.renderedWidth <= 0 && dimensions.renderedHeight <= 0 &&
          dimensions.naturalWidth > 0 && dimensions.naturalHeight > 0 &&
          (dimensions.naturalWidth < 64 || dimensions.naturalHeight < 64)) {
        return true;
      }
      if (img.closest && img.closest('nav, footer, aside, form, button, [role="navigation"], [role="contentinfo"], [role="complementary"]')) {
        return true;
      }
      var labels = [
        src,
        img.id || "",
        img.className || "",
        img.getAttribute("role") || "",
        img.getAttribute("alt") || "",
        img.getAttribute("title") || "",
        img.getAttribute("aria-label") || "",
        ancestorLabels(img)
      ].join(" ");
      return badImagePattern(labels);
    }
    function imageBlock(img, href) {
      var src = imageSource(img);
      if (shouldSkipImage(img, src)) return null;
      var block = {
        type: "image",
        src: src,
        alt: clean(img.getAttribute("alt") || img.getAttribute("title") || "")
      };
      if (href) block.href = href;
      return block;
    }

    var title = clean(attr('meta[property="og:title"]', "content")) ||
      clean(text("title")) ||
      clean(document.title);
    var siteName = clean(attr('meta[property="og:site_name"]', "content"));
    var description = clean(attr('meta[property="og:description"]', "content")) ||
      clean(attr('meta[name="description"]', "content"));
    function selectContentRoot() {
      var candidates = document.querySelectorAll('article, main, [role="main"]');
      var best = null;
      var bestScore = -1;
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (!candidate || isHidden(candidate)) continue;
        var textLength = clean(candidate.textContent || "").length;
        var imageCount = candidate.querySelectorAll
          ? candidate.querySelectorAll("img").length
          : 0;
        var score = textLength + imageCount * 800;
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return best || document.body;
    }
    var root = selectContentRoot();
    var contentBlocks = [];
    var textBuffer = "";
    var seenImages = {};
    var blockTags = {
      ADDRESS: true, ARTICLE: true, ASIDE: true, BLOCKQUOTE: true, DD: true,
      DETAILS: true, DIV: true, DL: true, DT: true, FIELDSET: true,
      FIGCAPTION: true, FIGURE: true, H1: true, H2: true, H3: true, H4: true,
      H5: true, H6: true, LI: true, MAIN: true, OL: true, P: true, PRE: true,
      SECTION: true, TABLE: true, TBODY: true, TD: true, TFOOT: true, TH: true,
      THEAD: true, TR: true, UL: true
    };
    var skippedTags = {
      SCRIPT: true, STYLE: true, NOSCRIPT: true, SVG: true, CANVAS: true,
      IFRAME: true, FORM: true, BUTTON: true, INPUT: true, SELECT: true,
      TEXTAREA: true, NAV: true, FOOTER: true, ASIDE: true
    };
    function appendText(value) {
      var cleaned = clean(value);
      if (!cleaned) return;
      if (textBuffer) textBuffer += " ";
      textBuffer += cleaned;
    }
    function flushText() {
      var paragraph = clean(textBuffer);
      if (paragraph) contentBlocks.push({ type: "text", text: paragraph });
      textBuffer = "";
    }
    function appendMarkdownLink(value, href) {
      var text = markdownLinkText(value);
      if (!text) return;
      appendText("[" + text + "](" + markdownURL(href) + ")");
    }
    function appendImage(img, href) {
      var image = imageBlock(img, href);
      if (image && !seenImages[image.src]) {
        seenImages[image.src] = true;
        contentBlocks.push(image);
      }
    }
    function isHidden(el) {
      if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
      if (!window.getComputedStyle) return false;
      var style = window.getComputedStyle(el);
      return style && (style.display === "none" || style.visibility === "hidden");
    }
    function walkLinkedAnchor(anchor, href) {
      var linkedTextBuffer = "";
      function appendLinkedText(value) {
        var cleaned = clean(value);
        if (!cleaned) return;
        if (linkedTextBuffer) linkedTextBuffer += " ";
        linkedTextBuffer += cleaned;
      }
      function flushLinkedText() {
        if (linkedTextBuffer) appendMarkdownLink(linkedTextBuffer, href);
        linkedTextBuffer = "";
      }
      function visit(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          appendLinkedText(node.nodeValue || "");
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        var el = node;
        var tag = el.tagName;
        if (skippedTags[tag] || isHidden(el)) return;
        if (tag === "IMG") {
          flushLinkedText();
          flushText();
          appendImage(el, href);
          return;
        }
        if (tag === "BR") {
          flushLinkedText();
          flushText();
          return;
        }

        var isBlock = !!blockTags[tag];
        if (isBlock) {
          flushLinkedText();
          flushText();
        }
        var children = el.childNodes || [];
        for (var i = 0; i < children.length; i++) visit(children[i]);
        if (isBlock) {
          flushLinkedText();
          flushText();
        }
      }
      var children = anchor.childNodes || [];
      for (var i = 0; i < children.length; i++) visit(children[i]);
      flushLinkedText();
    }
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      var el = node;
      var tag = el.tagName;
      if (skippedTags[tag] || isHidden(el)) return;
      if (tag === "A") {
        var href = absoluteLinkURL(el.getAttribute("href"));
        if (href) {
          walkLinkedAnchor(el, href);
          return;
        }
      }
      if (tag === "IMG") {
        flushText();
        appendImage(el, "");
        return;
      }
      if (tag === "BR") {
        flushText();
        return;
      }

      var isBlock = !!blockTags[tag];
      if (isBlock) flushText();
      var children = el.childNodes || [];
      for (var i = 0; i < children.length; i++) walk(children[i]);
      if (isBlock) flushText();
    }
    function seenImageCount() {
      var count = 0;
      for (var key in seenImages) {
        if (Object.prototype.hasOwnProperty.call(seenImages, key)) count += 1;
      }
      return count;
    }
    function appendURLImage(src, alt) {
      var resolved = realContentURL(src);
      if (!resolved || badImagePattern(resolved) || seenImages[resolved]) return false;
      seenImages[resolved] = true;
      contentBlocks.push({
        type: "image",
        src: resolved,
        alt: clean(alt || "")
      });
      return true;
    }
    function isRecommendationRegion(img) {
      var current = img;
      while (current) {
        var labels = [
          current.id || "",
          current.className || "",
          current.getAttribute && current.getAttribute("role") || "",
          current.getAttribute && current.getAttribute("aria-label") || "",
          current.getAttribute && current.getAttribute("data-testid") || "",
          current.getAttribute && current.getAttribute("data-component") || ""
        ].join(" ").toLowerCase();
        if (/(^|[\s_-])(related(?:[\s_-]?(?:content|stories|articles|posts))?|recommend(?:ation|ations|ed)?|more[\s_-]?(?:stories|articles|posts)|read[\s_-]?next|you[\s_-]?may[\s_-]?also[\s_-]?like|suggested|trending)([\s_-]|$)/.test(labels)) {
          return true;
        }
        if (current === root) break;
        current = current.parentElement;
      }
      return false;
    }
    function appendSupplementalContentImages() {
      var selectors = [
        "img",
        ".ContentParagraph-Image",
        ".ContentParagraph img",
        "img[data-src]",
        "img[data-original]",
        "img[data-lazy-src]",
        "img[data-hi-res-src]",
        "img[data-srcset]",
        "img[data-lazy-srcset]"
      ];
      var nodes = [];
      var seenNodes = [];
      function pushNode(node) {
        if (!node || node.tagName !== "IMG" || seenNodes.indexOf(node) >= 0) return;
        seenNodes.push(node);
        nodes.push(node);
      }
      for (var s = 0; s < selectors.length; s++) {
        var matches = root.querySelectorAll(selectors[s]);
        for (var m = 0; m < matches.length; m++) pushNode(matches[m]);
      }

      var added = 0;
      for (var n = 0; n < nodes.length; n++) {
        if (added >= 200) break;
        if (isRecommendationRegion(nodes[n])) continue;
        var image = imageBlock(nodes[n], "");
        if (image && !seenImages[image.src]) {
          seenImages[image.src] = true;
          contentBlocks.push(image);
          added += 1;
        }
      }
    }
    walk(root);
    flushText();
    appendSupplementalContentImages();
    if (seenImageCount() === 0) {
      appendURLImage(
        attr('meta[property="og:image"]', "content") ||
          attr('meta[name="twitter:image"]', "content"),
        title
      );
    }

    var paragraphs = [];
    for (var i = 0; i < contentBlocks.length; i++) {
      if (contentBlocks[i].type === "text") paragraphs.push(contentBlocks[i].text);
    }

    return JSON.stringify({
      ok: true,
      contentType: document.contentType || "",
      title: title,
      siteName: siteName,
      description: description,
      blocks: contentBlocks,
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

private let snapshotSizeScript = #"""
(function() {
  var body = document.body || {};
  var root = document.documentElement || {};
  var height = Math.max(
    body.scrollHeight || 0,
    body.offsetHeight || 0,
    root.clientHeight || 0,
    root.scrollHeight || 0,
    root.offsetHeight || 0
  );
  var width = Math.max(
    body.scrollWidth || 0,
    body.offsetWidth || 0,
    root.clientWidth || 0,
    root.scrollWidth || 0,
    root.offsetWidth || 0
  );
  return JSON.stringify({ width: width, height: height });
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
    let generation: String?
}

private struct CaptureMeta: Encodable {
    let url: String
    var title: String?
    var siteName: String?
    var description: String?
    let capturedBy: String
    var error: String?
    var screenshotIndex: Int? = nil
    var screenshotCount: Int? = nil
    var isFinal = false
    var generation: String? = nil
}

private struct PageCapture {
    let finalURL: URL
    let title: String?
    let siteName: String?
    let description: String?
    let readable: String?
    let screenshots: [Data]
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
    let blocks: [ReadableBlock]?
    let paragraphs: [String]?
}

private struct ReadableBlock: Decodable {
    let type: String
    let text: String?
    let src: String?
    let alt: String?
    let href: String?
}

private struct PageSnapshotSize: Decodable {
    let width: Double
    let height: Double
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

private struct CaptureArtifact {
    let data: Data
    let filename: String
    let contentType: String
}

private struct CaptureReadableAsset {
    let originalURL: String
    let field: String
    let artifact: CaptureArtifact
}

private struct CaptureAssetManifestEntry: Encodable {
    let field: String
    let originalUrl: String
    let filename: String
    let contentType: String
}

private struct PreparedPageCapture {
    let readable: String?
    let screenshots: [Data]
}

private enum ScreenshotCodec {
    case webP
    case jpeg

    var utType: UTType {
        switch self {
        case .webP: return .webP
        case .jpeg: return .jpeg
        }
    }

    var contentType: String {
        switch self {
        case .webP: return "image/webp"
        case .jpeg: return "image/jpeg"
        }
    }

    var fileExtension: String {
        switch self {
        case .webP: return "webp"
        case .jpeg: return "jpg"
        }
    }
}

private struct PDFPageGeometry {
    let box: PDFDisplayBox
    let bounds: CGRect
}

private struct PDFPageRenderPlan {
    let page: PDFPage
    let box: PDFDisplayBox
    let size: NSSize
    let gapBefore: CGFloat
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

private func looksLikePDF(_ data: Data) -> Bool {
    let marker = Data("%PDF-".utf8)
    let prefix = Data(data.prefix(1024))
    return prefix.range(of: marker) != nil
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
        let requestTimeout = request.timeoutInterval > 0 ? request.timeoutInterval : 60
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = max(requestTimeout, min(120, requestTimeout * 2))
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
