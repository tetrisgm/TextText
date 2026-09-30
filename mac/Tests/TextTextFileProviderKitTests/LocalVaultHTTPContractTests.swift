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
        let first = try LocalVaultSync(root: firstRoot, binding: binding, transport: firstTransport)
        let second = try LocalVaultSync(root: secondRoot, binding: binding, transport: secondTransport)
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
}
