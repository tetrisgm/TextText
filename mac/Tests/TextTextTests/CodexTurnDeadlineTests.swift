import XCTest
@testable import TextTextApp

/// What keeps a native turn alive.
///
/// The deadline behind "The TextText Agent stopped responding" measures
/// silence, not work: every App Server message that proves the agent is
/// running starts the clock over. This pins the list, because a message the
/// list forgets is a turn killed while it is still answering.
final class CodexTurnDeadlineTests: XCTestCase {
    func testStreamingAnAnswerKeepsTheTurnAlive() {
        XCTAssertTrue(
            WebAppWindowController.codexTurnProgress(
                method: "item/agentMessage/delta"))
        XCTAssertTrue(
            WebAppWindowController.codexTurnProgress(method: "item/started"))
        XCTAssertTrue(
            WebAppWindowController.codexTurnProgress(method: "item/completed"))
    }

    func testAskingForAToolKeepsTheTurnAlive() {
        XCTAssertTrue(
            WebAppWindowController.codexTurnProgress(method: "item/tool/call"))
        XCTAssertTrue(
            WebAppWindowController.codexTurnProgress(method: "turn/started"))
    }

    func testUnrelatedTrafficDoesNotHoldTheDeadlineOpenForever() {
        XCTAssertFalse(
            WebAppWindowController.codexTurnProgress(
                method: "remoteControl/status/changed"))
        XCTAssertFalse(
            WebAppWindowController.codexTurnProgress(method: "turn/completed"))
        XCTAssertFalse(WebAppWindowController.codexTurnProgress(method: nil))
    }
}
