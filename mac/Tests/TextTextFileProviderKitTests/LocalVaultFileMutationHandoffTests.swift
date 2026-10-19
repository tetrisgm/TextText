import Darwin
import TextTextSyncTestSupport
import TextTextWorkspaceCore
import XCTest
import ZIPFoundation
@testable import TextTextFileProviderKit

/// Actual native engine and HTTP directory store; every root and identity is owned.
final class LocalVaultFileMutationHandoffTests: XCTestCase {
    func testImageCASReopenBeforeMirrorACKRetainsBytesAndOneMirrorPassResolves() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_VAULT_HTTP_TEST"] == "1" else { throw XCTSkip("Explicit loopback fixture required") }
        var repository = URL(fileURLWithPath: #filePath); for _ in 0..<4 { repository.deleteLastPathComponent() }
        let fm = FileManager.default
        let temporary = fm.temporaryDirectory.appendingPathComponent("image-handoff-" + UUID().uuidString).resolvingSymlinksInPath()
        let root = temporary.appendingPathComponent("Workspace"), ready = temporary.appendingPathComponent("ready.json")
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let previous = LocalVaultDeviceState.exchangeConfiguredBase(temporary.appendingPathComponent("private-state"))
        let server = Process(); server.executableURL = URL(fileURLWithPath: "/usr/bin/env"); server.currentDirectoryURL = repository
        server.arguments = ["node", "--import", "tsx", "scripts/vault-http-test-server.ts", temporary.appendingPathComponent("server").path, ready.path]
        server.standardOutput = FileHandle.nullDevice; server.standardError = FileHandle.nullDevice
        try server.run()
        defer {
            if server.isRunning { server.terminate(); server.waitUntilExit() }
            _ = LocalVaultDeviceState.exchangeConfiguredBase(previous)
            try? fm.removeItem(at: temporary)
        }
        for _ in 0..<500 { if fm.fileExists(atPath: ready.path) || !server.isRunning { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        struct Ready: Decodable { let origin: URL }
        let origin = try JSONDecoder().decode(Ready.self, from: Data(contentsOf: ready)).origin
        let binding = try LocalVaultSyncBinding(origin: origin, workspaceId: "contract-workspace")
        let account = "image-owner", item = "91111111-1111-4111-8111-111111111111", path = "Notes/Image handoff.textpack"
        try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: account)
        let transport = try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: binding.workspaceId, token: "vault-http-fixture", accountId: account)
        let builder = temporary.appendingPathComponent("builder"); try fm.createDirectory(at: builder, withIntermediateDirectories: true)
        let initial = try BuiltinTextPackDocument.create(title: "Image handoff", body: "Existing fixture text.")
        let markdown = "---\ntextTextId: \"\(item)\"\ntitle: \"Image handoff\"\n---\n\nExisting fixture text."
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown, documentJSON: initial.documentJSON,
            templateJSON: initial.templateJSON, assets: [], sourceURL: nil, in: builder)
        let seed = try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: builder))
        _ = try await transport.upload(itemId: item, path: path, data: seed, baseRevision: nil, operationId: UUID().uuidString, nativeEditor: false)
        let engine = try makeTestSync(root: root, binding: binding, transport: transport, accountId: account)
        let first = try await engine.sync(); XCTAssertTrue(first.errors.isEmpty, first.errors.joined(separator: ","))
        let store = LocalVaultDocumentStore(root: root), original = try store.read(path: path)
        let opened = try await engine.beginSharedEditing(itemId: item, path: path, expectedHash: original.hash)
        let journal: [String: Any] = ["version": 1, "accountId": account, "journalGeneration": 1, "epoch": 1, "seq": 0,
            "revision": original.hash, "relativePath": path, "update": "AQ==", "pending": [], "batch": NSNull()]
        let clean = try await engine.materializeSharedEditing(sessionToken: opened.sessionToken, itemId: item, expectedHash: original.hash,
            epoch: 1, seq: 0, acknowledgedRevision: original.hash, journalGeneration: 1,
            journal: String(decoding: JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: false,
            markdown: original.contents.markdown, documentJSON: try XCTUnwrap(original.contents.documentJSON))
        try await engine.endSharedEditing(sessionToken: opened.sessionToken, itemId: item)
        let before = try store.read(path: path)
        XCTAssertEqual(before.hash, clean.document.hash)
        var document = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(before.contents.documentJSON).utf8)) as? [String: Any])
        var content = try XCTUnwrap(document["content"] as? [String: Any])
        let body = "Existing fixture text.\n\n![square](assets/square.jpg)\n\n"
        content["body"] = body; content["assets"] = [["id": UUID().uuidString, "kind": "image", "src": "assets/square.jpg", "alt": "square", "contentType": "image/jpeg"]]
        document["content"] = content
        let jpeg = try Data(contentsOf: repository.appendingPathComponent("public/fixtures/content-first/square.jpg"))
        let written = try LocalVaultEditOriginJournal(root: root).recordingNativeSave {
            try store.write(path: path, expectedHash: before.hash,
                markdown: "---\ntextTextId: \"\(item)\"\ntitle: \"Image handoff\"\n---\n\n" + body,
                documentJSON: String(decoding: JSONSerialization.data(withJSONObject: document), as: UTF8.self),
                templateJSON: before.contents.templateJSON, templateAuthoringSourceJSON: before.contents.templateAuthoringSourceJSON,
                addedAssets: [.init(filename: "square.jpg", data: jpeg, contentType: "image/jpeg", remoteURL: "assets/square.jpg")])
        }
        let retained = try Data(contentsOf: root.appendingPathComponent(path))
        do {
            _ = try await engine.beginSharedEditing(itemId: item, path: path, expectedHash: written.hash)
            XCTFail("Pre-ACK open unexpectedly bypassed native baseline guard")
        } catch LocalVaultSyncFailure.changed { }
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(path)), retained)
        let report = try await engine.sync()
        XCTAssertTrue(report.errors.isEmpty, report.errors.joined(separator: ","))
        XCTAssertEqual(report.uploaded, 1, "An actual mirror pass must settle this valid native-origin CAS")
        let remote = try await transport.download(itemId: item)
        let archive = try Archive(data: remote.data, accessMode: .read)
        let image = try XCTUnwrap(archive.first { $0.path.hasSuffix("/assets/square.jpg") })
        var actual = Data(); _ = try archive.extract(image) { actual.append($0) }; XCTAssertEqual(actual, jpeg)
        let current = try store.read(path: path)
        let reopened = try await engine.beginSharedEditing(itemId: item, path: path, expectedHash: current.hash)
        XCTAssertEqual(reopened.document.hash, current.hash)
        try await engine.endSharedEditing(sessionToken: reopened.sessionToken, itemId: item)
    }
}
