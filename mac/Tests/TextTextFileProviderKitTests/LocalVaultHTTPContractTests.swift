import Darwin
import TextTextSyncTestSupport
import XCTest
@testable import TextTextFileProviderKit

/// Exercises the actual Swift HTTP transport against the TypeScript directory
/// store. Opt in with TEXTTEXT_VAULT_HTTP_TEST=1; the fixture listens only on
/// loopback, uses a synthetic token, and is terminated when the test finishes.
final class LocalVaultHTTPContractTests: XCTestCase {
    private let workspaceId = "contract-workspace"
    private let token = "vault-http-fixture"

    private func pack(in root: URL, itemId: String, body: String) throws -> Data {
        let scratch = root.appendingPathComponent(".pack-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Contract note", body: body)
        let package = try TextTextTextBundlePackage.materialize(
            canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: \"Contract note\"\n---\n\n\(body)",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON,
            assets: [.init(filename: "proof.bin", data: Data([0, 255, 17, 4]),
                remoteURL: "https://fixture.invalid/proof.bin", contentType: "application/octet-stream")],
            sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }

    private func write(_ bytes: Data, to root: URL, path: String) throws {
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: url, options: .atomic)
    }

    private func stats(origin: URL) async throws -> [String: Int] {
        var request = URLRequest(url: origin.appendingPathComponent("__test/stats"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (bytes, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode([String: Int].self, from: bytes)
    }

    func testTwoNativeVaultsAgainstRealDirectoryServer() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_VAULT_HTTP_TEST"] == "1" else {
            throw XCTSkip("Set TEXTTEXT_VAULT_HTTP_TEST=1 to run the temporary local HTTP contract fixture")
        }
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { repository.deleteLastPathComponent() }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-http-contract-\(UUID().uuidString)")
        let firstRoot = temporary.appendingPathComponent("first")
        let secondRoot = temporary.appendingPathComponent("second")
        let ready = temporary.appendingPathComponent("ready.json")
        try FileManager.default.createDirectory(at: firstRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: secondRoot, withIntermediateDirectories: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.currentDirectoryURL = repository
        process.arguments = ["node", "--import", "tsx", "scripts/vault-http-test-server.ts",
            temporary.appendingPathComponent("server").path, ready.path]
        let errors = Pipe()
        process.standardError = errors
        process.standardOutput = FileHandle.nullDevice
        try process.run()
        defer {
            if process.isRunning { process.terminate(); process.waitUntilExit() }
            try? FileManager.default.removeItem(at: temporary)
        }
        for _ in 0..<500 {
            if FileManager.default.fileExists(atPath: ready.path) || !process.isRunning { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        guard FileManager.default.fileExists(atPath: ready.path) else {
            if process.isRunning { process.terminate(); process.waitUntilExit() }
            let output = errors.fileHandleForReading.readDataToEndOfFile()
            XCTFail("Fixture did not start: \(String(decoding: output.prefix(2000), as: UTF8.self))")
            return
        }
        struct Ready: Decodable { let origin: URL }
        let origin = try JSONDecoder().decode(Ready.self, from: Data(contentsOf: ready)).origin
        let binding = try LocalVaultSyncBinding(origin: origin, workspaceId: workspaceId)
        let firstTransport = try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: workspaceId, token: token)
        let secondTransport = try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: workspaceId, token: token)
        let first = try makeTestSync(root: firstRoot, binding: binding, transport: firstTransport)
        let second = try makeTestSync(root: secondRoot, binding: binding, transport: secondTransport)
        let itemId = "11111111-1111-4111-8111-111111111111"
        let path = "Notes/Shared.textpack"
        let original = try pack(in: temporary, itemId: itemId, body: "first\nmiddle\nlast")
        try write(original, to: firstRoot, path: path)
        let uploaded = try await first.sync()
        XCTAssertTrue(uploaded.errors.isEmpty, uploaded.errors.joined(separator: ", "))
        XCTAssertEqual(uploaded.uploaded, 1)
        let downloaded = try await second.sync()
        XCTAssertTrue(downloaded.errors.isEmpty, downloaded.errors.joined(separator: ", "))
        XCTAssertEqual(try Data(contentsOf: secondRoot.appendingPathComponent(path)), original)
        let catalog = await secondTransport.authoritativeFolders()
        XCTAssertTrue(catalog?.contains("Notes") == true, "Catalog: \(String(describing: catalog))")
        let capabilities = await secondTransport.capabilities()
        XCTAssertEqual(capabilities.pathIdentities?[path], itemId)

        // Both clients edit offline against the same baseline. The server must
        // merge distinct regions and send the resulting full archive back.
        try write(pack(in: temporary, itemId: itemId, body: "FIRST\nmiddle\nlast"), to: firstRoot, path: path)
        try write(pack(in: temporary, itemId: itemId, body: "first\nmiddle\nLAST"), to: secondRoot, path: path)
        let firstEdit = try await first.sync()
        XCTAssertTrue(firstEdit.errors.isEmpty, firstEdit.errors.joined(separator: ", "))
        let merged = try await second.sync()
        XCTAssertTrue(merged.errors.isEmpty, merged.errors.joined(separator: ", "))
        XCTAssertTrue(merged.conflicts.isEmpty, merged.conflicts.joined(separator: ", "))
        let refresh = try await first.sync()
        XCTAssertTrue(refresh.errors.isEmpty, refresh.errors.joined(separator: ", "))
        let firstBytes = try Data(contentsOf: firstRoot.appendingPathComponent(path))
        XCTAssertEqual(firstBytes, try Data(contentsOf: secondRoot.appendingPathComponent(path)))
        let contents = try LocalVaultDocumentStore(root: firstRoot).read(path: path).contents
        XCTAssertTrue(contents.markdown.contains("FIRST\nmiddle\nLAST"))
        XCTAssertEqual(contents.assets.first?.data, Data([0, 255, 17, 4]))
        XCTAssertNotNil(contents.templateJSON)
        let beforeIdle = try await stats(origin: origin)
        _ = try await first.sync()
        _ = try await second.sync()
        let afterIdle = try await stats(origin: origin)
        XCTAssertEqual(beforeIdle["uploads"], afterIdle["uploads"])
        XCTAssertEqual(beforeIdle["downloads"], afterIdle["downloads"])

        // Overlapping offline changes must retain both exact packs.
        let webBranch = try pack(in: temporary, itemId: itemId, body: "Web branch")
        let offlineBranch = try pack(in: temporary, itemId: itemId, body: "Offline branch")
        try write(webBranch, to: firstRoot, path: path)
        try write(offlineBranch, to: secondRoot, path: path)
        _ = try await first.sync()
        let conflict = try await second.sync()
        XCTAssertTrue(conflict.errors.isEmpty, conflict.errors.joined(separator: ", "))
        XCTAssertEqual(conflict.conflicts.count, 2)
        XCTAssertEqual(try Data(contentsOf: secondRoot.appendingPathComponent(path)), offlineBranch)
        let retained = try conflict.conflicts.map { try Data(contentsOf: secondRoot.appendingPathComponent($0)) }
        XCTAssertTrue(retained.contains(webBranch))
        XCTAssertTrue(retained.contains(offlineBranch))

        // A separate clean item proves path and tombstone interoperability.
        let movedId = "22222222-2222-4222-8222-222222222222"
        let oldPath = "Notes/Move.textpack", newPath = "Archive/Renamed.textpack"
        let moveBytes = try pack(in: temporary, itemId: movedId, body: "Keep my exact bytes")
        try write(moveBytes, to: firstRoot, path: oldPath)
        _ = try await first.sync()
        _ = try await second.sync()
        try FileManager.default.createDirectory(at: firstRoot.appendingPathComponent("Archive"), withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: firstRoot.appendingPathComponent(oldPath), to: firstRoot.appendingPathComponent(newPath))
        let moved = try await first.sync()
        XCTAssertTrue(moved.errors.isEmpty, moved.errors.joined(separator: ", "))
        let moveReceived = try await second.sync()
        XCTAssertTrue(moveReceived.errors.isEmpty, moveReceived.errors.joined(separator: ", "))
        XCTAssertFalse(FileManager.default.fileExists(atPath: secondRoot.appendingPathComponent(oldPath).path))
        XCTAssertEqual(try Data(contentsOf: secondRoot.appendingPathComponent(newPath)), moveBytes)
        try FileManager.default.removeItem(at: firstRoot.appendingPathComponent(newPath))
        let deleted = try await first.sync()
        XCTAssertTrue(deleted.errors.isEmpty, deleted.errors.joined(separator: ", "))
        _ = try await second.sync()
        XCTAssertFalse(FileManager.default.fileExists(atPath: secondRoot.appendingPathComponent(newPath).path))
        let manifest = try await secondTransport.manifest()
        XCTAssertTrue(manifest.contains { $0.itemId == movedId && $0.isDeleted })
        XCTAssertEqual(try Data(contentsOf: secondRoot.appendingPathComponent(".texttext/history/\(TextTextStableDigest.sha256Hex(moveBytes)).textpack")), moveBytes)
    }

    func testWholeFolderCaseMoveAcrossTwoNativeHTTPClientsAndLostReplyRestart() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_VAULT_HTTP_TEST"] == "1" else { throw XCTSkip("Enable the isolated loopback HTTP fixture") }
        var repository = URL(fileURLWithPath: #filePath); for _ in 0..<4 { repository.deleteLastPathComponent() }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-folder-http-native-" + UUID().uuidString).standardizedFileURL.resolvingSymlinksInPath()
        let firstRoot = temporary.appendingPathComponent("first"), secondRoot = temporary.appendingPathComponent("second"), serverRoot = temporary.appendingPathComponent("server"), ready = temporary.appendingPathComponent("ready.json")
        for root in [firstRoot, secondRoot, serverRoot.appendingPathComponent(workspaceId + "/Parent/Case/Empty")] { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/env"); process.currentDirectoryURL = repository
        process.arguments = ["node", "--import", "tsx", "scripts/vault-http-test-server.ts", serverRoot.path, ready.path]
        let errors = Pipe(); process.standardError = errors; process.standardOutput = FileHandle.nullDevice; try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() }; try? FileManager.default.removeItem(at: temporary) }
        for _ in 0..<500 { if FileManager.default.fileExists(atPath: ready.path) || !process.isRunning { break }; try await Task.sleep(nanoseconds: 20_000_000) }
        guard FileManager.default.fileExists(atPath: ready.path) else { XCTFail("Owned loopback fixture did not become ready"); return }
        struct Ready: Decodable { let origin: URL }
        let origin = try JSONDecoder().decode(Ready.self, from: Data(contentsOf: ready)).origin
        func control(_ path: String) async throws {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL); request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request); XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        }
        let binding = try LocalVaultSyncBinding(origin: origin, workspaceId: workspaceId), account = "folder-http-account"
        for root in [firstRoot, secondRoot] { try LocalVaultAccountRootOwnership.open(root: root, binding: binding, accountId: account) }
        let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForRequest = 2; configuration.timeoutIntervalForResource = 4
        let session = URLSession(configuration: configuration); defer { session.invalidateAndCancel() }
        let firstTransport = try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: workspaceId, token: token, session: session, accountId: account)
        let secondTransport = try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: workspaceId, token: token, session: session, accountId: account)
        let first = try makeTestSync(root: firstRoot, binding: binding, transport: firstTransport, accountId: account)
        let second = try makeTestSync(root: secondRoot, binding: binding, transport: secondTransport, accountId: account)
        let itemId = "33333333-3333-4333-8333-333333333333", oldPath = "Parent/Case/one.textpack", newPath = "Parent/CASE/one.textpack"
        let archive = try pack(in: temporary, itemId: itemId, body: "Exact native HTTP folder bytes")
        try write(archive, to: firstRoot, path: oldPath); _ = try await first.sync(); _ = try await second.sync()
        // Opt-in preserves the original loopback contract and tests discovery.
        try await control("__test/folder-case?enabled=1")
        _ = try await first.sync(); _ = try await second.sync()
        guard Darwin.rename(firstRoot.appendingPathComponent("Parent/Case").path, firstRoot.appendingPathComponent("Parent/CASE").path) == 0 else { throw POSIXError(.init(rawValue: errno)!) }
        try await control("__test/reply-loss?enabled=1")
        var lostReply = false
        do { _ = try await first.sync() } catch { lostReply = true }
        XCTAssertTrue(lostReply, "No response may be treated as a folder receipt")
        let statePath = LocalVaultDeviceState.directory(root: firstRoot).appendingPathComponent("sync/state.json")
        let pending = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: statePath)) as? [String: Any]); XCTAssertNotNil(pending["folderCaseCommand"])
        try await control("__test/reply-loss?enabled=0")
        let reopened = try makeTestSync(root: firstRoot, binding: binding, transport: firstTransport, accountId: account)
        _ = try await reopened.sync(); _ = try await second.sync()
        for root in [firstRoot, secondRoot] {
            XCTAssertFalse(try RetainedFileMove.exactRelativeExists(root: root, path: "Parent/Case"))
            XCTAssertTrue(try RetainedFileMove.exactRelativeExists(root: root, path: "Parent/CASE/Empty"))
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(newPath)), archive)
        }
        let catalog = try await secondTransport.manifest(); XCTAssertEqual(catalog.first(where: { $0.itemId == itemId })?.relativePath, newPath)
        let folders = await secondTransport.authoritativeFolders(); XCTAssertEqual(folders?.sorted(), ["Parent", "Parent/CASE", "Parent/CASE/Empty"])
        let before = try await stats(origin: origin); XCTAssertEqual(before["folderPublications"], 1); XCTAssertEqual(before["renames"], 0)
        _ = try await reopened.sync(); _ = try await second.sync(); let after = try await stats(origin: origin)
        for key in ["uploads", "downloads", "renames", "deletions", "folderRequests", "folderPublications"] { XCTAssertEqual(before[key], after[key], "Idle mutation/transfer: \(key)") }
    }

}
