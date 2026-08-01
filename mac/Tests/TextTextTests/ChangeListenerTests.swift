import XCTest
@testable import TextText

final class ChangeListenerBackoffTests: XCTestCase {
    func testDelayUsesBoundedExponentialCeilingAndEqualJitter() {
        var backoff = ChangeListenerBackoff(initialDelay: 2, maximumDelay: 8)

        XCTAssertEqual(backoff.nextDelay(randomUnitInterval: 0), 1)
        XCTAssertEqual(backoff.nextDelay(randomUnitInterval: 0.5), 3)
        XCTAssertEqual(backoff.nextDelay(randomUnitInterval: 1), 8)
        XCTAssertEqual(backoff.nextDelay(randomUnitInterval: 1), 8)
        XCTAssertEqual(backoff.attempt, 4)
    }

    func testJitterInputIsClampedAndNonFiniteInputUsesMidpoint() {
        var low = ChangeListenerBackoff(initialDelay: 4, maximumDelay: 20)
        var high = ChangeListenerBackoff(initialDelay: 4, maximumDelay: 20)
        var nonFinite = ChangeListenerBackoff(initialDelay: 4, maximumDelay: 20)

        XCTAssertEqual(low.nextDelay(randomUnitInterval: -10), 2)
        XCTAssertEqual(high.nextDelay(randomUnitInterval: 10), 4)
        XCTAssertEqual(nonFinite.nextDelay(randomUnitInterval: .nan), 3)
    }

    func testResetRestartsAtInitialDelay() {
        var backoff = ChangeListenerBackoff(initialDelay: 1, maximumDelay: 8)
        _ = backoff.nextDelay(randomUnitInterval: 1)
        _ = backoff.nextDelay(randomUnitInterval: 1)
        _ = backoff.nextDelay(randomUnitInterval: 1)

        backoff.reset()

        XCTAssertEqual(backoff.attempt, 0)
        XCTAssertEqual(backoff.nextDelay(randomUnitInterval: 1), 1)
    }

    func testRepeatedFailuresNeverExceedMaximumDelay() {
        var backoff = ChangeListenerBackoff(initialDelay: 1, maximumDelay: 30)

        for _ in 0..<100 {
            XCTAssertLessThanOrEqual(backoff.nextDelay(randomUnitInterval: 1), 30)
        }
    }
}

final class ChangeListenerRetryPolicyTests: XCTestCase {
    func testHonorsRetryAfterSecondsForServiceUnavailable() throws {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: URL(string: "https://TextText.app/api/sync/v1/changes")!,
            statusCode: 503,
            httpVersion: nil,
            headerFields: ["Retry-After": "300"]
        ))

        XCTAssertEqual(
            ChangeListenerRetryPolicy.serverDelay(response: response),
            300
        )
    }

    func testCapsServerRetryAndIgnoresUnrelatedResponses() throws {
        let unavailable = try XCTUnwrap(HTTPURLResponse(
            url: URL(string: "https://TextText.app/api/sync/v1/changes")!,
            statusCode: 503,
            httpVersion: nil,
            headerFields: ["Retry-After": "99999"]
        ))
        let unauthorized = try XCTUnwrap(HTTPURLResponse(
            url: URL(string: "https://TextText.app/api/sync/v1/changes")!,
            statusCode: 401,
            httpVersion: nil,
            headerFields: ["Retry-After": "300"]
        ))

        XCTAssertEqual(
            ChangeListenerRetryPolicy.serverDelay(response: unavailable),
            ChangeListenerRetryPolicy.maximumServerDelay
        )
        XCTAssertNil(ChangeListenerRetryPolicy.serverDelay(response: unauthorized))
    }
}
