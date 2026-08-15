import Foundation

/// Talking to an MCP server running on this Mac.
///
/// The design tools worth connecting run locally: Paper listens on
/// 127.0.0.1:29979, pen.dev and Figma ship the same shape, and they sell it as
/// the feature, because the design file never leaves the machine. TextText's
/// hosted assistant cannot reach any of them: a server in a data centre
/// fetching 127.0.0.1 reaches its own container. So the call has to originate
/// here.
///
/// It cannot originate in the web view either. The page is served over https in
/// production, and an https page fetching http://127.0.0.1 is mixed content,
/// which WKWebView blocks. Swift has no such rule, so the web view asks and this
/// makes the request.
///
/// That makes this a deliberate hole in the app's network posture, and it is
/// bounded to exactly what it is for:
///
///   - loopback only, checked after resolution, so "localhost" cannot be
///     pointed at somebody else's machine by a DNS entry;
///   - POST only, to a path, with a bounded body and a short timeout;
///   - no cookies and no credential storage, so an ambient session cannot be
///     borrowed;
///   - responses capped, because the reply becomes model context.
enum LocalMcpBridge {
    /// The loopback addresses we will speak to. Anything else is refused
    /// whatever the hostname claimed.
    private static let allowedHosts: Set<String> = ["127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]
    private static let maxResponseBytes = 2_000_000
    private static let timeout: TimeInterval = 30

    struct Failure: Error {
        let message: String
    }

    /// A URLSession that keeps nothing: no cookies, no cache, no credentials.
    /// A local server should never see a session this app happens to hold.
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = timeout
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    /// Refuse anything that is not loopback, resolving the host first so a name
    /// cannot stand in for an address.
    static func loopbackURL(from raw: String) -> URL? {
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host?.lowercased()
        else { return nil }

        if allowedHosts.contains(host) { return url }
        guard host == "localhost" || host.hasSuffix(".localhost") else { return nil }

        // "localhost" is conventionally loopback, not guaranteed to be. Resolve
        // it and require every answer to be loopback before we believe it.
        var hints = addrinfo(
            ai_flags: 0,
            ai_family: AF_UNSPEC,
            ai_socktype: SOCK_STREAM,
            ai_protocol: 0,
            ai_addrlen: 0,
            ai_canonname: nil,
            ai_addr: nil,
            ai_next: nil
        )
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let head = result else {
            return nil
        }
        defer { freeaddrinfo(head) }

        var node: UnsafeMutablePointer<addrinfo>? = head
        var sawAddress = false
        while let current = node {
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(
                current.pointee.ai_addr,
                socklen_t(current.pointee.ai_addrlen),
                &buffer,
                socklen_t(buffer.count),
                nil,
                0,
                NI_NUMERICHOST
            ) == 0 {
                let address = String(cString: buffer).lowercased()
                // Strip a scope id such as %lo0 before comparing.
                let bare = address.split(separator: "%").first.map(String.init) ?? address
                if !allowedHosts.contains(bare) { return nil }
                sawAddress = true
            }
            node = current.pointee.ai_next
        }
        return sawAddress ? url : nil
    }

    /// One JSON-RPC request to a local MCP server. Returns the raw JSON text so
    /// the web view can parse it with the same code it uses for hosted servers.
    static func send(
        urlString: String,
        body: [String: Any],
        token: String?,
        headers: [String: String],
        completion: @escaping (Result<String, Failure>) -> Void
    ) {
        guard let url = loopbackURL(from: urlString) else {
            completion(.failure(Failure(message: "That address is not on this Mac.")))
            return
        }
        guard let payload = try? JSONSerialization.data(withJSONObject: body) else {
            completion(.failure(Failure(message: "That request could not be encoded.")))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = payload
        request.timeoutInterval = timeout
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(Failure(message: "That server did not answer: \(error.localizedDescription)")))
                return
            }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                completion(.failure(Failure(message: "That server returned HTTP \(http.statusCode).")))
                return
            }
            guard let data else {
                completion(.failure(Failure(message: "That server sent an empty reply.")))
                return
            }
            if data.count > maxResponseBytes {
                completion(.failure(Failure(message: "That server sent too large a reply.")))
                return
            }
            guard let text = String(data: data, encoding: .utf8) else {
                completion(.failure(Failure(message: "That server sent a reply we could not read.")))
                return
            }
            completion(.success(text))
        }.resume()
    }
}
