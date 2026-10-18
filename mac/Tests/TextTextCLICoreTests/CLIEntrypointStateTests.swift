import Foundation
import XCTest

final class CLIEntrypointStateTests: XCTestCase {
    func testPrivateCreationRetryDoesNotRecreateUnavailablePublishedItem() throws {
        guard let executable = ProcessInfo.processInfo.environment["TEXTTEXT_CLI_ENTRYPOINT"] else {
            throw XCTSkip("requires the freshly built CLI entrypoint")
        }
        let fixture = FileManager.default.temporaryDirectory.appendingPathComponent("cli-entrypoint-" + UUID().uuidString).resolvingSymlinksInPath()
        let root = fixture.appendingPathComponent("Workspace"), state = fixture.appendingPathComponent("Private")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: fixture) }
        func invoke() throws -> (Int32, String) {
            let process = Process(), output = Pipe(), errors = Pipe(), input = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = ["new", "Private retry", "--folder", "Notes", "--idempotency-key", "private-state-retry", "--json", "--as", "codex", "--message", "Verify private CLI creation state"]
            var environment = ProcessInfo.processInfo.environment
            environment["TEXTTEXT_WORKSPACE_ROOT"] = root.path
            environment["TEXTTEXT_STATE_DIR"] = state.path
            process.environment = environment; process.standardOutput = output; process.standardError = errors; process.standardInput = input
            try process.run()
            try input.fileHandleForWriting.write(contentsOf: Data("CLI private fixture".utf8)); try input.fileHandleForWriting.close()
            let stdout = output.fileHandleForReading.readDataToEndOfFile()
            let stderr = errors.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return (process.terminationStatus, String(decoding: stdout + stderr, as: UTF8.self))
        }
        let first = try invoke(); XCTAssertEqual(first.0, 0, first.1)
        let target = root.appendingPathComponent("Notes/Private retry.textpack")
        let original = try Data(contentsOf: target)
        let second = try invoke(); XCTAssertEqual(second.0, 0, second.1)
        XCTAssertEqual(try Data(contentsOf: target), original)
        let entries = try FileManager.default.subpathsOfDirectory(atPath: state.path)
        XCTAssertTrue(entries.contains { $0.hasSuffix(".publication.json") })
        XCTAssertTrue(entries.contains { $0.hasSuffix(".lock") })
        for relative in try FileManager.default.subpathsOfDirectory(atPath: root.path) {
            XCTAssertFalse(relative.hasSuffix(".json") || relative.hasSuffix(".lock"), relative)
        }
        // Retain the actual published bytes outside the workspace, then prove
        // the old key cannot silently create a replacement from its private copy.
        try FileManager.default.moveItem(at: target, to: fixture.appendingPathComponent("Retained.textpack"))
        let unavailable = try invoke(); XCTAssertNotEqual(unavailable.0, 0)
        XCTAssertTrue(unavailable.1.contains("no replacement was created"), unavailable.1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(try Data(contentsOf: fixture.appendingPathComponent("Retained.textpack")), original)
    }
}
