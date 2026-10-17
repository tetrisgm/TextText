import XCTest
@testable import TextTextApp
import TextTextFileProviderKit

final class LocalVaultConnectionControllerTests: XCTestCase {
    func testAccountReviewRequiresFreshMatchingProfileAndWorkspacePermission() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AdoptionReviewProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let account = LocalVaultAccountCredential(origin: URL(string: "https://review.test")!, token: "fixture", accountId: "account-a")
        let accepted = try await LocalVaultAccountReview.load(account: account, binding: LocalVaultSyncBinding(origin: account.origin, workspaceId: "accepted"), session: session)
        XCTAssertEqual(accepted.email, "fixture@example.test")
        for workspace in ["foreign", "denied", "bademail", "malformed"] {
            do {
                _ = try await LocalVaultAccountReview.load(account: account, binding: LocalVaultSyncBinding(origin: account.origin, workspaceId: workspace), session: session)
                XCTFail("Review should refuse \(workspace)")
            } catch { }
        }
    }
    @MainActor
    func testRetirementReleasesTheCachedNativeWriter() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        CredentialRefreshProtocol.setExpectedToken("Bearer fixture-before")
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CredentialRefreshProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
        let connection = LocalVaultConnectionController(root: root, session: session, credentials: { (URL(string: "https://texttext.test")!, "fixture-before") })
        _ = try await connection.connect(startSync: false)
        weak var engine = connection.collaborationEngine
        XCTAssertNotNil(engine)
        await connection.stopAndWait()
        XCTAssertNil(connection.collaborationEngine); XCTAssertNil(engine)
        let binding = try XCTUnwrap(LocalVaultSync.binding(root: root))
        XCTAssertFalse(try LocalVaultAccountStateAdoption.adoptAfterExplicitReview(root: root, binding: binding, accountId: "account-a").alreadyBound)
        await connection.stopAndWait()
    }
    func testWorkspacePreparationRejectsForeignAndUnboundContent() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace-one")
        let selected = root.appendingPathComponent("workspace-one")
        try LocalVaultWorkspaceSelection.prepareFolder(selected, binding: binding)
        let note = selected.appendingPathComponent("keep.txt")
        try Data("preserve".utf8).write(to: note)
        XCTAssertThrowsError(try LocalVaultWorkspaceSelection.prepareFolder(selected, binding: binding))
        XCTAssertEqual(try String(contentsOf: note, encoding: .utf8), "preserve")
        try PortableWorkspaceBinding.bindVerified(root: selected, binding: binding)
        try LocalVaultWorkspaceSelection.prepareFolder(selected, binding: binding)
        let other = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "other")
        XCTAssertThrowsError(try LocalVaultWorkspaceSelection.prepareFolder(selected, binding: other))
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: selected)
        XCTAssertThrowsError(try LocalVaultWorkspaceSelection.prepareFolder(link, binding: binding))

    }

    @MainActor
    func testCapabilityOnlyCompletionRefreshesListingWithoutDownloads() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [NotificationProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let connection = LocalVaultConnectionController(root: root, workspaceId: "shared", session: session,
            credentials: { (URL(string: "https://notification.test")!, "fixture") })
        defer { connection.stop() }
        _ = try await connection.connect(startSync: false)
        XCTAssertFalse(try XCTUnwrap(connection.capabilities).canCreateContent)
        let changed = expectation(description: "permission-only listing refresh")
        connection.onChange = { _, filesChanged in if filesChanged { changed.fulfill() } }
        connection.schedule()
        await fulfillment(of: [changed], timeout: 3)
        connection.onChange = nil
        XCTAssertTrue(try XCTUnwrap(connection.capabilities).canCreateContent)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).list(), [])
    }

    @MainActor
    func testSharedWorkspacePreparationUsesSelectedIdentityAndCanRemainDormant() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CapabilityProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let connection = LocalVaultConnectionController(root: root, workspaceId: "shared", session: session,
            credentials: { (URL(string: "https://capability.test")!, "fixture") })
        defer { connection.stop() }
        _ = try await connection.connect(startSync: false)
        XCTAssertEqual(connection.status["workspaceId"] as? String, "shared")
        XCTAssertNotNil(connection.collaborationEngine)
        XCTAssertEqual(try LocalVaultSync.binding(root: root)?.workspaceId, "shared")
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).list(), [])
    }

    @MainActor
    func testVerifiedFolderRestoresLocalEngineBeforeFailedDiscovery() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let onlineConfig = URLSessionConfiguration.ephemeral
        onlineConfig.protocolClasses = [CapabilityProtocol.self]
        let onlineSession = URLSession(configuration: onlineConfig)
        defer { onlineSession.invalidateAndCancel() }
        let online = LocalVaultConnectionController(root: root, workspaceId: "shared", session: onlineSession,
            credentials: { (URL(string: "https://capability.test")!, "fixture") })
        _ = try await online.connect(startSync: false)
        online.stop()

        let offlineConfig = URLSessionConfiguration.ephemeral
        offlineConfig.protocolClasses = [OfflineDiscoveryProtocol.self]
        let offlineSession = URLSession(configuration: offlineConfig)
        defer { offlineSession.invalidateAndCancel() }
        let reopened = LocalVaultConnectionController(root: root, workspaceId: "shared", session: offlineSession,
            credentials: { (URL(string: "https://capability.test")!, "fixture") })
        defer { reopened.stop() }
        XCTAssertNotNil(reopened.collaborationEngine, "The verified local journal must be ready before any network request")
        let anotherWorkspace = LocalVaultConnectionController(root: root, workspaceId: "another", session: offlineSession,
            credentials: { (URL(string: "https://capability.test")!, "fixture") })
        defer { anotherWorkspace.stop() }
        XCTAssertNil(anotherWorkspace.collaborationEngine, "A different requested workspace must not inherit this journal")
        do {
            _ = try await reopened.connect(startSync: false)
            XCTFail("Discovery should fail in this fixture")
        } catch {
            XCTAssertNotNil(reopened.collaborationEngine, "The verified local journal must be available before discovery")
        }
    }

    func testTransportCapabilityOnlyChangeAndExistingItemAbsence() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CapabilityProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let transport = try HTTPLocalVaultSyncTransport(origin: URL(string: "https://capability.test")!, workspaceId: "workspace", token: "fixture", session: session)
        _ = try await transport.manifest()
        let initial = await transport.canWrite(itemId: "new", path: "Notes/New.textpack", existing: false)
        XCTAssertFalse(initial)
        let changed = try await transport.waitForChange()
        XCTAssertTrue(changed, "An empty workspace permission change must invalidate the listing")
        let newAllowed = await transport.canWrite(itemId: "new", path: "Notes/New.textpack", existing: false)
        let knownDenied = await transport.canWrite(itemId: "known", path: "Notes/Old.textpack", existing: true)
        XCTAssertTrue(newAllowed)
        XCTAssertFalse(knownDenied, "A hidden known file is not a new upload")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://capability.test")!, workspaceId: "workspace")
        var capability = await transport.capabilities()
        capability.knownPaths.insert("Notes/Hidden.textpack")
        try LocalVaultCapabilityCache.write(capability, root: root, binding: binding)
        let restored = try XCTUnwrap(LocalVaultCapabilityCache.read(root: root, binding: binding))
        XCTAssertTrue(restored.canEdit(path: "Notes/Offline new.textpack"))
        XCTAssertFalse(restored.canEdit(path: "Notes/Hidden.textpack"))
        let foreign = try LocalVaultSyncBinding(origin: URL(string: "https://capability.test")!, workspaceId: "other")
        XCTAssertNil(try LocalVaultCapabilityCache.read(root: root, binding: foreign))
        _ = try await transport.manifest() // Revocation replaces last-known permissions.
        try LocalVaultCapabilityCache.write(await transport.capabilities(), root: root, binding: binding)
        XCTAssertFalse(try XCTUnwrap(LocalVaultCapabilityCache.read(root: root, binding: binding)).canEdit(path: "Notes/Offline new.textpack"))

    }

    func testCapabilityCacheCannotPassWritePermissionsToAnotherAccount() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
        let permissions = try JSONDecoder().decode(LocalVaultSyncCapabilities.self, from: Data(#"{"fullAccess":true,"canCreateContent":true,"writableFolders":[],"writableItems":[],"knownPaths":[],"writablePaths":[]}"#.utf8))
        try LocalVaultCapabilityCache.write(permissions, root: root, binding: binding, accountId: "account-a")
        XCTAssertEqual(try LocalVaultCapabilityCache.read(root: root, binding: binding, accountId: "account-a"), permissions)
        XCTAssertNil(try LocalVaultCapabilityCache.read(root: root, binding: binding, accountId: "account-b"))
        XCTAssertNil(try LocalVaultCapabilityCache.read(root: root, binding: binding))
        try LocalVaultCapabilityCache.write(permissions, root: root, binding: binding)
        XCTAssertNil(try LocalVaultCapabilityCache.read(root: root, binding: binding, accountId: "account-a"))
        let target = LocalVaultDeviceState.directory(root: root).appendingPathComponent("workspace-capabilities.json")
        var future = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: target)) as? [String: Any]); future["version"] = 999
        let retained = try JSONSerialization.data(withJSONObject: future); try retained.write(to: target, options: .atomic)
        XCTAssertThrowsError(try LocalVaultCapabilityCache.read(root: root, binding: binding))
        XCTAssertEqual(try Data(contentsOf: target), retained)
    }

    @MainActor
    func testCredentialRefreshKeepsSyncActorAndUsesNewToken() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CredentialRefreshProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        var token = "fixture-before"
        CredentialRefreshProtocol.setExpectedToken("Bearer fixture-before")
        let connection = LocalVaultConnectionController(root: root, session: session,
            verifiedCredentials: { LocalVaultAccountCredential(origin: URL(string: "https://texttext.test")!, token: token, accountId: "account-a") })
        defer { connection.stop() }
        _ = try await connection.connect()
        let engine = try XCTUnwrap(connection.collaborationEngine)
        token = "fixture-after"
        CredentialRefreshProtocol.setExpectedToken("Bearer fixture-after")
        let refreshed = expectation(description: "credentials refreshed")
        connection.onChange = { status, _ in
            if status["connecting"] as? Bool == false { refreshed.fulfill() }
        }
        connection.credentialsChanged()
        await fulfillment(of: [refreshed], timeout: 3)
        connection.onChange = nil
        XCTAssertTrue(connection.collaborationEngine === engine, "Credential renewal must preserve active shared editing sessions")
        // The real transport rejects the old token after discovery of the new
        // token. A successful manifest proves the existing actor was updated.
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, report.errors.joined(separator: ", "))
    }

    @MainActor
    func testReplacementAccountCannotRetokenExistingSyncActor() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CredentialRefreshProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        CredentialRefreshProtocol.setExpectedToken("Bearer fixture-before")
        var credential = LocalVaultAccountCredential(origin: URL(string: "https://texttext.test")!, token: "fixture-before", accountId: "account-a")
        let connection = LocalVaultConnectionController(root: root, session: session, verifiedCredentials: { credential })
        defer { connection.stop() }
        _ = try await connection.connect(startSync: false)
        let engine = try XCTUnwrap(connection.collaborationEngine)
        let stateURL = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        let saved = try Data(contentsOf: stateURL)
        credential = LocalVaultAccountCredential(origin: credential.origin, token: "fixture-other", accountId: "account-b")
        connection.credentialsChanged()
        XCTAssertNil(connection.collaborationEngine)
        XCTAssertNil(connection.capabilities, "Another account cannot inherit cached write permissions")
        XCTAssertFalse(connection.status["onlineReady"] as? Bool ?? true)
        do { _ = try await connection.connect(startSync: false); XCTFail("Replacement acquired the retained actor") }
        catch { XCTAssertTrue(error.localizedDescription.contains("original account")) }
        XCTAssertEqual(try Data(contentsOf: stateURL), saved)
        credential = LocalVaultAccountCredential(origin: credential.origin, token: "fixture-before", accountId: "account-a")
        _ = try await connection.connect(startSync: false)
        XCTAssertNotNil(connection.collaborationEngine)
        XCTAssertEqual(connection.collaborationEngine?.accountId, engine.accountId)
    }

    @MainActor
    func testSuccessfulIdleWatchClearsOnlyWatchFailureOnce() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let connection = LocalVaultConnectionController(root: root, credentials: { nil })
        let retry = "Changes are saved on this Mac. The web connection will retry."
        var notices: [String?] = []
        connection.onChange = { status, changed in
            XCTAssertFalse(changed)
            notices.append(status["message"] as? String)
        }

        connection.watchDidFail()
        connection.watchDidFail()
        XCTAssertEqual(connection.message, retry)
        XCTAssertEqual(notices, [retry])
        connection.watchDidSucceed() // A 304 unchanged wait is still a successful connection.
        connection.watchDidSucceed()
        XCTAssertNil(connection.message)
        XCTAssertEqual(notices, [retry, nil])

        connection.recordSyncMessage("A sync error")
        connection.watchDidFail()
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, "A sync error")
        XCTAssertEqual(notices.count, 2)
        connection.recordSyncMessage("Conflicting edits were kept in recovery copies.")
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, "Conflicting edits were kept in recovery copies.")
        connection.recordSyncMessage(retry) // The sync failure can use the same copy.
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, retry)
        XCTAssertEqual(notices.count, 2)

        connection.recordSyncMessage(nil)
        connection.watchDidFail()
        connection.watchDidSucceed()
        XCTAssertEqual(notices, [retry, nil, retry, nil])
    }
}

private final class CredentialRefreshProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var expectedToken = "Bearer fixture-before"
    static func setExpectedToken(_ value: String) {
        lock.lock(); expectedToken = value; lock.unlock()
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "texttext.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let token = request.value(forHTTPHeaderField: "Authorization")
        let discovery = request.url?.path == "/api/vault"
        Self.lock.lock()
        let authorized = token == Self.expectedToken
        Self.lock.unlock()
        if request.url?.query?.contains("wait=") == true {
            client?.urlProtocol(self, didFailWithError: URLError(.timedOut))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: authorized ? 200 : 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((discovery ? "{\"workspaceId\":\"workspace\"}" : "{\"items\":[]}").utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class CapabilityProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "capability.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let writable = request.url?.query?.contains("wait=") == true
        let body = "{\"items\":[],\"fullAccess\":true,\"canCreateContent\":\(writable ? "true" : "false"),\"writableFolders\":[]}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class OfflineDiscoveryProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "capability.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}

private final class NotificationProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var requests = 0
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "notification.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests += 1; let writable = Self.requests > 2; Self.lock.unlock()
        let body = "{\"items\":[],\"fullAccess\":true,\"canCreateContent\":\(writable ? "true" : "false"),\"writableFolders\":[]}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class AdoptionReviewProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "review.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        let authorized = request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture" && request.value(forHTTPHeaderField: "X-TextText-Account") == "account-a"
        let status = !authorized || (path.contains("/denied/") && path.hasSuffix("/items")) ? 403 : 200
        let body: [String: Any]
        if path.hasSuffix("/account") { body = ["accountId": path.contains("/foreign/") ? "account-b" : "account-a", "email": path.contains("/bademail/") ? "bad\nemail" : "fixture@example.test"] }
        else { body = path.contains("/malformed/") ? ["unexpected": []] : ["items": []] }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
