import Foundation
import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultFeedProposalTests: XCTestCase {
    @MainActor
    func testReviewReceiptRequiresApprovalIdentityAndReviewLink() throws {
        let valid = #"{"approvalRequired":true,"proposalId":"proposal-1","reviewUrl":"https://fixture.test/proposals/proposal-1","message":"Staged for review","proposal":{"ignored":"details"}}"#
        let compact = try LocalVaultFeedProposal.reviewReceipt(valid)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(compact.utf8)) as? [String: Any])
        XCTAssertEqual(value["proposalId"] as? String, "proposal-1")
        XCTAssertEqual(value["reviewUrl"] as? String, "https://fixture.test/proposals/proposal-1")
        XCTAssertNil(value["proposal"])
        for invalid in [
            "Staged for review",
            #"{"message":"Staged for review"}"#,
            valid.replacingOccurrences(of: "true", with: "false"),
            valid.replacingOccurrences(of: #""proposalId":"proposal-1""#, with: #""proposalId":"""#),
            valid.replacingOccurrences(of: "https://fixture.test", with: "javascript:"),
            valid.replacingOccurrences(of: "https://fixture.test", with: "https://user:password@fixture.test"),
            valid.replacingOccurrences(of: #""reviewUrl":"https://fixture.test/proposals/proposal-1",""#, with: ""),
        ] { XCTAssertThrowsError(try LocalVaultFeedProposal.reviewReceipt(invalid)) }
    }

    @MainActor
    func testCapturesDestinationAndUsesCurrentTokenForSameAccount() async throws {
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://example.test")!, workspaceId: "workspace-a")
        let root = URL(fileURLWithPath: "/private/tmp/feed-scope")
        let original = LocalVaultAccountCredential(origin: binding.origin, token: "old", accountId: "owner")
        let refreshed = LocalVaultAccountCredential(origin: binding.origin, token: "refreshed", accountId: "owner")
        let captured = LocalVaultFeedProposal.Context(root: root, account: original, binding: binding)
        var calls = 0
        let adapter = LocalVaultFeedProposal(captured: captured, current: {
            .init(root: root, account: refreshed, binding: binding)
        }, transport: { account, workspaceID, json in
            calls += 1
            XCTAssertEqual(account.token, "refreshed")
            XCTAssertEqual(workspaceID, "workspace-a")
            let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String])
            XCTAssertEqual(value, ["url": "https://example.test/feed", "parent_path": "News", "idempotency_key": "call-one"])
            return "Review proposal-one"
        })
        let result = try await adapter.stage(folder: "News", arguments: ["url": "https://example.test/feed"], retryKey: "call-one")
        XCTAssertEqual(result, "Review proposal-one")
        XCTAssertEqual(calls, 1)
        do {
            _ = try await adapter.stage(folder: "News", arguments: ["url": "https://example.test/feed", "parent_path": "Elsewhere"], retryKey: "call-one")
            XCTFail("Model destination must be refused")
        } catch {}
        XCTAssertEqual(calls, 1)
    }

    @MainActor
    func testChangedAuthorityRefusesBeforeRequestAndLateResult() async throws {
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://example.test")!, workspaceId: "workspace-a")
        let captured = LocalVaultFeedProposal.Context(root: URL(fileURLWithPath: "/private/tmp/feed-scope"),
            account: .init(origin: binding.origin, token: "token", accountId: "owner"), binding: binding)
        var current: LocalVaultFeedProposal.Context? = captured
        var calls = 0
        let adapter = LocalVaultFeedProposal(captured: captured, current: { current }, transport: { _, _, _ in
            calls += 1
            current = nil // Window retired while the durable server proposal was staged.
            return "Review retained proposal"
        })
        do {
            _ = try await adapter.stage(folder: "News", arguments: ["url": "https://example.test/feed"], retryKey: "call-one")
            XCTFail("Late proposal must not cross a retired window")
        } catch {}
        XCTAssertEqual(calls, 1)
        do {
            _ = try await adapter.stage(folder: "News", arguments: ["url": "https://example.test/feed"], retryKey: "call-one")
            XCTFail("Retired window must refuse before transport")
        } catch {}
        XCTAssertEqual(calls, 1)
    }
}
