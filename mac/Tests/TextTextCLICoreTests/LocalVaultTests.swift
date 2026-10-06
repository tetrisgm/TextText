import TextTextWorkspaceCore
import XCTest
@testable import TextTextCLICore

final class LocalVaultTests: XCTestCase {
    func testSelectedVaultPersistsAndWorksWithoutCredentials() async throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let environment = [
            "TEXTTEXT_VAULT_CONFIG": temporary.appendingPathComponent("settings/vault.json").path,
            "TEXTTEXT_CREDENTIALS_PATH": temporary.appendingPathComponent("missing.json").path,
        ]
        let vault = temporary.appendingPathComponent("My Notes")
        try LocalVaultConfiguration.open(root: vault, environment: environment)
        let workspace = try CLIWorkspace.locate(environment: environment)
        XCTAssertFalse(workspace.usesRemoteSync)
        let document = try await workspace.create(title: "Offline", body: "Original.")
        try await workspace.appendMarkdown("Second paragraph.", to: document)
        let reopened = try CLIWorkspace.locate(environment: environment)
        let reference = try await reopened.resolve("Offline")
        let markdown = try await reopened.readMarkdown(at: reference)
        XCTAssertTrue(markdown.contains("Original."))
        XCTAssertTrue(markdown.contains("Second paragraph."))
        XCTAssertTrue(FileManager.default.fileExists(atPath: vault.appendingPathComponent("Offline.textpack").path))
    }

    func testCLIUsesReadableSelectedFolderWhenAppBookmarkCannotResolve() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let vault = temporary.appendingPathComponent("iCloud workspace")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let configurationURL = temporary.appendingPathComponent("vault.json")
        let savedBytes = try JSONSerialization.data(withJSONObject: [
            "rootPath": vault.path,
            "bookmarkData": Data("unreadable-app-bookmark".utf8).base64EncodedString(),
        ])
        try savedBytes.write(to: configurationURL)
        let environment = ["TEXTTEXT_VAULT_CONFIG": configurationURL.path]

        guard case .local(let workspace) = try CLIWorkspace.locate(environment: environment) else {
            return XCTFail("a readable selected folder must remain local")
        }
        XCTAssertEqual(workspace.root.standardizedFileURL, vault.standardizedFileURL)
        XCTAssertEqual(try DocumentStore.locate(environment: environment).root.standardizedFileURL,
                       vault.standardizedFileURL)
        XCTAssertEqual(try Data(contentsOf: configurationURL), savedBytes)
    }

    func testSearchFindsOfflineContentAndReturnsReadablePaths() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = CLIWorkspace.local(DocumentStore(root: root))
        _ = try await workspace.create(title: "Research", body: "Orchids thrive here.")
        _ = try await workspace.create(title: "Other", body: "Unrelated text.")
        let matches = try await workspace.search("ORCHIDS research")
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.title, "Research")
        XCTAssertEqual(matches.first?.snippet, "Orchids thrive here.")
        let reference = try await workspace.resolve(XCTUnwrap(matches.first).id)
        let content = try await workspace.readContent(at: reference)
        XCTAssertEqual(content.hash, matches.first?.hash)
    }

    func testStaleWriteCannotOverwriteAnExternalEdit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = CLIWorkspace.local(DocumentStore(root: root))
        let reference = try await workspace.create(title: "Shared", body: "First.")
        let itemLink = await workspace.itemLink(for: reference)
        let link = try XCTUnwrap(itemLink)
        XCTAssertTrue(link.isFileURL)
        XCTAssertEqual(link.lastPathComponent, "Shared.textpack")
        let initial = try await workspace.readContent(at: reference)
        let hash = try XCTUnwrap(initial.hash)
        try await workspace.writeMarkdown("External edit.", to: reference, ifMatchHash: hash)
        do {
            try await workspace.writeMarkdown("Stale edit.", to: reference, ifMatchHash: hash)
            XCTFail("expected a rejected stale save")
        } catch TextTextCLIError.documentChanged { }
        let latest = try await workspace.readContent(at: reference)
        XCTAssertTrue(latest.markdown.contains("External edit."))
        XCTAssertFalse(latest.markdown.contains("Stale edit."))
    }

    func testVaultTakesPrecedenceOverCredentialsAndExplicitRootTakesPrecedenceOverVault() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        var environment = [
            "TEXTTEXT_VAULT_CONFIG": temporary.appendingPathComponent("vault.json").path,
            "TEXTTEXT_CREDENTIALS_PATH": temporary.appendingPathComponent("credentials.json").path,
        ]
        let vault = temporary.appendingPathComponent("Vault")
        try LocalVaultConfiguration.open(root: vault, environment: environment)
        try Data(#"{"token":"wsk_device","serverOrigin":"https://texttext.app"}"#.utf8)
            .write(to: temporary.appendingPathComponent("credentials.json"))
        guard case .local(let selected) = try CLIWorkspace.locate(environment: environment) else {
            return XCTFail("selected vault must win over credentials")
        }
        XCTAssertEqual(selected.root.path, vault.path)
        environment["TEXTTEXT_WORKSPACE_ROOT"] = temporary.path
        guard case .local(let overridden) = try CLIWorkspace.locate(environment: environment) else {
            return XCTFail("explicit root must be local")
        }
        XCTAssertEqual(overridden.root.path, temporary.path)
    }

    func testMissingSelectedVaultDoesNotFallBackToRemote() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let environment = ["TEXTTEXT_VAULT_CONFIG": temporary.appendingPathComponent("vault.json").path]
        let vault = temporary.appendingPathComponent("Vault")
        try LocalVaultConfiguration.open(root: vault, environment: environment)
        try FileManager.default.removeItem(at: vault)
        XCTAssertThrowsError(try CLIWorkspace.locate(environment: environment))
    }
}
