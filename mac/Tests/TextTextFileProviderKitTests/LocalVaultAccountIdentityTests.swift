import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultAccountIdentityTests: XCTestCase {
    let origin = URL(string: "https://texttext.test")!
    func json(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    func testVerifiedDiscoveryAndLegacyProfileFallback() throws {
        var paths: [String] = []
        let direct = try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: nil) { path in
            paths.append(path); return try self.json(["accountId": "account-a"])
        }
        XCTAssertEqual(direct, "account-a"); XCTAssertEqual(paths, ["/api/vault"])
        let workspace = UUID().uuidString; paths = []
        let legacy = try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: nil) { path in
            paths.append(path)
            return try self.json(path == "/api/vault" ? ["workspaceId": workspace] : ["accountId": "account-a"])
        }
        XCTAssertEqual(legacy, direct); XCTAssertEqual(paths, ["/api/vault", "/api/vault/" + workspace + "/account"])
    }
    func testUnchangedCredentialCacheIsOfflineAndInvalidValuesFailClosed() throws {
        XCTAssertEqual(try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: "account-a") { _ in
            XCTFail("Cached credential made a network request"); throw LocalVaultAccountIdentity.Failure.unverified
        }, "account-a")
        for invalid in ["../other", "", "account a", "account-a\n"] {
            XCTAssertThrowsError(try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: invalid) { _ in try self.json(["accountId": "account-b"]) })
            XCTAssertThrowsError(try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: nil) { _ in try self.json(["accountId": invalid]) })
        }
        XCTAssertThrowsError(try LocalVaultAccountIdentity.resolve(origin: origin.appendingPathComponent("wrong"), cachedAccountId: "account-a") { _ in Data() })
        XCTAssertThrowsError(try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: nil) { _ in Data(repeating: 32, count: 65537) })
        XCTAssertThrowsError(try LocalVaultAccountIdentity.resolve(origin: origin, cachedAccountId: nil) { _ in throw LocalVaultAccountIdentity.Failure.unverified })
    }
}
