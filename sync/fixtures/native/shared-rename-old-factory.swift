// Diagnostic overlay compiled against the exact previous product archive.
import Foundation
import XCTest
@testable import TextTextApp
import TextTextFileProviderKit

final class SharedRenamePreviousFactoryTests: XCTestCase {
    @MainActor
    func testPreviousFactoryAcceptsFourButRefusesFiveBeforeEngine() throws {
        guard let path = ProcessInfo.processInfo.environment["TEXTTEXT_SHARED_RENAME_FACTORY_PARENT"] else { throw XCTSkip("Explicit current-produced fixture required") }
        let parent = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        guard parent.lastPathComponent.hasPrefix("shared-rename-old-factory-") else { return XCTFail("Not an owned fixture") }
        for version in [4, 5] {
            let fixture = parent.appendingPathComponent("floor-\(version)"), root = fixture.appendingPathComponent("vault")
            LocalVaultDeviceState.configure(base: fixture.appendingPathComponent("device"))
            let before = try inventory(fixture)
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NoFactoryNetwork.self]
            let session = URLSession(configuration: config); defer { session.invalidateAndCancel() }
            let controller = LocalVaultConnectionController(root: root, session: session,
                verifiedCredentials: { LocalVaultAccountCredential(origin: URL(string: "https://fixture.test")!, token: "owned-offline-fixture", accountId: "account-a") })
            defer { controller.stop() }
            let after = try inventory(fixture)
            let changed = Set(before.keys).union(after.keys).filter { before[$0] != after[$0] }.sorted()
            try JSONSerialization.data(withJSONObject: ["changedPaths": changed], options: [.sortedKeys, .prettyPrinted]).write(to: parent.appendingPathComponent("old-factory-observation-\(version).json"), options: .withoutOverwriting)
            if version == 4 {
                XCTAssertNotNil(controller.collaborationEngine, "Known floor4 would otherwise ignore the future map")
            } else {
                XCTAssertNil(controller.collaborationEngine)
                XCTAssertEqual(controller.message, "This workspace's account recovery record could not be verified. Return to the original account or update TextText. Saved files are preserved.")
                XCTAssertTrue(changed.isEmpty, "Refusal changed paths: \(changed)")
            }
            XCTAssertEqual(NoFactoryNetwork.count, 0)
        }
    }
    private func inventory(_ root: URL) throws -> [String: Data] {
        let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .isDirectoryKey])!
        var result: [String: Data] = [:]
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .isDirectoryKey])
            guard values.isSymbolicLink != true else { throw CocoaError(.fileReadInvalidFileName) }
            if values.isRegularFile == true { result[String(url.path.dropFirst(root.path.count + 1))] = try Data(contentsOf: url) }
            else if values.isDirectory == true { result[String(url.path.dropFirst(root.path.count + 1)) + "/"] = Data() }
        }
        return result
    }
}
private final class NoFactoryNetwork: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var count = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.count += 1; client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
