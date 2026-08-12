import XCTest
@testable import TextTextWorkspaceCore

final class CodexAppServerTests: XCTestCase {
    func testParsesNotificationsWithoutExposingSecrets() throws {
        let message = try CodexAppServerMessage(data: Data(#"{"method":"account/rateLimits/updated","params":{"rateLimits":{"planType":"pro"}}}"#.utf8))
        XCTAssertEqual(message.method, "account/rateLimits/updated")
        XCTAssertNil(message.id)
        XCTAssertNil(message.errorMessage)
    }

    func testRejectsNonObjectMessages() {
        XCTAssertThrowsError(try CodexAppServerMessage(data: Data(#"["not-json-rpc"]"#.utf8))) { error in
            XCTAssertEqual(error as? CodexAppServerError, .invalidMessage)
        }
    }

    func testRuntimeLocatorFindsOnlyExecutableCandidates() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-codex-runtime-(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }

        let helper = temporary.appendingPathComponent("Contents/Helpers/codex")
        try FileManager.default.createDirectory(at: helper.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("#!/bin/sh\n".utf8).write(to: helper)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: helper.path)

        let locator = CodexRuntimeLocator(bundleURL: temporary)
        XCTAssertEqual(locator.executableURL, helper)
    }
}
