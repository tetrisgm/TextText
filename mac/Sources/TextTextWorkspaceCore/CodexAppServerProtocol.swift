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
        if let error = dictionary["error"] as? [String: Any],
           let message = error["message"] as? String {
            errorMessage = message
        } else {
            errorMessage = nil
        }
    }
}

public enum CodexAppServerError: Error, Equatable {
    case invalidMessage
    case runtimeMissing
    case processExited(Int32)
    case notRunning
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
