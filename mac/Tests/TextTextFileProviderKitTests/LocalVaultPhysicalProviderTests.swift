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
private func providerFixturePack(in scratch: URL) throws -> Data {
    let doc = try BuiltinTextPackDocument.create(title: "Disposable provider verification", body: "iCloud eviction must preserve this fixture.")
    let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"provider-fixture\"\ntitle: Disposable provider verification\n---\niCloud eviction must preserve this fixture.", documentJSON: doc.documentJSON, templateJSON: doc.templateJSON, assets: [], sourceURL: nil, in: scratch)
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
