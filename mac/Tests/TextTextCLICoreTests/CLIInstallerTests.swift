import XCTest

@testable import TextTextCLICore

final class CLIInstallerTests: XCTestCase {
    func testInstallsWhenDestinationIsAbsent() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("TextText.app/Contents/Helpers/texttext")
        try FileManager.default.createDirectory(
            at: source.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: source)
        let destination = root.appendingPathComponent("bin/texttext")

        try CLIInstaller.install(source: source, destination: destination)

        XCTAssertEqual(
            try FileManager.default.destinationOfSymbolicLink(atPath: destination.path),
            source.path)
    }

    func testReplacesOnlyItsOwnExistingSymlink() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("TextText.app/Contents/Helpers/texttext")
        let destination = root.appendingPathComponent("bin/texttext")
        try FileManager.default.createDirectory(
            at: source.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: source)
        try FileManager.default.createSymbolicLink(
            at: destination, withDestinationURL: source)

        XCTAssertNoThrow(
            try CLIInstaller.install(source: source, destination: destination))
    }

    func testRefusesAndPreservesAnUnrelatedFile() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("helper")
        let destination = root.appendingPathComponent("bin/texttext")
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("ours".utf8).write(to: source)
        try Data("someone else's command".utf8).write(to: destination)

        XCTAssertThrowsError(
            try CLIInstaller.install(source: source, destination: destination))
        XCTAssertEqual(
            try String(contentsOf: destination, encoding: .utf8),
            "someone else's command")
    }

    func testRefusesAndPreservesAnUnrelatedSymlink() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("helper")
        let other = root.appendingPathComponent("other")
        let destination = root.appendingPathComponent("bin/texttext")
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: source)
        try Data().write(to: other)
        try FileManager.default.createSymbolicLink(
            at: destination, withDestinationURL: other)

        XCTAssertThrowsError(
            try CLIInstaller.install(source: source, destination: destination))
        XCTAssertEqual(
            try FileManager.default.destinationOfSymbolicLink(atPath: destination.path),
            other.path)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "texttext-cli-install-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
        return url
    }
}
