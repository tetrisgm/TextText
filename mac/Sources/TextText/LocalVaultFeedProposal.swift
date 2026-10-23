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
    typealias Transport = (LocalVaultAccountCredential, String, String, String) async throws -> String
    let captured: Context
    let current: () throws -> Context?
    let transport: Transport

    init(captured: Context, current: @escaping () throws -> Context?,
         transport: @escaping Transport = { account, workspaceID, commandName, argumentsJSON in
             let api = LiveTextTextSyncAPI(origin: account.origin, token: account.token)
             if commandName == "commands" {
                 return try await api.agentAvailableCommands(agentName: "TextText Mac assistant",
                     agentIntent: "Read proposal schemas").get()
             }
             let reply = try await api.agentRunCommand(name: "proposal:" + commandName,
                 argumentsJSON: argumentsJSON, expectedWorkspaceId: workspaceID,
                 agentName: "TextText Mac assistant", agentIntent: "Stage a workspace change for owner review").get()
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

    static let workspaceCommands: Set<String> = ["add_item_asset", "save_item_as_look",
        "update_item_type", "retire_document_template", "set_item_template"]

    func workspaceTool(_ tool: String, folder: String, arguments: [String: Any], retryKey: String) async throws -> String {
        let value = try authority()
        guard folder.isEmpty else { throw VaultAgentError("Choose a workspace-root task for asset and template proposals.") }
        if tool == "describe_workspace_proposals" {
            guard arguments.isEmpty else { throw VaultAgentError("This discovery tool takes no arguments.") }
            let response = try await transport(value.account, captured.binding.workspaceId, "commands", "{}")
            _ = try authority()
            guard let object = try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any],
                  let proposals = object["proposals"] as? [[String: Any]] else {
                throw VaultAgentError("Workspace proposal discovery is unavailable.")
            }
            let selected = proposals.filter { ($0["name"] as? String).map(Self.workspaceCommands.contains) == true }
            guard selected.count == Self.workspaceCommands.count, Set(selected.compactMap { $0["name"] as? String }) == Self.workspaceCommands else {
                throw VaultAgentError("This server does not offer the required workspace proposals.")
            }
            return String(decoding: try JSONSerialization.data(withJSONObject: selected), as: UTF8.self)
        }
        guard tool == "propose_workspace_change", Set(arguments.keys) == ["command", "argumentsJSON"],
              let command = arguments["command"] as? String, Self.workspaceCommands.contains(command),
              let json = arguments["argumentsJSON"] as? String, json.utf8.count <= 1_000_000,
              var payload = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              payload["idempotency_key"] == nil, !retryKey.isEmpty else {
            throw VaultAgentError("Use a discovered workspace proposal and its arguments; retry identity is supplied by TextText.")
        }
        payload["idempotency_key"] = retryKey
        let bytes = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let response = try await transport(value.account, captured.binding.workspaceId, command,
            String(decoding: bytes, as: UTF8.self))
        _ = try authority()
        return response
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
        let response = try await transport(value.account, captured.binding.workspaceId, "add_feed",
            String(decoding: bytes, as: UTF8.self))
        _ = try authority()
        return response
    }
}
