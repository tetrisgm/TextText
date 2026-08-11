import XCTest
@testable import TextTextApp

/// The verify URL is the whole sign-in flow on this app.
///
/// Pressing a sign-in button cancels the web navigation, asks the server for a
/// device-link code, and opens the returned approval URL in the browser. If
/// this validator rejects that URL, the link row still exists server side and
/// the only visible effect is the page reloading, so sign-in appears to do
/// nothing at all. That shipped: the app was configured with
/// https://TextText.app while the server answers https://texttext.app, and the
/// host comparison was case-sensitive.
final class LinkVerifyURLTests: XCTestCase {
    private func origin(_ raw: String) -> URL {
        guard let url = URL(string: raw) else {
            fatalError("bad test origin \(raw)")
        }
        return url
    }

    func testAcceptsHostDifferingOnlyByCase() {
        // The exact pairing that broke sign-in in 0.169 through 0.172.
        let url = LinkController.validatedVerifyURL(
            "https://texttext.app/connect/link?code=ABCD-1234",
            serverOrigin: origin("https://TextText.app"))
        XCTAssertNotNil(url, "DNS hosts are case-insensitive; this is the app's own server")
        XCTAssertEqual(url?.absoluteString, "https://texttext.app/connect/link?code=ABCD-1234")
    }

    func testAcceptsMatchingHost() {
        XCTAssertNotNil(LinkController.validatedVerifyURL(
            "https://texttext.app/connect/link?code=A",
            serverOrigin: origin("https://texttext.app")))
    }

    func testRejectsDifferentHost() {
        // The reason the check exists: a server response must never become an
        // arbitrary-URL launch.
        XCTAssertNil(LinkController.validatedVerifyURL(
            "https://evil.example/connect/link?code=A",
            serverOrigin: origin("https://texttext.app")))
    }

    func testRejectsLookalikeSuffixHost() {
        XCTAssertNil(LinkController.validatedVerifyURL(
            "https://texttext.app.evil.example/connect/link?code=A",
            serverOrigin: origin("https://texttext.app")))
    }

    func testRejectsPortMismatch() {
        XCTAssertNil(LinkController.validatedVerifyURL(
            "https://texttext.app:8443/connect/link?code=A",
            serverOrigin: origin("https://texttext.app")))
    }

    func testRejectsPlainHTTPOnAPublicHost() {
        XCTAssertNil(LinkController.validatedVerifyURL(
            "http://texttext.app/connect/link?code=A",
            serverOrigin: origin("http://texttext.app")))
    }

    func testAllowsPlainHTTPOnLocalhostForDevelopment() {
        XCTAssertNotNil(LinkController.validatedVerifyURL(
            "http://localhost:3000/connect/link?code=A",
            serverOrigin: origin("http://localhost:3000")))
    }

    func testRejectsNonsense() {
        XCTAssertNil(LinkController.validatedVerifyURL(
            "not a url", serverOrigin: origin("https://texttext.app")))
    }
}
