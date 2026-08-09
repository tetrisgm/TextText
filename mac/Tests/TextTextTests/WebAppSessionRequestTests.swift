import XCTest
@testable import TextTextApp

final class WebAppSessionRequestTests: XCTestCase {
    func testSessionRequestKeepsTokenInAuthorizationHeader() throws {
        let request = WebAppWindowController.sessionRequest(
            origin: URL(string: "https://TextText.app")!,
            token: "wsk_secret",
            nextPath: "/t/workspace/post?edit=1"
        )

        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "Bearer wsk_secret"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-texttext-app"), "1")
        XCTAssertFalse(try XCTUnwrap(request.url?.absoluteString).contains("wsk_secret"))
        XCTAssertEqual(
            URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "next" })?.value,
            "/t/workspace/post?edit=1"
        )
    }

    func testRejectedLegacySessionShowsRelinkState() {
        XCTAssertEqual(
            WebAppWindowController.sessionRecoveryPath(for: 401),
            "/signin?app=1"
        )
        XCTAssertEqual(
            WebAppWindowController.sessionRecoveryPath(for: 403),
            "/signin?app=1"
        )
    }

    func testServerSessionFailureShowsConfigurationState() {
        XCTAssertEqual(
            WebAppWindowController.sessionRecoveryPath(for: 500),
            "/signin?error=Configuration"
        )
        XCTAssertNil(WebAppWindowController.sessionRecoveryPath(for: 302))
    }
}
