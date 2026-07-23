import XCTest
@testable import Write

final class WebAppSessionRequestTests: XCTestCase {
    func testSessionRequestKeepsTokenInAuthorizationHeader() throws {
        let request = WebAppWindowController.sessionRequest(
            origin: URL(string: "https://texttext.app")!,
            token: "wsk_secret",
            nextPath: "/t/workspace/post?edit=1"
        )

        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "Bearer wsk_secret"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-write-app"), "1")
        XCTAssertFalse(try XCTUnwrap(request.url?.absoluteString).contains("wsk_secret"))
        XCTAssertEqual(
            URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "next" })?.value,
            "/t/workspace/post?edit=1"
        )
    }
}
