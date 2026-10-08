import Foundation
import XCTest
import TextTextFileProviderKit
import TextTextWorkspaceCore
@testable import TextTextCLICore

private final class LocalCommandProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class LocalWorkspaceCommandsTests: XCTestCase {
    var root: URL!
    var credential: URL!
    var session: URLSession!
    var environment: [String: String]!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        credential = root.appendingPathComponent("credential.json")
        try Data(#"{"token":"wsk_test","serverOrigin":"https://texttext.app"}"#.utf8).write(to: credential)
        try PortableWorkspaceBinding.bindVerified(root: root, binding: LocalVaultSyncBinding(origin: URL(string: "https://texttext.app")!, workspaceId: "workspace-a"))
        environment = ["TEXTTEXT_WORKSPACE_ROOT": root.path, "TEXTTEXT_CREDENTIALS_PATH": credential.path]
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [LocalCommandProtocol.self]
        session = URLSession(configuration: config)
    }
    override func tearDownWithError() throws {
        session.invalidateAndCancel()
        LocalCommandProtocol.handler = nil
        try FileManager.default.removeItem(at: root)
    }
    func testLocalFilesStayOfflineAndAccountCommandsUseMatchedAuthority() async throws {
        try Data("# Local\nStill on disk".utf8).write(to: root.appendingPathComponent("local.md"))
        var paths: [String] = []
        LocalCommandProtocol.handler = { request in
            paths.append(request.url!.path)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer wsk_test")
            if request.url!.path == "/api/vault" { return (200, #"{"workspaceId":"workspace-a"}"#) }
            if request.httpMethod == "GET" { return (200, #"{"commands":[{"name":"get_workspace"}]}"#) }
            return (200, #"{"content":[{"type":"text","text":"command worked"}]}"#)
        }
        environment.removeValue(forKey: "TEXTTEXT_WORKSPACE_ROOT")
        environment["TEXTTEXT_VAULT_CONFIG"] = root.appendingPathComponent("selection.json").path
        _ = try LocalVaultConfiguration.open(root: root, environment: environment)
        let workspace = try CLIWorkspace.locate(environment: environment, commandSession: session)
        XCTAssertFalse(workspace.usesRemoteSync)
        let reference = try await workspace.resolve("local.md")
        let text = try await workspace.readMarkdown(at: reference)
        XCTAssertTrue(text.contains("Still on disk"))
        XCTAssertEqual(paths, [])
        let catalog = try await workspace.availableCommands()
        XCTAssertTrue(catalog.contains("get_workspace"))
        let reply = try await workspace.runCommand("get_workspace", argumentsJSON: "{}")
        XCTAssertEqual(reply, "command worked")
        XCTAssertEqual(paths, ["/api/vault", "/api/agent/commands", "/api/vault", "/api/agent/commands"])
    }
    func testWrongOriginFailsBeforeSendingToken() async throws {
        try Data(#"{"token":"wsk_test","serverOrigin":"https://other.example"}"#.utf8).write(to: credential)
        LocalCommandProtocol.handler = { _ in XCTFail("must not contact another origin"); return (500, "") }
        await assertCommandRejected()
    }
    func testWrongWorkspaceDoesNotDispatchCommand() async throws {
        LocalCommandProtocol.handler = { request in
            XCTAssertEqual(request.url!.path, "/api/vault")
            return (200, #"{"workspaceId":"workspace-b"}"#)
        }
        await assertCommandRejected()
    }
    func testRevokedOrRotatedCredentialDoesNotDispatchCommand() async throws {
        let credential = self.credential!
        LocalCommandProtocol.handler = { request in
            XCTAssertEqual(request.url!.path, "/api/vault")
            try Data(#"{"token":"wsk_rotated","serverOrigin":"https://texttext.app"}"#.utf8).write(to: credential)
            return (200, #"{"workspaceId":"workspace-a"}"#)
        }
        await assertCommandRejected()
        LocalCommandProtocol.handler = { request in
            XCTAssertEqual(request.url!.path, "/api/vault")
            return (401, "private server diagnostic")
        }
        await assertCommandRejected()
    }
    func testUnboundLocalFolderCannotRunAccountCommands() async throws {
        try FileManager.default.removeItem(at: root.appendingPathComponent(".texttext/workspace-binding.json"))
        LocalCommandProtocol.handler = { _ in XCTFail("unbound folder must remain local"); return (500, "") }
        await assertCommandRejected()
    }
    private func assertCommandRejected() async {
        do {
            let workspace = try CLIWorkspace.locate(environment: environment, commandSession: session)
            _ = try await workspace.availableCommands()
            XCTFail("Expected rejection")
        } catch {
            XCTAssertFalse(String(describing: error).contains("wsk_"))
            XCTAssertFalse(String(describing: error).contains("private server diagnostic"))
        }
    }
}
