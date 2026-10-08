import TextTextWorkspaceCore
import XCTest
@testable import TextTextCLICore

final class LocalVaultTests: XCTestCase {
    func testLocalCreationRetrySurvivesRenameAndEditAndRejectsDeletion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let workspace = CLIWorkspace.local(store)
        _ = try await workspace.create(title: "Retry", body: "Original", idempotencyKey: "key")
        let original = root.appendingPathComponent("Retry.textpack")
        let moved = root.appendingPathComponent("Moved.textpack")
        try FileManager.default.moveItem(at: original, to: moved)
        try store.writeMarkdown(try store.readMarkdown(at: moved) + "\nLater edit.\n", to: moved)
        _ = try await workspace.create(title: "Retry", body: "Original", idempotencyKey: "key")
        XCTAssertTrue(try store.readMarkdown(at: moved).contains("Later edit."))
        XCTAssertEqual(try store.list(), ["Moved.textpack"])
        do {
            _ = try await workspace.create(title: "Retry", body: "Changed", idempotencyKey: "key")
            XCTFail("different payload must reject")
        } catch { XCTAssertTrue(String(describing: error).contains("different request")) }
        try FileManager.default.removeItem(at: moved)
        do {
            _ = try await workspace.create(title: "Retry", body: "Original", idempotencyKey: "key")
            XCTFail("deleted file must never be recreated")
        } catch { XCTAssertTrue(String(describing: error).contains("no replacement")) }
        XCTAssertTrue(try store.list().isEmpty)
    }

    func testLocalCaptureRetryAndDuplicateIdentityFence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let workspace = CLIWorkspace.local(store)
        let input = try XCTUnwrap(AgentCaptureInput(value: "Capture this note"))
        let first = try await workspace.capture(input, rawValue: "Capture this note", folder: "", idempotencyKey: "capture")
        let second = try await workspace.capture(input, rawValue: "Capture this note", folder: "", idempotencyKey: "capture")
        XCTAssertEqual(first.receipt.itemId, second.receipt.itemId)
        let path = try XCTUnwrap(store.list().first)
        try FileManager.default.copyItem(at: root.appendingPathComponent(path),
                                         to: root.appendingPathComponent("Duplicate.textpack"))
        do {
            _ = try await workspace.capture(input, rawValue: "Capture this note", folder: "", idempotencyKey: "capture")
            XCTFail("duplicate identity must reject")
        } catch { XCTAssertTrue(String(describing: error).contains("multiple files")) }
        XCTAssertEqual(try store.list().count, 2)
    }

    func testCreationResumesPreparedIntentWithoutNewIdentity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let target = try store.createWithRetryKey(title: "Resume", body: "Body", folder: nil, kind: nil, key: "resume")
        let id = try XCTUnwrap(store.itemId(at: target))
        // Reconstruct the durable state immediately before create-only publication.
        let stage = root.appendingPathComponent(".texttext/cli-creations/" + id + ".textpack")
        try FileManager.default.moveItem(at: target, to: stage)
        let resumed = try store.createWithRetryKey(title: "Resume", body: "Body", folder: nil, kind: nil, key: "resume")
        XCTAssertEqual(resumed, target)
        XCTAssertEqual(store.itemId(at: resumed), id)
        XCTAssertFalse(FileManager.default.fileExists(atPath: stage.path))
        XCTAssertEqual(try store.list(), ["Resume.textpack"])
    }

    func testCreationRefusesChangedPreparedBytesAndPreservesThemForRecovery() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let target = try store.createWithRetryKey(title: "Changed stage", body: "Body", folder: nil, kind: nil, key: "changed-stage")
        let id = try XCTUnwrap(store.itemId(at: target))
        let stage = root.appendingPathComponent(".texttext/cli-creations/" + id + ".textpack")
        var changed = try Data(contentsOf: target)
        changed.append(contentsOf: [0, 1, 2, 3])
        try changed.write(to: stage)
        try FileManager.default.removeItem(at: target)
        XCTAssertThrowsError(try store.createWithRetryKey(title: "Changed stage", body: "Body", folder: nil, kind: nil, key: "changed-stage"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(try Data(contentsOf: stage), changed)
        XCTAssertTrue(try store.list().isEmpty)
    }

    func testLegacyCreationReceiptStillFindsPublishedIdentityButCannotResumeUnverifiedStage() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let target = try store.createWithRetryKey(title: "Legacy", body: "Body", folder: nil, kind: nil, key: "legacy")
        let id = try XCTUnwrap(store.itemId(at: target))
        let journal = root.appendingPathComponent(".texttext/cli-creations")
        let receipt = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: journal, includingPropertiesForKeys: nil).first { $0.pathExtension == "json" })
        var record = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: receipt)) as? [String: Any])
        record["version"] = 1; record.removeValue(forKey: "preparedHash")
        try JSONSerialization.data(withJSONObject: record).write(to: receipt)
        XCTAssertEqual(try store.createWithRetryKey(title: "Legacy", body: "Body", folder: nil, kind: nil, key: "legacy"), target)
        let stage = journal.appendingPathComponent(id + ".textpack")
        try FileManager.default.moveItem(at: target, to: stage)
        XCTAssertThrowsError(try store.createWithRetryKey(title: "Legacy", body: "Body", folder: nil, kind: nil, key: "legacy"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: stage.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
    }

    func testPreparedIntentCannotRedirectPublicationToAnotherFolder() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("Other"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let target = try store.createWithRetryKey(title: "Scoped", body: "Body", folder: "Notes", kind: nil, key: "scope")
        let id = try XCTUnwrap(store.itemId(at: target))
        let journal = root.appendingPathComponent(".texttext/cli-creations")
        let stage = journal.appendingPathComponent(id + ".textpack")
        try FileManager.default.moveItem(at: target, to: stage)
        let receipt = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: journal, includingPropertiesForKeys: nil).first { $0.pathExtension == "json" })
        var record = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: receipt)) as? [String: Any])
        record["destination"] = "Other/Scoped.textpack"
        try JSONSerialization.data(withJSONObject: record).write(to: receipt)
        XCTAssertThrowsError(try store.createWithRetryKey(title: "Scoped", body: "Body", folder: "Notes", kind: nil, key: "scope"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: stage.path))
        XCTAssertTrue(try store.list().isEmpty)
    }

    func testConcurrentKeyedCreationPublishesOneIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = DocumentStore(root: root)
        let paths = try await withThrowingTaskGroup(of: URL.self) { group in
            for _ in 0..<4 {
                group.addTask {
                    try store.createWithRetryKey(title: "One", body: "Once", folder: nil, kind: nil, key: "same")
                }
            }
            var results: [URL] = []
            for try await result in group { results.append(result) }
            return results
        }
        XCTAssertEqual(Set(paths).count, 1)
        XCTAssertEqual(try store.list(), ["One.textpack"])
    }

    func testLocalAppendReceiptSurvivesReopenAndLaterEdits() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let workspace = CLIWorkspace.local(DocumentStore(root: root))
        let reference = try await workspace.create(title: "Retry", body: "Original.")
        try await workspace.appendMarkdown("Once.", to: reference, idempotencyKey: "retry-one")
        let first = try await workspace.readContent(at: reference)
        try await workspace.writeMarkdown(first.markdown + "\nLater human edit.\n", to: reference, ifMatchHash: first.hash)
        let reopened = CLIWorkspace.local(DocumentStore(root: root))
        try await reopened.appendMarkdown("Once.", to: reference, idempotencyKey: "retry-one")
        let result = try await reopened.readContent(at: reference)
        XCTAssertEqual(result.markdown.components(separatedBy: "Once.").count, 2)
        XCTAssertTrue(result.markdown.contains("Later human edit."))
        do {
            try await reopened.appendMarkdown("Different.", to: reference, idempotencyKey: "retry-one")
            XCTFail("a key cannot authorize different content")
        } catch { }
        let after = try await reopened.readContent(at: reference)
        XCTAssertEqual(after.hash, result.hash)
    }

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
