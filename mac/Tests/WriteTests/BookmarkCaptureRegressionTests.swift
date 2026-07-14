import WebKit
import XCTest
@testable import Write

private struct CaptureExtractionResult: Decodable {
    struct Block: Decodable {
        let type: String
        let src: String?
    }

    let ok: Bool
    let blocks: [Block]
}

@MainActor
private final class CaptureFixtureNavigationDelegate: NSObject, WKNavigationDelegate {
    private var continuation: CheckedContinuation<Void, Error>?

    func load(_ html: String, in webView: WKWebView) async throws {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            webView.navigationDelegate = self
            webView.loadHTMLString(
                html,
                baseURL: URL(string: "https://news.example/articles/long-lazy-story")
            )
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        continuation?.resume()
        continuation = nil
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

final class BookmarkCaptureRegressionTests: XCTestCase {
    func testLongPageTilePlanIsContiguousAndCoversThePage() {
        let pageHeight: CGFloat = 84_123
        let tiles = bookmarkCaptureScreenshotTilePlan(pageHeight: pageHeight)

        XCTAssertEqual(tiles.count, 22)
        XCTAssertEqual(tiles.first?.y, 0)
        XCTAssertEqual(tiles.last.map { $0.y + $0.height }, pageHeight)
        XCTAssertTrue(tiles.allSatisfy { $0.height > 0 && $0.height <= 4000 })
        for index in 1..<tiles.count {
            XCTAssertEqual(tiles[index - 1].y + tiles[index - 1].height, tiles[index].y)
        }
    }

    @MainActor
    func testLongLazyArticleSupplementsEveryArticleImageAndRejectsRecommendations() async throws {
        let lazyImages = (1...60).map { index in
            """
            <img class="deferred" width="1280" height="720"
                 src="/placeholder-\(index).gif"
                 data-src="https://images.example/article-\(index).jpg"
                 alt="Article image \(index)">
            """
        }.joined(separator: "\n")
        let recommendations = (1...12).map { index in
            """
            <img width="1280" height="720"
                 src="https://images.example/recommendation-\(index).jpg"
                 alt="Recommendation \(index)">
            """
        }.joined(separator: "\n")
        let html = """
        <!doctype html>
        <html>
        <head>
          <title>Long lazy story</title>
          <style>.deferred { display: none; }</style>
        </head>
        <body>
          <article>
            <h1>Long lazy story</h1>
            <p>This is the selected article root with enough text to win root selection.</p>
            <img width="1280" height="720"
                 src="https://images.example/hero.jpg" alt="Hero">
            \(lazyImages)
            <section class="relatedStories recommendations">
              <h2>Related stories</h2>
              \(recommendations)
            </section>
          </article>
        </body>
        </html>
        """

        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1280, height: 900))
        let navigation = CaptureFixtureNavigationDelegate()
        try await navigation.load(html, in: webView)
        let value = try await webView.evaluateJavaScript(readableExtractionScript)
        let json = try XCTUnwrap(value as? String)
        let result = try JSONDecoder().decode(
            CaptureExtractionResult.self,
            from: try XCTUnwrap(json.data(using: .utf8))
        )
        let sources = result.blocks.compactMap { $0.type == "image" ? $0.src : nil }
        XCTAssertTrue(result.ok)
        XCTAssertEqual(sources.count, 61)
        XCTAssertTrue(sources.contains("https://images.example/hero.jpg"))
        for index in 1...60 {
            XCTAssertTrue(sources.contains("https://images.example/article-\(index).jpg"))
        }
        XCTAssertFalse(sources.contains { $0.contains("recommendation-") })
    }
}
