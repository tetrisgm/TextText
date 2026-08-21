import XCTest
@testable import TextTextCLICore

final class AgentCaptureInputTests: XCTestCase {
    func testThoughtRoutesToNotes() {
        let capture = AgentCaptureInput(
            value: "A launch thought\n\nKeep the first run tiny.")
        XCTAssertEqual(capture?.title, "A launch thought")
        XCTAssertEqual(capture?.body, "Keep the first run tiny.")
        XCTAssertEqual(capture?.folder, "notes")
        XCTAssertEqual(capture?.kind, "note")
        XCTAssertNil(capture?.sourceURL)
    }

    func testConversationCapturePreservesItsTranscript() {
        let transcript = """
            ChatGPT conversation

            User: Explain why local files matter
            Assistant: They keep the durable source close.
            """
        let capture = AgentCaptureInput(value: transcript)
        XCTAssertEqual(capture?.title, "Explain why local files matter")
        XCTAssertEqual(capture?.body, transcript)
    }

    func testURLRoutesToBookmarks() {
        let capture = AgentCaptureInput(value: "paper.design/docs/mcp")
        XCTAssertEqual(capture?.title, "paper.design")
        XCTAssertEqual(capture?.body, "[paper.design](https://paper.design/docs/mcp)")
        XCTAssertEqual(capture?.folder, "bookmarks")
        XCTAssertEqual(capture?.kind, "bookmark")
        XCTAssertEqual(capture?.sourceURL, "https://paper.design/docs/mcp")
    }

    func testEmptyCaptureIsRejected() {
        XCTAssertNil(AgentCaptureInput(value: "  \n"))
    }
}
