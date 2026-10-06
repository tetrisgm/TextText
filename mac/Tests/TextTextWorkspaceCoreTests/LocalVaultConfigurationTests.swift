import Foundation
import XCTest
@testable import TextTextWorkspaceCore

final class LocalVaultConfigurationTests: XCTestCase {
    func testCustomBundleContainerStartsFreshWhenHostGlobalLegacyIsUnreadable() throws {
        let fixture = try Fixture()
        let customContainerSupport = fixture.root.appendingPathComponent("Containers/custom.bundle/Data/Library/Application Support")
        let legacy = fixture.root.appendingPathComponent("host/Library/Application Support/TextText/vault.json")
        try FileManager.default.createDirectory(at: legacy.deletingLastPathComponent(), withIntermediateDirectories: true)
        let legacyBytes = Data("host-global setting that the sandbox cannot read".utf8)
        try legacyBytes.write(to: legacy)

        let loaded = try LocalVaultConfiguration.load(
            environment: [:],
            applicationSupportDirectory: customContainerSupport,
            legacyConfigurationURL: legacy,
            readData: { url in
                if url == legacy { throw CocoaError(.fileReadNoPermission) }
                return try Data(contentsOf: url)
            }
        )

        XCTAssertNil(loaded)
        XCTAssertEqual(
            LocalVaultConfiguration.configurationURL(environment: [:], applicationSupportDirectory: customContainerSupport),
            customContainerSupport.appendingPathComponent("TextText/vault.json")
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: customContainerSupport.appendingPathComponent("TextText/vault.json").path))
        XCTAssertEqual(try Data(contentsOf: legacy), legacyBytes)
    }

    func testValidCurrentContainerConfigurationWinsOverNewerLegacySetting() throws {
        let fixture = try Fixture()
        let support = fixture.root.appendingPathComponent("container/Data/Library/Application Support")
        let current = LocalVaultConfiguration.configurationURL(environment: [:], applicationSupportDirectory: support)
        let currentRoot = try fixture.directory("current-folder")
        let legacyRoot = try fixture.directory("legacy-folder")
        let legacy = fixture.root.appendingPathComponent("host/Library/Application Support/TextText/vault.json")
        try write(LocalVaultConfiguration(rootPath: currentRoot.path, bookmarkData: nil), to: current)
        try write(LocalVaultConfiguration(rootPath: legacyRoot.path, bookmarkData: nil), to: legacy)
        let originalLegacyBytes = try Data(contentsOf: legacy)
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: 600)], ofItemAtPath: legacy.path)

        let loaded = try XCTUnwrap(LocalVaultConfiguration.load(
            environment: [:], applicationSupportDirectory: support, legacyConfigurationURL: legacy
        ))

        XCTAssertEqual(loaded.root.standardizedFileURL, currentRoot.standardizedFileURL)
        XCTAssertEqual(try Data(contentsOf: legacy), originalLegacyBytes)
    }

    func testReadableLegacySettingsAreCopiedIntoCurrentContainerWithoutRemovingSource() throws {
        let fixture = try Fixture()
        let support = fixture.root.appendingPathComponent("container/Data/Library/Application Support")
        let selectedRoot = try fixture.directory("legacy-selected-folder")
        let legacy = fixture.root.appendingPathComponent("host/Library/Application Support/TextText/vault.json")
        try write(LocalVaultConfiguration(rootPath: selectedRoot.path, bookmarkData: nil), to: legacy)
        let legacyBytes = try Data(contentsOf: legacy)

        let loaded = try XCTUnwrap(LocalVaultConfiguration.load(
            environment: [:], applicationSupportDirectory: support, legacyConfigurationURL: legacy
        ))

        let current = LocalVaultConfiguration.configurationURL(environment: [:], applicationSupportDirectory: support)
        XCTAssertEqual(loaded.root.standardizedFileURL, selectedRoot.standardizedFileURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: current.path))
        XCTAssertEqual(try Data(contentsOf: legacy), legacyBytes)
    }

    func testExplicitDeveloperOverrideDoesNotFallBackToContainerOrLegacy() throws {
        let fixture = try Fixture()
        let support = fixture.root.appendingPathComponent("container/Data/Library/Application Support")
        let override = fixture.root.appendingPathComponent("developer/selected.json")
        let legacy = fixture.root.appendingPathComponent("host/Library/Application Support/TextText/vault.json")
        let selectedRoot = try fixture.directory("legacy-folder")
        try write(LocalVaultConfiguration(rootPath: selectedRoot.path, bookmarkData: nil), to: legacy)

        XCTAssertNil(try LocalVaultConfiguration.load(
            environment: ["TEXTTEXT_VAULT_CONFIG": override.path],
            applicationSupportDirectory: support,
            legacyConfigurationURL: legacy
        ))
        XCTAssertEqual(
            LocalVaultConfiguration.configurationURL(
                environment: ["TEXTTEXT_VAULT_CONFIG": override.path],
                applicationSupportDirectory: support
            ), override
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: support.appendingPathComponent("TextText/vault.json").path))
    }

    func testCorruptCurrentConfigurationRequiresRecoveryAndPreservesBackup() throws {
        let fixture = try Fixture()
        let support = fixture.root.appendingPathComponent("container/Data/Library/Application Support")
        let current = LocalVaultConfiguration.configurationURL(environment: [:], applicationSupportDirectory: support)
        try FileManager.default.createDirectory(at: current.deletingLastPathComponent(), withIntermediateDirectories: true)
        let corrupt = Data("{not-json".utf8)
        try corrupt.write(to: current)
        let selectedRoot = try fixture.directory("newly-selected")

        XCTAssertThrowsError(try LocalVaultConfiguration.load(
            environment: [:], applicationSupportDirectory: support,
            legacyConfigurationURL: fixture.root.appendingPathComponent("no-legacy.json")
        )) { error in
            guard case LocalVaultConfigurationError.corrupt(let url, _) = error else {
                return XCTFail("Expected corrupt-config recovery state, got \(error)")
            }
            XCTAssertEqual(url, current)
        }
        XCTAssertThrowsError(try LocalVaultConfiguration.open(root: selectedRoot, environment: ["TEXTTEXT_VAULT_CONFIG": current.path])) { error in
            guard case LocalVaultConfigurationError.recoveryRequired(let url, _) = error else {
                return XCTFail("Expected explicit recovery confirmation, got \(error)")
            }
            XCTAssertEqual(url, current)
        }
        XCTAssertEqual(try Data(contentsOf: current), corrupt)

        let recovered = try LocalVaultConfiguration.open(
            root: selectedRoot,
            environment: ["TEXTTEXT_VAULT_CONFIG": current.path],
            replacingUnreadableConfiguration: true
        )
        XCTAssertEqual(recovered.root.standardizedFileURL, selectedRoot.standardizedFileURL)
        let backup = try XCTUnwrap(try FileManager.default.contentsOfDirectory(
            at: current.deletingLastPathComponent(), includingPropertiesForKeys: nil
        ).first(where: { $0.lastPathComponent.hasPrefix("vault.json.recovery-") }))
        XCTAssertEqual(try Data(contentsOf: backup), corrupt)
        XCTAssertEqual(try JSONDecoder().decode(LocalVaultConfiguration.self, from: Data(contentsOf: current)), recovered)
    }

    func testStaleBookmarkRefreshIsPersistedToCurrentConfiguration() throws {
        let fixture = try Fixture()
        let support = fixture.root.appendingPathComponent("container/Data/Library/Application Support")
        let current = LocalVaultConfiguration.configurationURL(environment: [:], applicationSupportDirectory: support)
        let selectedRoot = try fixture.directory("bookmarked-folder")
        try write(LocalVaultConfiguration(rootPath: selectedRoot.path, bookmarkData: Data("stale".utf8)), to: current)
        let refreshedBookmark = Data("refreshed-bookmark".utf8)

        let loaded = try XCTUnwrap(LocalVaultConfiguration.load(
            environment: [:], applicationSupportDirectory: support,
            legacyConfigurationURL: fixture.root.appendingPathComponent("no-legacy.json"),
            resolveBookmark: { _, isStale in isStale = true; return selectedRoot },
            makeBookmark: { _ in refreshedBookmark }
        ))

        XCTAssertEqual(loaded.bookmarkData, refreshedBookmark)
        let saved = try JSONDecoder().decode(LocalVaultConfiguration.self, from: Data(contentsOf: current))
        XCTAssertEqual(saved, loaded)
    }

    func testUnentitledCLIFallsBackToReadableRootWithoutChangingAppBookmark() throws {
        let fixture = try Fixture()
        let current = fixture.root.appendingPathComponent("settings/vault.json")
        let selectedRoot = try fixture.directory("icloud-selected-folder")
        let saved = LocalVaultConfiguration(rootPath: selectedRoot.path, bookmarkData: Data("app-bookmark".utf8))
        try write(saved, to: current)
        let originalBytes = try Data(contentsOf: current)
        let environment = ["TEXTTEXT_VAULT_CONFIG": current.path]
        let failedBookmark: LocalVaultConfiguration.BookmarkResolver = { _, _ in
            throw CocoaError(.fileReadCorruptFile)
        }

        XCTAssertThrowsError(try LocalVaultConfiguration.load(
            environment: environment, resolveBookmark: failedBookmark
        ))
        let cli = try XCTUnwrap(LocalVaultConfiguration.load(
            environment: environment,
            allowUnscopedRootFallback: true,
            resolveBookmark: failedBookmark
        ))
        XCTAssertEqual(try cli.resolvingRoot().standardizedFileURL, selectedRoot.standardizedFileURL)
        XCTAssertNil(cli.bookmarkData)
        XCTAssertEqual(try Data(contentsOf: current), originalBytes)
    }

    func testCancelledFolderSelectionPreservesPriorConfigurationBytes() throws {
        let fixture = try Fixture()
        let current = fixture.root.appendingPathComponent("settings/vault.json")
        let previousRoot = try fixture.directory("previous-folder")
        let selectedRoot = fixture.root.appendingPathComponent("must-not-be-created")
        try write(LocalVaultConfiguration(rootPath: previousRoot.path, bookmarkData: Data("previous".utf8)), to: current)
        let original = try Data(contentsOf: current)

        XCTAssertNil(try LocalVaultConfiguration.openSelection(
            root: nil,
            environment: ["TEXTTEXT_VAULT_CONFIG": current.path]
        ))

        XCTAssertEqual(try Data(contentsOf: current), original)
        XCTAssertFalse(FileManager.default.fileExists(atPath: selectedRoot.path))
    }

    private func write(_ configuration: LocalVaultConfiguration, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(configuration).write(to: url)
    }

    private struct Fixture {
        let root: URL

        init() throws {
            root = FileManager.default.temporaryDirectory
                .appendingPathComponent("LocalVaultConfigurationTests-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        }

        func directory(_ name: String) throws -> URL {
            let directory = root.appendingPathComponent(name, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory
        }
    }
}
