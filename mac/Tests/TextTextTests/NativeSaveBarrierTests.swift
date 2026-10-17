import XCTest
@testable import TextTextApp

@MainActor
final class NativeSaveBarrierTests: XCTestCase {
    func testConcurrentCloseRequestsShareOnePersistenceOperation() {
        var expire: (@MainActor () -> Void)?
        let barrier = NativeSaveBarrier(schedule: { _, action in expire = action; return {} })
        var finish: NativeSaveBarrier.Finish?
        var results: [Bool] = []
        barrier.request(operation: { finish = $0 }, completion: { results.append($0) })
        barrier.request(operation: { _ in XCTFail("A pending save must be shared") }, completion: { results.append($0) })
        XCTAssertTrue(results.isEmpty)
        XCTAssertTrue(finish?(true) == true)
        XCTAssertEqual(results, [true, true])
        XCTAssertFalse(finish?(false) == true)
        expire?()
        XCTAssertEqual(results, [true, true])
    }

    func testTimeoutRejectsLateReceiptAndAllowsAnIndependentRetry() {
        var expire: (@MainActor () -> Void)?
        let barrier = NativeSaveBarrier(schedule: { _, action in expire = action; return {} })
        var first: NativeSaveBarrier.Finish?, second: NativeSaveBarrier.Finish?
        var results: [Bool] = []
        barrier.request(operation: { first = $0 }, completion: { results.append($0) })
        expire?()
        XCTAssertEqual(results, [false])
        barrier.request(operation: { second = $0 }, completion: { results.append($0) })
        XCTAssertFalse(first?(true) == true)
        XCTAssertEqual(results, [false])
        XCTAssertTrue(second?(true) == true)
        XCTAssertEqual(results, [false, true])
    }

    func testFailedOrCancelledSaveNeverAuthorizesClose() {
        let barrier = NativeSaveBarrier(schedule: { _, _ in {} })
        var finish: NativeSaveBarrier.Finish?
        var results: [Bool] = []
        barrier.request(operation: { finish = $0 }, completion: { results.append($0) })
        barrier.cancel()
        XCTAssertEqual(results, [false])
        XCTAssertFalse(finish?(true) == true)
        barrier.request(operation: { _ = $0(false) }, completion: { results.append($0) })
        XCTAssertEqual(results, [false, false])
    }
}
