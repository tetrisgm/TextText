import XCTest
@testable import TextTextApp

/// The callback check is the only thing standing between this app and a token
/// minted by a session somebody else started, so every way of getting it wrong
/// is pinned here.
final class AuthSessionCallbackTests: XCTestCase {
    private let state = "s0Zx8Kq1LmNpQrTuVwXy"

    private func callback(_ string: String) -> URL {
        URL(string: string)!
    }

    func testAcceptsItsOwnCallback() {
        let url = callback("texttext-app://auth?code=poll-secret&state=\(state)")
        XCTAssertEqual(AuthSessionController.codeFromCallback(url, expectedState: state), "poll-secret")
    }

    func testRejectsAStateThisAppDidNotIssue() {
        let url = callback("texttext-app://auth?code=poll-secret&state=somebody-elses-state")
        XCTAssertNil(AuthSessionController.codeFromCallback(url, expectedState: state))
    }

    func testRejectsACallbackWhenNothingIsPending() {
        let url = callback("texttext-app://auth?code=poll-secret&state=\(state)")
        XCTAssertNil(AuthSessionController.codeFromCallback(url, expectedState: nil))
        XCTAssertNil(AuthSessionController.codeFromCallback(url, expectedState: ""))
    }

    func testRejectsAForeignScheme() {
        for scheme in ["https", "texttext", "texttext-app-evil", "javascript"] {
            let url = callback("\(scheme)://auth?code=poll-secret&state=\(state)")
            XCTAssertNil(AuthSessionController.codeFromCallback(url, expectedState: state),
                         "\(scheme) must not be accepted")
        }
    }

    func testRejectsAMissingOrEmptyCode() {
        XCTAssertNil(AuthSessionController.codeFromCallback(
            callback("texttext-app://auth?state=\(state)"), expectedState: state))
        XCTAssertNil(AuthSessionController.codeFromCallback(
            callback("texttext-app://auth?code=&state=\(state)"), expectedState: state))
    }

    func testStateIsUnguessableAndURLSafe() {
        let allowed = CharacterSet(charactersIn:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        var seen = Set<String>()
        for _ in 0..<200 {
            let value = AuthSessionController.makeState()
            XCTAssertGreaterThanOrEqual(value.count, 40)
            XCTAssertNil(value.rangeOfCharacter(from: allowed.inverted),
                         "state must survive a URL unescaped: \(value)")
            XCTAssertFalse(seen.contains(value), "state repeated")
            seen.insert(value)
        }
    }

    func testAuthorizeURLTargetsTheServerAndCarriesTheState() throws {
        let url = try XCTUnwrap(AuthSessionController.authorizeURL(
            serverOrigin: URL(string: "https://texttext.app")!,
            state: state,
            device: "TextText on Ramine's Mac"))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "texttext.app")
        XCTAssertEqual(components.path, "/connect/app/native")
        XCTAssertEqual(components.queryItems?.first { $0.name == "state" }?.value, state)
        XCTAssertEqual(components.queryItems?.first { $0.name == "device" }?.value,
                       "TextText on Ramine's Mac")
    }

    func testExplicitRetryRejectsLateCompletionFromHiddenSession() throws {
        var attempts = AuthSessionAttempts()
        let hidden = try XCTUnwrap(attempts.begin(restartActive: false))
        XCTAssertNil(attempts.begin(restartActive: false))
        let retry = try XCTUnwrap(attempts.begin(restartActive: true))
        XCTAssertNotEqual(hidden, retry)
        XCTAssertFalse(attempts.finish(hidden), "Old cancellation or token reply must not clear the new session")
        XCTAssertTrue(attempts.isCurrent(retry))
        XCTAssertTrue(attempts.finish(retry))
        XCTAssertFalse(attempts.finish(retry), "A completed callback must not commit credentials twice")
    }

    func testCancelOrSignOutRejectsQueuedTokenReply() throws {
        var attempts = AuthSessionAttempts()
        let cancelled = try XCTUnwrap(attempts.begin(restartActive: false))
        attempts.cancel()
        XCTAssertFalse(attempts.finish(cancelled), "Sign-out must not be reversed by a late token reply")
        let next = try XCTUnwrap(attempts.begin(restartActive: false))
        XCTAssertFalse(attempts.finish(cancelled))
        XCTAssertTrue(attempts.isCurrent(next))
    }

    func testNativeSessionStatusAndFailureAreVisible() throws {
        XCTAssertNil(AuthSessionController.presentation(for: .idle))
        let pending = try XCTUnwrap(AuthSessionController.presentation(for: .presenting))
        XCTAssertFalse(pending.failed)
        XCTAssertTrue(pending.hint.contains("cancel"))
        let failed = try XCTUnwrap(AuthSessionController.presentation(for: .failed("Could not open the sign-in sheet")))
        XCTAssertTrue(failed.failed)
        XCTAssertEqual(failed.headline, "Could not open the sign-in sheet")
        XCTAssertTrue(failed.hint.contains("Try again"))
    }
}
