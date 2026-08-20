import Foundation

/// The small JSON-RPC boundary used by the embedded TextText agent.
///
/// App Server is deliberately kept behind this type. The web view receives
/// status and streamed events, never the account token or process environment.
public struct CodexAppServerMessage: Equatable {
    /// The original JSON-RPC id, preserving whether the peer used a string or
    /// a number. App Server uses numeric ids for dynamic tool calls, and a
    /// response with the stringified id is a different JSON-RPC response.
    public let jsonRPCID: AnyHashable?
    public let id: String?
    public let method: String?
    public let params: [String: AnyHashable]?
    public let result: [String: AnyHashable]?
    public let rawParams: [String: Any]?
    public let rawResult: [String: Any]?
    public let errorMessage: String?

    public init(data: Data) throws {
        let object = try JSONSerialization.jsonObject(with: data)
        guard let dictionary = object as? [String: Any] else {
            throw CodexAppServerError.invalidMessage
        }
        jsonRPCID = dictionary["id"] as? AnyHashable
        id = jsonRPCID.map { String(describing: $0.base) }
        method = dictionary["method"] as? String
        params = dictionary["params"] as? [String: AnyHashable]
        result = dictionary["result"] as? [String: AnyHashable]
        rawParams = dictionary["params"] as? [String: Any]
        rawResult = dictionary["result"] as? [String: Any]
        if let error = dictionary["error"] as? [String: Any],
           let message = error["message"] as? String {
            errorMessage = message
        } else {
            errorMessage = nil
        }
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.jsonRPCID == rhs.jsonRPCID && lhs.method == rhs.method && lhs.errorMessage == rhs.errorMessage
    }
}

public enum CodexAppServerError: Error, Equatable {
    case invalidMessage
    case runtimeMissing
    case processExited(Int32)
    case notRunning
}

/// Typed values extracted from `account/read`. App Server represents a signed
/// out account as JSON null, which must not be confused with a present result
/// dictionary.
public struct CodexAccountSummary: Equatable {
    public let email: String?
    public let planType: String?

    public init(email: String?, planType: String?) {
        self.email = email
        self.planType = planType
    }

    public init?(result: [String: Any]?) {
        guard let account = result?["account"] as? [String: Any] else { return nil }
        email = account["email"] as? String
        planType = account["planType"] as? String
    }
}

public enum CodexTurnOutcome: Equatable {
    case completed
    case failed(String?)
    case interrupted

    public init?(params: [String: Any]?) {
        guard let turn = params?["turn"] as? [String: Any],
              let status = turn["status"] as? String else { return nil }
        switch status {
        case "completed":
            self = .completed
        case "failed":
            let error = turn["error"] as? [String: Any]
            self = .failed(error?["message"] as? String)
        case "interrupted":
            self = .interrupted
        default:
            return nil
        }
    }
}

/// The authoritative agent-message shape emitted by App Server in
/// `item/started` and `item/completed` notifications. Commentary and final
/// answers are separate items. The native shell must never expose commentary
/// as though it were the answer shown in TextText.
public struct CodexAgentMessage: Equatable {
    public enum Phase: String, Equatable {
        case commentary
        case finalAnswer = "final_answer"
    }

    public let id: String
    public let phase: Phase
    public let text: String

    public init(id: String, phase: Phase, text: String) {
        self.id = id
        self.phase = phase
        self.text = text
    }

    public init?(params: [String: Any]?) {
        guard let item = params?["item"] as? [String: Any],
              item["type"] as? String == "agentMessage",
              let id = item["id"] as? String,
              let rawPhase = item["phase"] as? String,
              let phase = Phase(rawValue: rawPhase) else { return nil }
        self.id = id
        self.phase = phase
        self.text = item["text"] as? String ?? ""
    }
}

/// Current App Server request shapes used by the native assistant. Keeping
/// these at the protocol boundary makes silent schema drift testable. In
/// particular, App Server ignores the old `sandboxPolicy` field and falls back
/// to workspace-write, while `sandbox: "read-only"` produces a read-only
/// thread.
public enum CodexAppServerRequests {
    /// The embedded agent is a product surface, not a general Codex session.
    /// Its workspace access comes only from dynamic tools registered by the
    /// web view. Keeping that boundary explicit prevents an installed skill,
    /// CLI, or MCP server from becoming an accidental second data path.
    public static let embeddedDeveloperInstructions = """
    You are the embedded TextText Agent inside the TextText writing app.
    Use only the dynamic tools supplied on this thread for TextText workspace work.
    Never use installed skills, shell commands, the texttext CLI, a local provider, hosted MCP, or the filesystem.
    If a required TextText dynamic tool is missing or fails, report one concise error and stop.
    Do not retry through another integration or narrate provider fallback attempts.
    For read-only requests, do not change workspace content.
    For a workspace-wide catch-up or recent-work summary, never call search or read_item. Call list_folders once, then list_items only for the relevant folders, and answer from the returned titles, dates, kinds, and statuses. Make at most four dynamic tool calls for that request.
    Keep any progress update to one short sentence, then provide the useful answer.
    """

    /// Extracts only server names from `config/read`. No server command, URL,
    /// environment value, or OAuth material crosses this boundary.
    public static func effectiveMCPServerNames(configReadResult: [String: Any]?) -> [String]? {
        guard let config = configReadResult?["config"] as? [String: Any],
              let servers = config["mcp_servers"] as? [String: Any] else { return nil }
        return servers.keys.sorted()
    }

    /// Starts an isolated embedded thread. App Server otherwise inherits every
    /// MCP configured in the owner's global Codex profile, including servers
    /// unrelated to TextText and servers that may currently require login.
    /// Disable each effective server explicitly because an empty map would be
    /// merged with, rather than replace, the inherited configuration.
    public static func threadStart(
        dynamicTools: [[String: Any]],
        disabledMCPServers: [String],
        workingDirectory: String? = nil
    ) -> [String: Any] {
        let disabledServers = Dictionary(uniqueKeysWithValues:
            Set(disabledMCPServers).sorted().map { ($0, ["enabled": false]) })
        var params: [String: Any] = [
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "ephemeral": true,
            "dynamicTools": dynamicTools,
            "developerInstructions": embeddedDeveloperInstructions,
        ]
        params["config"] = ["mcp_servers": disabledServers]
        if let workingDirectory { params["cwd"] = workingDirectory }
        return params
    }

    public static func turnInterrupt(threadID: String, turnID: String) -> [String: Any] {
        ["threadId": threadID, "turnId": turnID]
    }

    public static var chatGPTLoginStart: [String: Any] {
        [
            "type": "chatgpt",
            "appBrand": "chatgpt",
            "codexStreamlinedLogin": true,
            "useHostedLoginSuccessPage": true,
        ]
    }

    public static func dynamicToolResult(text: String, success: Bool) -> [String: Any] {
        [
            "contentItems": [["type": "inputText", "text": text]],
            "success": success,
        ]
    }

    public static func responseEnvelope(
        id: AnyHashable,
        result: [String: Any]
    ) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id.base, "result": result]
    }
}

#if !TEXTTEXT_STORE

/// Locates a standalone Codex runtime for the Developer ID edition.
///
/// This type, including its external executable paths, is omitted from the
/// Store binary. The sandboxed edition uses cloud providers and hosted MCP
/// connections and must remain self-contained for App Review.
public struct CodexRuntimeLocator {
    public let executableURL: URL?

    public init(fileManager: FileManager = .default, bundleURL: URL? = nil) {
        let bundled = bundleURL?.appendingPathComponent("Contents/Helpers/codex")
        let candidates = [
            bundled,
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/codex"),
            URL(fileURLWithPath: "/opt/homebrew/bin/codex"),
            URL(fileURLWithPath: "/usr/local/bin/codex"),
        ].compactMap { $0 }
        executableURL = candidates.first(where: { fileManager.isExecutableFile(atPath: $0.path) })
    }

    public var isAvailable: Bool { executableURL != nil }
}

#endif
