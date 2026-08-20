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

    func testStandaloneCredentialSaveCreatesPrivateCLIHandshake() throws {
        let container = try makeContainer()
        let cliCredential = root.appendingPathComponent(
            "Application Support/TextText/credentials.json")
        let store = StateStore(
            groupContainer: container,
            cliCredentialsURL: cliCredential
        )
        let credential = Credentials(
            token: "wsk_first",
            serverOrigin: "https://texttext.app",
            tokenName: "Mac",
            linkedAt: Date(timeIntervalSince1970: 1)
        )

        store.saveCredentials(credential)

        let loaded = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: cliCredential))
                as? [String: Any]
        )
        XCTAssertEqual(loaded["token"] as? String, "wsk_first")
        XCTAssertEqual(loaded["serverOrigin"] as? String, "https://texttext.app")
        let fileMode = try FileManager.default.attributesOfItem(atPath: cliCredential.path)[
            .posixPermissions
        ] as? NSNumber
        let directoryMode = try FileManager.default.attributesOfItem(
            atPath: cliCredential.deletingLastPathComponent().path
        )[.posixPermissions] as? NSNumber
        XCTAssertEqual(fileMode?.int16Value, 0o600)
        XCTAssertEqual(directoryMode?.int16Value, 0o700)
    }

    func testRelinkRefreshesCLIHandshakeAndSignOutRemovesIt() throws {
        let container = try makeContainer()
        let cliCredential = root.appendingPathComponent(
            "Application Support/TextText/credentials.json")
        let store = StateStore(
            groupContainer: container,
            cliCredentialsURL: cliCredential
        )

        store.saveCredentials(Credentials(
            token: "wsk_old",
            serverOrigin: "https://texttext.app",
            tokenName: "Mac",
            linkedAt: Date(timeIntervalSince1970: 1)
        ))
        store.saveCredentials(Credentials(
            token: "wsk_new",
            serverOrigin: "https://texttext.app",
            tokenName: "Mac",
            linkedAt: Date(timeIntervalSince1970: 2)
        ))

        let loaded = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: cliCredential))
                as? [String: Any]
        )
        XCTAssertEqual(loaded["token"] as? String, "wsk_new")

        store.deleteCredentials()

        XCTAssertFalse(FileManager.default.fileExists(atPath: cliCredential.path))
        XCTAssertNil(store.loadCredentials())
    }

    func testLoadingExistingGroupCredentialCreatesMissingCLIHandshake() throws {
        let container = try makeContainer()
        let cliCredential = root.appendingPathComponent(
            "Application Support/TextText/credentials.json")
        let store = StateStore(
            groupContainer: container,
            cliCredentialsURL: cliCredential
        )
        store.saveCredentials(Credentials(
            token: "wsk_current",
            serverOrigin: "https://texttext.app",
            tokenName: "Mac",
            linkedAt: Date(timeIntervalSince1970: 3)
        ))
        try FileManager.default.removeItem(at: cliCredential)

        XCTAssertEqual(store.loadCredentials()?.token, "wsk_current")

        let handedOff = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: cliCredential))
                as? [String: Any]
        )
        XCTAssertEqual(handedOff["token"] as? String, "wsk_current")
    }

    func testLoadingExistingGroupCredentialRefreshesStaleCLIHandshake() throws {
        let container = try makeContainer()
        let cliCredential = root.appendingPathComponent(
            "Application Support/TextText/credentials.json")
        let store = StateStore(
            groupContainer: container,
            cliCredentialsURL: cliCredential
        )
        store.saveCredentials(Credentials(
            token: "wsk_current",
            serverOrigin: "https://texttext.app",
            tokenName: "Mac",
            linkedAt: Date(timeIntervalSince1970: 4)
        ))
        try Data(#"{"token":"wsk_stale"}"#.utf8).write(to: cliCredential, options: .atomic)

        XCTAssertEqual(store.loadCredentials()?.token, "wsk_current")

        let handedOff = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: cliCredential))
                as? [String: Any]
        )
        XCTAssertEqual(handedOff["token"] as? String, "wsk_current")
    }

    func testLoadingIsolatedCredentialDoesNotCreateCLIHandshake() throws {
        let container = try makeContainer()
        let wouldBeHandshake = root.appendingPathComponent(
            "Application Support/TextText/credentials.json")
        let store = StateStore(
            groupContainer: container,
            cliCredentialsURL: nil
        )
        store.saveCredentials(Credentials(
            token: "wsk_isolated",
            serverOrigin: "https://texttext.app",
            tokenName: "Test",
            linkedAt: Date(timeIntervalSince1970: 5)
        ))

        XCTAssertEqual(store.loadCredentials()?.token, "wsk_isolated")
        XCTAssertFalse(FileManager.default.fileExists(atPath: wouldBeHandshake.path))
    }
}

/// The container choice is what actually decides whether the two editions share
/// state, and the failure is silent: each edition works fine on its own while
/// pointing at a different directory.
final class AppGroupContainerChoiceTests: XCTestCase {
    private let team = URL(fileURLWithPath: "/g/52WM463HR2.group.app.texttext", isDirectory: true)
    private let naive = URL(fileURLWithPath: "/g/group.app.texttext", isDirectory: true)

    func testSandboxedTrustsTheSystemContainer() {
        let chosen = AppGroupContainer.choose(
            systemContainer: team, isSandboxed: true,
            candidates: [team, naive], isUsable: { _ in true })
        XCTAssertEqual(chosen, team)
    }

    /// The regression this exists for: outside the sandbox the system hands back
    /// the naive path, and an empty leftover directory made it look real.
    func testUnsandboxedIgnoresTheNaiveSystemAnswer() {
        let chosen = AppGroupContainer.choose(
            systemContainer: naive, isSandboxed: false,
            candidates: [team, naive], isUsable: { _ in true })
        XCTAssertEqual(chosen, team, "both editions must land on the team-prefixed container")
    }

    func testUnsandboxedFallsBackWhenOnlyTheNaiveOneExists() {
        let chosen = AppGroupContainer.choose(
            systemContainer: naive, isSandboxed: false,
            candidates: [team, naive], isUsable: { $0 == self.naive })
        XCTAssertEqual(chosen, naive)
    }

    /// The 2026-08-16 regression: the team-prefixed container exists from an
    /// older install, but this edition cannot write to it, and choosing it
    /// silently swallowed every save. Existence is not usability.
    func testUnsandboxedSkipsAContainerItCannotWriteTo() {
        let chosen = AppGroupContainer.choose(
            systemContainer: naive, isSandboxed: false,
            candidates: [team, naive], isUsable: { $0 != self.team })
        XCTAssertEqual(chosen, naive)
    }

    /// And when neither can be written to, nil, so StateStore falls back to
    /// Application Support rather than writing into a hole.
    func testUnsandboxedReturnsNilWhenNothingIsWritable() {
        XCTAssertNil(AppGroupContainer.choose(
            systemContainer: naive, isSandboxed: false,
            candidates: [team, naive], isUsable: { _ in false }))
    }

    func testNoContainerAtAll() {
        XCTAssertNil(AppGroupContainer.choose(
            systemContainer: naive, isSandboxed: false,
            candidates: [team, naive], isUsable: { _ in false }))
        XCTAssertNil(AppGroupContainer.choose(
            systemContainer: nil, isSandboxed: true,
            candidates: [], isUsable: { _ in true }))
    }
}
