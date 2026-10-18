#if TEXTTEXT_STRESS_ACTOR
import XCTest
@testable import TextTextApp
final class NativeStressSoakSampleTests: XCTestCase {
    func testCurrentRunExactBoundedCorrelation() throws {
        for n in [0, 1, 120] {
            let value = try NativeStressSoakSample.validate(["version": 1, "id": "owned:soak:\(n)"], runId: "owned")
            XCTAssertEqual(value["id"] as? String, "owned:soak:\(n)")
        }
    }
    func testFutureForeignOrNoncanonicalCorrelationRefuses() {
        for value: [String: Any] in [["version": true, "id": "owned:soak:0"], ["version": 2, "id": "owned:soak:0"], ["version": 1, "id": "owned:soak:01"], ["version": 1, "id": "owned:soak:121"], ["version": 1, "id": "other:soak:0"], ["version": 1, "id": "owned:soak:0", "future": true]] {
            XCTAssertThrowsError(try NativeStressSoakSample.validate(value, runId: "owned"))
        }
        XCTAssertThrowsError(try NativeStressSoakSample.validate(["version": 1, "id": "owned:soak:0"], runId: nil))
        XCTAssertThrowsError(try NativeStressSoakSample.validate(["version": 1, "id": "owned\n:soak:0"], runId: "owned\n"))
    }
}
#endif
