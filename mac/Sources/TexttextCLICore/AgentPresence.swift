import Foundation

/// Who is working, and on what.
///
/// Self-declared, exactly as MCP's `clientInfo` was. That is acceptable under
/// the trust model settled in docs/decision-local-mcp-trust.md: a same-user
/// process is trusted, and the case that mattered (a web page reaching the
/// local endpoint) was closed in 0.143.
public struct AgentActor: Equatable, Sendable {
    public let name: String
    public let activity: Activity
    public let section: String?
    public let message: String?
    /// The document's own id, read from its frontmatter.
    public let itemId: String?

    public enum Activity: String, Sendable {
        case open
        case edit
    }

    public init(
        name: String, activity: Activity, section: String? = nil,
        message: String? = nil, itemId: String? = nil
    ) {
        self.name = name
        self.activity = activity
        self.section = section
        self.message = message
        self.itemId = itemId
    }
}

/// The device credential the app already keeps, which is why the CLI needs no
/// token of its own, no port, and no pairing: it ships in the same bundle and
/// runs as the same user.
public struct DeviceCredentials: Decodable, Sendable {
    public let token: String
    public let serverOrigin: String

    public static func load(
        fileManager: FileManager = .default,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> DeviceCredentials? {
        let path: URL
        if let override = environment["WRITE_CREDENTIALS_PATH"], !override.isEmpty {
            path = URL(fileURLWithPath: override)
        } else {
            path = fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent(
                    "Library/Application Support/Write/credentials.json")
        }
        guard let data = try? Data(contentsOf: path) else { return nil }
        return try? JSONDecoder().decode(DeviceCredentials.self, from: data)
    }
}

/// Publishes "this agent is working here" to the workspace.
///
/// Presence is published by the CLI itself rather than requested by the agent,
/// because the CLI already knows what it is doing. An agent cannot forget to
/// announce itself, which is exactly what a tool surface requiring an explicit
/// signal could never guarantee.
///
/// Presence is decoration. Every failure is swallowed so a content change still
/// lands when presence reporting is unavailable.
public struct PresencePublisher: Sendable {
    private let credentials: DeviceCredentials?
    private let session: URLSession
    private let timeout: TimeInterval

    public init(
        credentials: DeviceCredentials? = DeviceCredentials.load(),
        session: URLSession = .shared,
        timeout: TimeInterval = 3
    ) {
        self.credentials = credentials
        self.session = session
        self.timeout = timeout
    }

    public var isConfigured: Bool { credentials != nil }

    /// Announce, run the work, then clear. The work runs even when presence
    /// cannot be published at all.
    public func around<T>(
        document: String,
        actor: AgentActor,
        work: () throws -> T
    ) rethrows -> T {
        publish(document: document, actor: actor, active: true)
        defer { publish(document: document, actor: actor, active: false) }
        return try work()
    }

    private func publish(document: String, actor: AgentActor, active: Bool) {
        guard let credentials else { return }
        // The document carries its own id in frontmatter (`writeId`, injected
        // locally and stripped before upload), so presence addresses the exact
        // item without the server having to resolve a file path.
        guard let itemId = actor.itemId else { return }
        guard let url = URL(string: credentials.serverOrigin + "/api/agent/presence")
        else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        var payload: [String: Any] = [
            "itemId": itemId,
            "document": document,
            "agent": actor.name,
            "activity": actor.activity.rawValue,
            "active": active,
        ]
        if let section = actor.section { payload["section"] = section }
        if let message = actor.message { payload["message"] = message }
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        // Fire and wait briefly: presence must never outlive or delay the edit.
        let semaphore = DispatchSemaphore(value: 0)
        let task = session.dataTask(with: request) { _, _, _ in semaphore.signal() }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout)
    }
}
