import XCTest
@testable import TextTextApp

/// The two editions must land on the same bytes. These pin the resolution order
/// and the one-time carry-forward, both of which decide whether installing the
/// same app a different way signs you out.
final class StateStoreLocationTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("statestore-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func makeContainer() throws -> URL {
        let container = root.appendingPathComponent("Group Containers/52WM463HR2.group.app.texttext",
                                                    isDirectory: true)
        try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        return container
    }

    func testUsesGroupContainerWhenOneExists() throws {
        let container = try makeContainer()
        let store = StateStore(groupContainer: container)
        XCTAssertEqual(store.baseDir, container.appendingPathComponent("TextText", isDirectory: true))
    }

    func testFallsBackToApplicationSupportWithoutAContainer() {
        let store = StateStore(groupContainer: nil)
        XCTAssertEqual(store.baseDir, StateStore.legacyBaseDir())
    }

    func testEnvironmentOverrideStillWins() throws {
        let container = try makeContainer()
        let override = root.appendingPathComponent("explicit", isDirectory: true)
        setenv("TEXTTEXT_STATE_DIR", override.path, 1)
        defer { unsetenv("TEXTTEXT_STATE_DIR") }
        let store = StateStore(groupContainer: container)
        XCTAssertEqual(store.baseDir.standardizedFileURL, override.standardizedFileURL)
    }

    func testCarriesLegacyStateForwardOnce() throws {
        let container = try makeContainer()
        let legacy = StateStore.legacyBaseDir()
        let fm = FileManager.default

        // A real machine's legacy directory is the one this test cannot write to
        // safely, so drive the copy directly with a temporary stand-in.
        let source = root.appendingPathComponent("legacy", isDirectory: true)
        try fm.createDirectory(at: source, withIntermediateDirectories: true)
        try Data(#"{"token":"t"}"#.utf8)
            .write(to: source.appendingPathComponent("credentials.json"))
        try Data(#"{"blog":{}}"#.utf8)
            .write(to: source.appendingPathComponent("account.json"))

        let destination = container.appendingPathComponent("TextText", isDirectory: true)
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        StateStore.adoptLegacyStateForTesting(from: source, into: destination)

        XCTAssertTrue(fm.fileExists(atPath: destination.appendingPathComponent("credentials.json").path))
        XCTAssertTrue(fm.fileExists(atPath: destination.appendingPathComponent("account.json").path))
        XCTAssertNotEqual(destination, legacy, "the container must not be the legacy path")

        // The legacy copy stays put, so a rollback still has its state.
        XCTAssertTrue(fm.fileExists(atPath: source.appendingPathComponent("credentials.json").path))
    }

    func testExistingContainerStateIsNeverOverwritten() throws {
        let fm = FileManager.default
        let source = root.appendingPathComponent("legacy", isDirectory: true)
        let destination = root.appendingPathComponent("container/TextText", isDirectory: true)
        try fm.createDirectory(at: source, withIntermediateDirectories: true)
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        try Data(#"{"token":"stale"}"#.utf8)
            .write(to: source.appendingPathComponent("credentials.json"))
        try Data(#"{"token":"current"}"#.utf8)
            .write(to: destination.appendingPathComponent("credentials.json"))

        StateStore.adoptLegacyStateForTesting(from: source, into: destination)

        let kept = try String(contentsOf: destination.appendingPathComponent("credentials.json"),
                              encoding: .utf8)
        XCTAssertEqual(kept, #"{"token":"current"}"#)
    }

    func testCredentialsStayPrivateAfterTheCarryForward() throws {
        let fm = FileManager.default
        let source = root.appendingPathComponent("legacy", isDirectory: true)
        let destination = root.appendingPathComponent("container/TextText", isDirectory: true)
        try fm.createDirectory(at: source, withIntermediateDirectories: true)
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        let credentials = source.appendingPathComponent("credentials.json")
        try Data(#"{"token":"t"}"#.utf8).write(to: credentials)
        try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: credentials.path)

        StateStore.adoptLegacyStateForTesting(from: source, into: destination)

        let mode = try fm.attributesOfItem(
            atPath: destination.appendingPathComponent("credentials.json").path
        )[.posixPermissions] as? NSNumber
        XCTAssertEqual(mode?.int16Value, 0o600)
    }
}
