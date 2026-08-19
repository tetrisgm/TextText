import Foundation

/// The small JSON-RPC boundary used by the embedded TextText agent.
///
/// App Server is deliberately kept behind this type. The web view receives
/// status and streamed events, never the account token or process environment.
public struct CodexAppServerMessage: Equatable {
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
        id = dictionary["id"].map { String(describing: $0) }
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
        lhs.id == rhs.id && lhs.method == rhs.method && lhs.errorMessage == rhs.errorMessage
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

/// Current App Server request shapes used by the native assistant. Keeping
/// these at the protocol boundary makes silent schema drift testable. In
/// particular, App Server ignores the old `sandboxPolicy` field and falls back
/// to workspace-write, while `sandbox: "read-only"` produces a read-only
/// thread.
public enum CodexAppServerRequests {
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
        disabledMCPServers: [String]
    ) -> [String: Any] {
        let disabledServers = Dictionary(uniqueKeysWithValues:
            Set(disabledMCPServers).sorted().map { ($0, ["enabled": false]) })
        var params: [String: Any] = [
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "ephemeral": true,
            "dynamicTools": dynamicTools,
        ]
        params["config"] = ["mcp_servers": disabledServers]
        return params
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
}

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
