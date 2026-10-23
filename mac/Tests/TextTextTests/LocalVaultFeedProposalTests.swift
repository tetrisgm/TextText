import Foundation
import XCTest
import TextTextFileProviderKit
@testable import TextTextApp

final class LocalVaultFeedProposalTests: XCTestCase {
    @MainActor
    func testWorkspaceProposalsRequireRootAndHostOwnedRetryIdentity() async throws {
        let binding = try LocalVaultSyncBinding(origin: URL(string: "https://example.test")!, workspaceId: "workspace-a")
        let context = LocalVaultFeedProposal.Context(root: URL(fileURLWithPath: "/private/tmp/root-proposal"),
            account: .init(origin: binding.origin, token: "fixture", accountId: "owner"), binding: binding)
        var commands: [String] = [], keys: [String] = []
        var duplicateSchema = false
        var current: LocalVaultFeedProposal.Context? = context
        let adapter = LocalVaultFeedProposal(captured: context, current: { current }, transport: { _, workspace, command, json in
            XCTAssertEqual(workspace, "workspace-a")
            commands.append(command)
            if command == "commands" {
                return String(decoding: try JSONSerialization.data(withJSONObject: ["proposals":
                    (Array(LocalVaultFeedProposal.workspaceCommands) + (duplicateSchema ? ["add_item_asset"] : [])).map { ["name": $0, "inputSchema": ["type": "object"]] }]), as: UTF8.self)
            }
            let args = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            keys.append(try XCTUnwrap(args["idempotency_key"] as? String))
            return "retained review receipt"
        })
        let args: [String: Any] = ["command": "save_item_as_look", "argumentsJSON": #"{"id":"source","name":"Look"}"#]
        for folder in ["Notes", "Templates"] {
            do { _ = try await adapter.workspaceTool("propose_workspace_change", folder: folder, arguments: args, retryKey: "same-call"); XCTFail("Named folder must not access template library") } catch {}
        }
        XCTAssertTrue(commands.isEmpty)
        _ = try await adapter.workspaceTool("describe_workspace_proposals", folder: "", arguments: [:], retryKey: "describe")
        for _ in 0..<2 { _ = try await adapter.workspaceTool("propose_workspace_change", folder: "", arguments: args, retryKey: "same-call") }
        XCTAssertEqual(commands, ["commands", "save_item_as_look", "save_item_as_look"])
        XCTAssertEqual(keys, ["same-call", "same-call"])
        for invalid: [String: Any] in [
            ["command": "delete_item", "argumentsJSON": "{}"],
            ["command": "save_item_as_look", "argumentsJSON": #"{"idempotency_key":"model-key"}"#],
        ] {
            do { _ = try await adapter.workspaceTool("propose_workspace_change", folder: "", arguments: invalid, retryKey: "same-call"); XCTFail("Unapproved tool or retry override") } catch {}
        }
        XCTAssertEqual(commands.count, 3)
        duplicateSchema = true
        do { _ = try await adapter.workspaceTool("describe_workspace_proposals", folder: "", arguments: [:], retryKey: "describe"); XCTFail("Duplicate schema must refuse discovery") } catch {}
        XCTAssertEqual(commands.count, 4)
        current = nil
        do { _ = try await adapter.workspaceTool("describe_workspace_proposals", folder: "", arguments: [:], retryKey: "describe"); XCTFail("Retired account must refuse discovery") } catch {}
        XCTAssertEqual(commands.count, 4)
    }

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
        }, transport: { account, workspaceID, command, json in
            XCTAssertEqual(command, "add_feed")
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
        let adapter = LocalVaultFeedProposal(captured: captured, current: { current }, transport: { _, _, _, _ in
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
