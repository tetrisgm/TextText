import AppKit
import WebKit
import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LegacyAccountIdentityRefreshTests: XCTestCase {
    @MainActor
    func testLocalWorkspaceRefreshCachesVerifiedIdentityEvenWhenWorkspaceReadFails() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = StateStore(fileManager: StateStoreTestFileManager(root: root), groupContainer: root, cliCredentialsURL: nil)
        let legacy = Credentials(token: "fixture", serverOrigin: "https://legacy.test", tokenName: "Original", linkedAt: Date(timeIntervalSince1970: 1))
        store.saveCredentials(legacy)
        let entry = root.appendingPathComponent("index.html")
        try "<html>Isolated account refresh</html>".write(to: entry, atomically: true, encoding: .utf8)
        let sentinel = root.appendingPathComponent("pending.json"), bytes = Data("pending original".utf8)
        try bytes.write(to: sentinel)
        let controller = LocalVaultWindowController(entry: entry, root: root, websiteDataStore: .nonPersistent(), verifiedCredentials: {
            store.loadCredentials().map { LocalVaultAccountCredential(origin: URL(string: $0.serverOrigin)!, token: $0.token, accountId: $0.accountId) }
        })
        defer { controller.shutdown(); controller.window?.orderOut(nil) }
        let app = AppDelegate(store: store, localVaultWindow: controller)
        app.refreshLegacyAccountIdentityIfNeeded { _ in ("account-a", nil) }
        let deadline = Date().addingTimeInterval(3)
        while store.loadCredentials()?.accountId == nil && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(store.loadCredentials()?.accountId, "account-a")
        XCTAssertEqual(store.loadCredentials()?.token, legacy.token)
        XCTAssertEqual(try Data(contentsOf: sentinel), bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: LocalVaultDeviceState.directory(root: root).appendingPathComponent("account-owner.json").path))
        XCTAssertNil(LocalVaultAccountCredential.forWindow(initial: .init(origin: URL(string: "https://legacy.test")!, token: "fixture"), current: .init(origin: URL(string: "https://legacy.test")!, token: "fixture", accountId: "account-a"))?.accountId)
    }

    @MainActor
    func testFailedIdentityRefreshPreservesCredentialAndCanRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = StateStore(fileManager: StateStoreTestFileManager(root: root), groupContainer: root, cliCredentialsURL: nil)
        let original = Credentials(token: "fixture", serverOrigin: "https://legacy.test", tokenName: "Original", linkedAt: Date(timeIntervalSince1970: 1))
        store.saveCredentials(original)
        let file = store.baseDir.appendingPathComponent("credentials.json"), before = try Data(contentsOf: file)
        let app = AppDelegate(store: store), fetched = expectation(description: "bounded failed fetch")
        app.refreshLegacyAccountIdentityIfNeeded { _ in fetched.fulfill(); return (nil, nil) }
        await fulfillment(of: [fetched], timeout: 3)
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(try Data(contentsOf: file), before)
        app.refreshLegacyAccountIdentityIfNeeded { _ in ("account-a", nil) }
        let deadline = Date().addingTimeInterval(3)
        while store.loadCredentials()?.accountId == nil && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(store.loadCredentials()?.accountId, "account-a")
        XCTAssertEqual(store.loadCredentials()?.linkedAt, original.linkedAt)
    }

    @MainActor
    func testLateCredentialAndGenerationResultsCannotUpgradeNewerSignIn() async throws {
        for mode in ["token", "origin", "generation"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let store = StateStore(fileManager: StateStoreTestFileManager(root: root), groupContainer: root, cliCredentialsURL: nil)
            let first = Credentials(token: "fixture-a", serverOrigin: "https://legacy.test", tokenName: "Original", linkedAt: Date(timeIntervalSince1970: 1))
            store.saveCredentials(first)
            let app = AppDelegate(store: store), gate = DispatchSemaphore(value: 0)
            app.refreshLegacyAccountIdentityIfNeeded { _ in gate.wait(); return ("old-account", nil) }
            if mode != "generation" { store.saveCredentials(Credentials(token: mode == "token" ? "fixture-b" : "fixture-a", serverOrigin: mode == "origin" ? "https://new.test" : "https://legacy.test", tokenName: "New", linkedAt: Date(timeIntervalSince1970: 2))) }
            app.refreshLegacyAccountIdentityIfNeeded { _ in ("current-account", nil) }
            let deadline = Date().addingTimeInterval(3)
            while store.loadCredentials()?.accountId == nil && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
            XCTAssertEqual(store.loadCredentials()?.accountId, "current-account", mode)
            gate.signal()
            try await Task.sleep(nanoseconds: 100_000_000)
            XCTAssertEqual(store.loadCredentials()?.accountId, "current-account", mode)
        }
    }
}
