import Foundation
import XCTest
import TextTextSyncTestSupport
@testable import TextTextFileProviderKit

final class LocalVaultPhysicalProviderTests: XCTestCase {
    func testRealICloudEvictionDoesNotBecomeDeletion() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_ICLOUD_PROVIDER_TEST"] == "isolated" else {
            throw XCTSkip("Run only this suite in a separate process with TEXTTEXT_ICLOUD_PROVIDER_TEST=isolated")
        }
        let cloud = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs")
        guard try cloud.resourceValues(forKeys: [.isUbiquitousItemKey]).isUbiquitousItem == true else { throw XCTSkip("iCloud Drive unavailable") }
        let root = cloud.appendingPathComponent("TextText-provider-verification-" + UUID().uuidString)
        let privateRoot = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-provider-state-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: privateRoot, withIntermediateDirectories: false)
        // Keep this bounded fixture and its private recovery bytes for inspection.
        // No existing iCloud document or provider preference is modified.
        LocalVaultDeviceState.configure(base: privateRoot)
        let data = try providerFixturePack(in: privateRoot)
        try data.write(to: privateRoot.appendingPathComponent("original.textpack"))
        let transport = PhysicalProviderTransport(data: data)
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://fixture.test")!, workspaceId: "provider")
        let engine = try makeTestSync(root: root, binding: binding, transport: transport)
        _ = try await engine.sync()
        let file = root.appendingPathComponent("Provider.textpack")
        print("PHYSICAL_PROVIDER fixture=\(root.path) private=\(privateRoot.path)")
        let uploaded = try await waitFor(file, seconds: 120) { $0.ubiquitousItemIsUploaded == true }
        guard uploaded else { throw XCTSkip("Disposable fixture did not finish uploading; eviction was not attempted") }
        try FileManager.default.evictUbiquitousItem(at: file)
        let evicted = try await waitFor(file, seconds: 30) { $0.ubiquitousItemDownloadingStatus == .notDownloaded }
        guard evicted else { throw XCTSkip("Provider did not expose an evicted state; physical absence gate remains unverified") }
        print("PHYSICAL_PROVIDER observed notDownloaded")
        // A provider placeholder may hydrate on read. It must never announce a
        // deletion merely because its ordinary file bytes were unavailable.
        _ = try await engine.sync()
        let deleted = await transport.deletions
        XCTAssertEqual(deleted, 0)
        try FileManager.default.startDownloadingUbiquitousItem(at: file)
        let hydrated = try await waitFor(file, seconds: 60) { $0.ubiquitousItemDownloadingStatus == .current }
        XCTAssertTrue(hydrated)
        XCTAssertEqual(try Data(contentsOf: file), data)
        _ = try await engine.sync()
        let finalDeletes = await transport.deletions
        XCTAssertEqual(finalDeletes, 0)
        print("PHYSICAL_PROVIDER hydrated exact bytes; remote deletion count=0")
    }
    func testRealICloudDuplicateDeliveryAndHTTPReconnectRemainIdle() async throws {
        guard ProcessInfo.processInfo.environment["TEXTTEXT_ICLOUD_PROVIDER_TEST"] == "isolated" else {
            throw XCTSkip("Run only this suite in a separate process with TEXTTEXT_ICLOUD_PROVIDER_TEST=isolated")
        }
        let cloud = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs")
        guard try cloud.resourceValues(forKeys: [.isUbiquitousItemKey]).isUbiquitousItem == true else { throw XCTSkip("iCloud Drive unavailable") }
        let root = cloud.appendingPathComponent("TextText-provider-duplicate-" + UUID().uuidString)
        let privateRoot = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-provider-duplicate-state-" + UUID().uuidString)
        let peerRoot = privateRoot.appendingPathComponent("peer"), ready = privateRoot.appendingPathComponent("ready.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: peerRoot, withIntermediateDirectories: true)
        LocalVaultDeviceState.configure(base: privateRoot.appendingPathComponent("device-state"))
        print("PHYSICAL_PROVIDER_DUPLICATE fixture=\(root.path) private=\(privateRoot.path)")
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { repository.deleteLastPathComponent() }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.currentDirectoryURL = repository
        process.arguments = ["node", "--import", "tsx", "scripts/vault-http-test-server.ts", privateRoot.appendingPathComponent("server").path, ready.path]
        process.standardOutput = FileHandle.nullDevice
        let errors = Pipe(); process.standardError = errors
        try process.run()
        defer { if process.isRunning { process.terminate(); process.waitUntilExit() } }
        for _ in 0..<500 {
            if FileManager.default.fileExists(atPath: ready.path) || !process.isRunning { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        guard FileManager.default.fileExists(atPath: ready.path) else { throw LocalVaultSyncFailure.invalidResponse }
        struct Ready: Decodable { let origin: URL }
        let origin = try JSONDecoder().decode(Ready.self, from: Data(contentsOf: ready)).origin
        let binding = try LocalVaultSyncBinding(origin: origin, workspaceId: "contract-workspace")
        let token = "vault-http-fixture" // Synthetic credential for the owned loopback fixture only.
        func transport() throws -> HTTPLocalVaultSyncTransport { try HTTPLocalVaultSyncTransport(origin: origin, workspaceId: binding.workspaceId, token: token) }
        func stats() async throws -> [String: Int] {
            var request = URLRequest(url: origin.appendingPathComponent("__test/stats"))
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (bytes, _) = try await URLSession.shared.data(for: request)
            return try JSONDecoder().decode([String: Int].self, from: bytes)
        }
        let itemId = UUID().uuidString, path = "Provider.textpack"
        let peerFile = peerRoot.appendingPathComponent(path), file = root.appendingPathComponent(path)
        let original = try providerFixturePack(in: privateRoot, itemId: itemId, body: "First duplicate delivery")
        try original.write(to: privateRoot.appendingPathComponent("original.textpack"))
        try original.write(to: peerFile, options: .atomic)
        let peer = try makeTestSync(root: peerRoot, binding: binding, transport: transport())
        let first = try await peer.sync(); XCTAssertEqual(first.uploaded, 1)
        // Deliver the same archive into a real provider root before the native
        // HTTP mirror sees it. This is one-Mac double delivery, not a claim of
        // having driven a second device's cloud account.
        try original.write(to: file, options: .atomic)
        var mirror = try makeTestSync(root: root, binding: binding, transport: transport())
        let beforeDuplicate = try await stats()
        _ = try await mirror.sync()
        let afterDuplicate = try await stats()
        XCTAssertEqual(afterDuplicate["uploads"], beforeDuplicate["uploads"])
        let updated = try providerFixturePack(in: privateRoot, itemId: itemId, body: "Matching later provider and TextText delivery")
        try updated.write(to: peerFile, options: .atomic)
        _ = try await peer.sync()
        try updated.write(to: file, options: .atomic)
        let matching = try await stats()
        _ = try await mirror.sync()
        let afterMatching = try await stats()
        for key in ["uploads", "deletions", "renames"] { XCTAssertEqual(afterMatching[key], matching[key], "Duplicate mutation echo: \(key)") }
        _ = try await mirror.sync()
        let idle = try await stats()
        for key in ["uploads", "downloads", "deletions", "renames"] { XCTAssertEqual(idle[key], afterMatching[key], "Idle echo: \(key)") }
        XCTAssertEqual(try Data(contentsOf: file), updated)
        let changed = try providerFixturePack(in: privateRoot, itemId: itemId, body: "Durable local provider edit after lost HTTP reply")
        try changed.write(to: file, options: .atomic)
        func replyLoss(_ enabled: Bool) async throws {
            var request = URLRequest(url: URL(string: "__test/reply-loss?enabled=" + (enabled ? "1" : "0"), relativeTo: origin)!)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try await URLSession.shared.data(for: request)
        }
        try await replyLoss(true)
        _ = try await mirror.sync()
        try await replyLoss(false)
        let journal = LocalVaultDeviceState.directory(root: root).appendingPathComponent("sync/state.json")
        let pendingState = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: journal)) as? [String: Any])
        let outbox = try XCTUnwrap(pendingState["outbox"] as? [String: Any])
        XCTAssertNotNil(outbox[itemId], "A lost reply retains its durable operation until restart reconciliation")
        mirror = try makeTestSync(root: root, binding: binding, transport: transport())
        let resumed = try await mirror.sync()
        XCTAssertTrue(resumed.errors.isEmpty, resumed.errors.joined(separator: ", "))
        let resumedState = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: journal)) as? [String: Any])
        XCTAssertNil((resumedState["outbox"] as? [String: Any])?[itemId])
        let reconnected = try await stats()
        _ = try await mirror.sync()
        let stable = try await stats()
        for key in ["uploads", "downloads", "deletions", "renames"] { XCTAssertEqual(stable[key], reconnected[key], "Reconnect/idle echo: \(key)") }
        XCTAssertEqual(try Data(contentsOf: file), changed)
        XCTAssertEqual(try LocalVaultDocumentStore(root: root).list(), [path])
        let verification = try transport()
        let items = try await verification.manifest()
        XCTAssertEqual(items.filter { !$0.isDeleted }.map(\.itemId), [itemId])
        let remote = try await verification.download(itemId: itemId)
        XCTAssertEqual(remote.data, changed)
        print("PHYSICAL_PROVIDER_DUPLICATE matching arrivals and HTTP restart verified; waiting for physical eviction")
        let uploaded = try await waitFor(file, seconds: 120) { $0.ubiquitousItemIsUploaded == true }
        guard uploaded else { throw XCTSkip("Disposable duplicate fixture did not upload; physical unavailable gate remains unverified") }
        try FileManager.default.evictUbiquitousItem(at: file)
        let evicted = try await waitFor(file, seconds: 30) { $0.ubiquitousItemDownloadingStatus == .notDownloaded }
        guard evicted else { throw XCTSkip("Provider did not expose an evicted duplicate fixture") }
        _ = try await mirror.sync()
        let unavailable = try await stats()
        XCTAssertEqual(unavailable["deletions"], 0)
        try FileManager.default.startDownloadingUbiquitousItem(at: file)
        let hydrated = try await waitFor(file, seconds: 60) { $0.ubiquitousItemDownloadingStatus == .current }
        XCTAssertTrue(hydrated); XCTAssertEqual(try Data(contentsOf: file), changed)
        _ = try await mirror.sync()
        let final = try await stats()
        XCTAssertEqual(final["deletions"], 0)
        XCTAssertEqual(final["uploads"], stable["uploads"])
        print("PHYSICAL_PROVIDER_DUPLICATE exact matching delivery, restart and eviction/hydration; no idle upload or remote deletion")
    }
    private func waitFor(_ file: URL, seconds: Int, condition: (URLResourceValues) -> Bool) async throws -> Bool {
        let deadline = Date().addingTimeInterval(Double(seconds))
        while Date() < deadline {
            var fresh = URL(fileURLWithPath: file.path); fresh.removeAllCachedResourceValues()
            if let values = try? fresh.resourceValues(forKeys: [.ubiquitousItemIsUploadedKey, .ubiquitousItemDownloadingStatusKey]), condition(values) { return true }
            try await Task.sleep(for: .seconds(1))
        }
        return false
    }
}
private func providerFixturePack(in scratch: URL, itemId: String = "provider-fixture", body: String = "iCloud eviction must preserve this fixture.") throws -> Data {
    let doc = try BuiltinTextPackDocument.create(title: "Disposable provider verification", body: body)
    let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(itemId)\"\ntitle: Disposable provider verification\n---\n\(body)", documentJSON: doc.documentJSON, templateJSON: doc.templateJSON, assets: [], sourceURL: nil, in: scratch)
    return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
}
private actor PhysicalProviderTransport: LocalVaultSyncTransport {
    let data: Data
    var deletions = 0
    init(data: Data) { self.data = data }
    func manifest() -> [LocalVaultRemoteItem] { [.init(itemId: "provider-fixture", relativePath: "Provider.textpack", revision: TextTextStableDigest.sha256Hex(data))] }
    func download(itemId: String) -> LocalVaultRemotePack { .init(data: data, relativePath: "Provider.textpack", revision: TextTextStableDigest.sha256Hex(data)) }
    func upload(itemId: String, path: String, data: Data, baseRevision: String?, operationId: String, nativeEditor: Bool) throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func rename(itemId: String, from: String, to: String, baseRevision: String, operationId: String) throws -> String { throw LocalVaultSyncFailure.invalidResponse }
    func delete(itemId: String, path: String, baseRevision: String, operationId: String) { deletions += 1 }
}
