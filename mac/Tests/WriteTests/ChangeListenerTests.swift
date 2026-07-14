import XCTest
@testable import Write

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
