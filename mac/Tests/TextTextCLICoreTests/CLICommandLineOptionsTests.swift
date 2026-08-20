import XCTest

@testable import TextTextCLICore

final class CLICommandLineOptionsTests: XCTestCase {
    func testParsesActorIntentAndStableRetryKey() throws {
        let options = try CLICommandLineOptions.parse([
            "append", "Notes/Log.textpack", "--as", "Codex", "--message",
            "Record the result", "--idempotency-key", "task-123", "--json",
        ])

        XCTAssertEqual(options.command, "append")
        XCTAssertEqual(options.positional, ["Notes/Log.textpack"])
        XCTAssertEqual(options.actor, "Codex")
        XCTAssertEqual(options.message, "Record the result")
        XCTAssertEqual(options.idempotencyKey, "task-123")
        XCTAssertTrue(options.json)
    }

    func testRejectsUnknownOptions() {
        XCTAssertThrowsError(try CLICommandLineOptions.parse(["ls", "--wat"])) {
            XCTAssertEqual($0 as? CLIArgumentError, .unknownOption("--wat"))
        }
    }

    func testRejectsMissingOptionValues() {
        XCTAssertThrowsError(try CLICommandLineOptions.parse(["read", "Doc", "--section"])) {
            XCTAssertEqual($0 as? CLIArgumentError, .missingValue("--section"))
        }
    }

    func testRejectsIntentWithoutAnActorLabel() {
        XCTAssertThrowsError(
            try CLICommandLineOptions.parse([
                "write", "Doc", "--message", "Tighten it",
            ])
        ) {
            XCTAssertEqual($0 as? CLIArgumentError, .messageRequiresActor)
        }
    }
}
