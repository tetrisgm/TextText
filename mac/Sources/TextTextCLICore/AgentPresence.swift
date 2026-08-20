import Foundation

/// Who is working, and on what.
///
/// Self-declared, exactly as MCP's `clientInfo` was. That is acceptable under
/// the trust model settled in docs/agent-interoperability.md: a same-user
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

    public static func validatedName(_ value: String?) -> String? {
        validated(value, maximumLength: 120)
    }

    public static func validatedIntent(_ value: String?) -> String? {
        validated(value, maximumLength: 500)
    }

    private static func validated(_ value: String?, maximumLength: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maximumLength else { return nil }
        let controls = CharacterSet.controlCharacters
        guard trimmed.unicodeScalars.allSatisfy({ !controls.contains($0) }) else {
            return nil
        }
        return trimmed
    }
}

/// The device credential the app already keeps, which is why the CLI needs no
/// token of its own, no port, and no pairing: it ships in the same bundle and
/// runs as the same user.
public struct DeviceCredentials: Decodable, Sendable {
    public let token: String
    public let serverOrigin: String

    public init(token: String, serverOrigin: String) {
        self.token = token
        self.serverOrigin = serverOrigin
    }

    /// The app may mint a device token for its configured HTTPS origin, while
    /// explicit development builds may use loopback HTTP. A corrupt state file
    /// must not turn the CLI into a bearer-token forwarder to an arbitrary
    /// plaintext host.
    public var validatedServerOrigin: URL? {
        guard token.hasPrefix("wsk_"),
            let url = URL(string: serverOrigin),
            let scheme = url.scheme?.lowercased(),
            let host = url.host?.lowercased(),
            url.user == nil, url.password == nil
        else { return nil }
        if scheme == "https" { return url }
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        return scheme == "http" && loopback ? url : nil
    }

    public static func load(
        fileManager: FileManager = .default,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> DeviceCredentials? {
        let path: URL
        if let override = environment["TEXTTEXT_CREDENTIALS_PATH"], !override.isEmpty {
            path = URL(fileURLWithPath: override)
        } else {
            path = fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent(
                    "Library/Application Support/TextText/credentials.json")
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

    public var isConfigured: Bool { credentials?.validatedServerOrigin != nil }

    /// Announce, run the work, then clear. The work runs even when presence
    /// cannot be published at all.
    public func around<T>(
        document: String,
        actor: AgentActor,
        work: () throws -> T
    ) rethrows -> T {
        publishSynchronously(document: document, actor: actor, active: true)
        defer { publishSynchronously(document: document, actor: actor, active: false) }
        return try work()
    }

    public func around<T>(
        document: String,
        actor: AgentActor,
        work: () async throws -> T
    ) async rethrows -> T {
        await publish(document: document, actor: actor, active: true)
        do {
            let value = try await work()
            await publish(document: document, actor: actor, active: false)
            return value
        } catch {
            await publish(document: document, actor: actor, active: false)
            throw error
        }
    }

    private func request(document: String, actor: AgentActor, active: Bool) -> URLRequest? {
        guard let credentials,
            let origin = credentials.validatedServerOrigin,
            let name = AgentActor.validatedName(actor.name)
        else { return nil }
        // The document carries its own id in frontmatter (`textTextId`, injected
        // locally and stripped before upload), so presence addresses the exact
        // item without the server having to resolve a file path.
        guard let itemId = actor.itemId else { return nil }
        let url = origin.appending(path: "api/agent/presence")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        var payload: [String: Any] = [
            "itemId": itemId,
            "document": document,
            "agent": name,
            "activity": actor.activity.rawValue,
            "active": active,
        ]
        if let section = actor.section { payload["section"] = section }
        if let message = AgentActor.validatedIntent(actor.message) {
            payload["message"] = message
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        return request
    }

    private func publish(document: String, actor: AgentActor, active: Bool) async {
        guard let request = request(document: document, actor: actor, active: active) else {
            return
        }
        _ = try? await session.data(for: request)
    }

    private func publishSynchronously(
        document: String, actor: AgentActor, active: Bool
    ) {
        guard let request = request(document: document, actor: actor, active: active) else {
            return
        }
        // Fire and wait briefly: presence must never outlive or delay the edit.
        let semaphore = DispatchSemaphore(value: 0)
        let task = session.dataTask(with: request) { _, _, _ in semaphore.signal() }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout)
    }
}
