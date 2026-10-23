import Foundation
import TextTextFileProviderKit

/// Captures the window authority, never accepting account/workspace credentials
/// from a model. The server owns URL validation, review, fetch, audit and retry.
@MainActor
struct LocalVaultFeedProposal {
    struct Context {
        let root: URL
        let account: LocalVaultAccountCredential
        let binding: LocalVaultSyncBinding
    }
    typealias Transport = (LocalVaultAccountCredential, String, String) async throws -> String
    let captured: Context
    let current: () throws -> Context?
    let transport: Transport

    init(captured: Context, current: @escaping () throws -> Context?,
         transport: @escaping Transport = { account, workspaceID, argumentsJSON in
             let api = LiveTextTextSyncAPI(origin: account.origin, token: account.token)
             let reply = try await api.agentRunCommand(name: "proposal:add_feed",
                 argumentsJSON: argumentsJSON, expectedWorkspaceId: workspaceID,
                 agentName: "TextText Mac assistant", agentIntent: "Stage a feed for owner review").get()
             guard let message = reply.message, !message.isEmpty else {
                 throw VaultAgentError("The proposal response is missing its review details.")
             }
             return try reviewReceipt(message)
         }) {
        self.captured = captured; self.current = current; self.transport = transport
    }

    static func reviewReceipt(_ message: String) throws -> String {
        struct Receipt: Codable {
            let approvalRequired: Bool
            let proposalId: String
            let reviewUrl: String
            let message: String
        }
        let receipt = try JSONDecoder().decode(Receipt.self, from: Data(message.utf8))
        guard receipt.approvalRequired,
              !receipt.proposalId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !receipt.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let link = URL(string: receipt.reviewUrl), link.scheme == "https", link.host != nil,
              link.user == nil, link.password == nil else {
            throw VaultAgentError("The proposal response is missing its review details.")
        }
        return String(decoding: try JSONEncoder().encode(receipt), as: UTF8.self)
    }

    private func authority() throws -> Context {
        try Task.checkCancellation()
        guard let value = try current(), value.root == captured.root,
              value.binding == captured.binding,
              captured.account.accountId != nil,
              captured.account.sameAccount(as: value.account),
              value.account.origin == value.binding.origin else {
            throw VaultAgentError("The selected account or workspace changed. Start a new folder task.")
        }
        return value
    }

    func stage(folder: String, arguments: [String: Any], retryKey: String) async throws -> String {
        let value = try authority()
        guard Set(arguments.keys).isSubset(of: ["url", "name"]),
              let url = arguments["url"] as? String,
              arguments["name"] == nil || arguments["name"] is String,
              !retryKey.isEmpty else { throw VaultAgentError("Provide a feed URL and an optional name.") }
        // The selected folder is authoritative. The model cannot choose a
        // different destination or supply a workspace/idempotency identity.
        var command: [String: Any] = ["url": url, "parent_path": folder, "idempotency_key": retryKey]
        if let name = arguments["name"] { command["name"] = name }
        let bytes = try JSONSerialization.data(withJSONObject: command, options: [.sortedKeys])
        let response = try await transport(value.account, captured.binding.workspaceId,
            String(decoding: bytes, as: UTF8.self))
        _ = try authority()
        return response
    }
}
