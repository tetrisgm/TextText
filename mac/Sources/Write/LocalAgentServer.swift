import Foundation
import Network
import WebKit

struct LocalAgentHTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    static func parse(_ data: Data) -> LocalAgentHTTPRequest? {
        let marker = Data("\r\n\r\n".utf8)
        guard let split = data.range(of: marker),
              let head = String(data: data[..<split.lowerBound], encoding: .utf8)
        else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard parts.count == 3 else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let key = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }
        let bodyStart = split.upperBound
        let body = Data(data[bodyStart...])
        let expected = Int(headers["content-length"] ?? "0") ?? 0
        guard body.count >= expected else { return nil }
        return LocalAgentHTTPRequest(
            method: parts[0],
            path: parts[1],
            headers: headers,
            body: Data(body.prefix(expected)))
    }

    var isLoopbackHost: Bool {
        guard let host = headers["host"]?.lowercased() else { return false }
        return host == "127.0.0.1:\(LocalAgentServer.port)"
            || host == "localhost:\(LocalAgentServer.port)"
            || host == "[::1]:\(LocalAgentServer.port)"
    }
}

struct LocalAgentHTTPResponse {
    let status: Int
    let reason: String
    let contentType: String
    let body: Data

    func encoded() -> Data {
        let head = [
            "HTTP/1.1 \(status) \(reason)",
            "Content-Type: \(contentType)",
            "Content-Length: \(body.count)",
            "Cache-Control: no-store",
            "Connection: close",
            "",
            "",
        ].joined(separator: "\r\n")
        var data = Data(head.utf8)
        data.append(body)
        return data
    }

    static func json(status: Int = 200, reason: String = "OK", _ value: Any)
        -> LocalAgentHTTPResponse
    {
        let body = (try? JSONSerialization.data(withJSONObject: value)) ?? Data()
        return LocalAgentHTTPResponse(
            status: status,
            reason: reason,
            contentType: "application/json",
            body: body)
    }
}

@MainActor
final class LocalAgentServer {
    nonisolated static let port: UInt16 = 47_118
    nonisolated static let endpoint = "http://127.0.0.1:\(port)/mcp"

    weak var webView: WKWebView?
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "app.texttext.local-agent")

    func start() {
        guard listener == nil else { return }
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(
            host: "127.0.0.1",
            port: NWEndpoint.Port(rawValue: Self.port)!)
        do {
            let listener = try NWListener(using: parameters)
            listener.newConnectionHandler = { [weak self] connection in
                Task { @MainActor in
                    self?.accept(connection)
                }
            }
            listener.stateUpdateHandler = { state in
                if case .failed(let error) = state {
                    NSLog("Texttext local MCP failed: \(error)")
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            NSLog("Texttext could not start local MCP: \(error)")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    deinit {
        listener?.cancel()
    }

    private func accept(_ connection: NWConnection) {
        let queue = queue
        connection.start(queue: queue)
        Self.receive(connection, data: Data(), queue: queue) { [weak self] request in
            guard let self else {
                return .json(
                    status: 503, reason: "Service Unavailable",
                    ["error": "Texttext is closing"])
            }
            return await self.respond(to: request)
        }
    }

    private nonisolated static func receive(
        _ connection: NWConnection,
        data: Data,
        queue: DispatchQueue,
        respond: @escaping @Sendable (LocalAgentHTTPRequest) async -> LocalAgentHTTPResponse
    ) {
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: 1_048_576
        ) { chunk, _, isComplete, error in
            var accumulated = data
            if let chunk { accumulated.append(chunk) }
            if let request = LocalAgentHTTPRequest.parse(accumulated) {
                Task {
                    let response = await respond(request)
                    connection.send(
                        content: response.encoded(),
                        completion: .contentProcessed { _ in connection.cancel() })
                }
                return
            }
            if error != nil || isComplete || accumulated.count >= 1_048_576 {
                connection.cancel()
                return
            }
            receive(
                connection,
                data: accumulated,
                queue: queue,
                respond: respond)
        }
    }

    func respond(to request: LocalAgentHTTPRequest) async -> LocalAgentHTTPResponse {
        guard request.isLoopbackHost else {
            return .json(
                status: 403, reason: "Forbidden",
                ["error": "Local access only"])
        }
        if request.method == "GET", request.path == "/health" {
            return .json(["ok": true, "service": "texttext-local-mcp"])
        }
        guard request.method == "POST", request.path == "/mcp" else {
            return .json(
                status: 404, reason: "Not Found",
                ["error": "Not found"])
        }
        guard let message = try? JSONSerialization.jsonObject(with: request.body)
            as? [String: Any],
              let method = message["method"] as? String
        else {
            return rpcError(id: NSNull(), code: -32_700, message: "Parse error")
        }
        let id = message["id"] ?? NSNull()

        switch method {
        case "initialize":
            return rpcResult(id: id, result: [
                "protocolVersion": "2025-06-18",
                "capabilities": ["tools": ["listChanged": false]],
                "serverInfo": ["name": "Texttext for Mac", "version": "1"],
            ])
        case "notifications/initialized":
            return LocalAgentHTTPResponse(
                status: 202, reason: "Accepted",
                contentType: "application/json", body: Data())
        case "ping":
            return rpcResult(id: id, result: [:])
        case "tools/list":
            do {
                let manifest = try await pageManifest()
                return rpcResult(id: id, result: [
                    "tools": manifest["tools"] as? [Any] ?? [],
                ])
            } catch {
                return rpcError(id: id, code: -32_603, message: error.localizedDescription)
            }
        case "tools/call":
            let params = message["params"] as? [String: Any] ?? [:]
            guard let name = params["name"] as? String else {
                return rpcError(id: id, code: -32_602, message: "Missing tool name")
            }
            let arguments = params["arguments"] as? [String: Any] ?? [:]
            do {
                let value = try await pageCall(name: name, arguments: arguments)
                let textData = try JSONSerialization.data(
                    withJSONObject: value, options: [.sortedKeys])
                let text = String(decoding: textData, as: UTF8.self)
                return rpcResult(id: id, result: [
                    "content": [["type": "text", "text": text]],
                    "structuredContent": value,
                    "isError": false,
                ])
            } catch {
                return rpcResult(id: id, result: [
                    "content": [[
                        "type": "text",
                        "text": error.localizedDescription,
                    ]],
                    "isError": true,
                ])
            }
        default:
            return rpcError(id: id, code: -32_601, message: "Method not found")
        }
    }

    private func pageManifest() async throws -> [String: Any] {
        let result = try await evaluate("""
        return window.__TEXTTEXT_AGENT_BRIDGE__
          ? window.__TEXTTEXT_AGENT_BRIDGE__.manifest()
          : Promise.reject(new Error("Open a Texttext workspace first"));
        """, arguments: [:])
        guard let manifest = result as? [String: Any] else {
            throw LocalAgentError(message: "The workspace returned an invalid manifest")
        }
        return manifest
    }

    private func pageCall(name: String, arguments: [String: Any]) async throws -> Any {
        let result = try await evaluate("""
        if (!window.__TEXTTEXT_AGENT_BRIDGE__) {
          throw new Error("Open a Texttext workspace first");
        }
        return await window.__TEXTTEXT_AGENT_BRIDGE__.call(name, args);
        """, arguments: ["name": name, "args": arguments])
        return result ?? NSNull()
    }

    private func evaluate(_ script: String, arguments: [String: Any]) async throws -> Any? {
        guard let webView else {
            throw LocalAgentError(message: "Open a Texttext workspace first")
        }
        return try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Any, Error>) in
            webView.callAsyncJavaScript(
                script,
                arguments: arguments,
                in: nil,
                in: .page
            ) { result in
                continuation.resume(with: result)
            }
        }
    }

    private func rpcResult(id: Any, result: Any) -> LocalAgentHTTPResponse {
        .json(["jsonrpc": "2.0", "id": id, "result": result])
    }

    private func rpcError(id: Any, code: Int, message: String)
        -> LocalAgentHTTPResponse
    {
        .json([
            "jsonrpc": "2.0",
            "id": id,
            "error": ["code": code, "message": message],
        ])
    }
}

private struct LocalAgentError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
