import Foundation
import TextTextWorkspaceCore

/// Owns the App Server child process. It is intentionally not detached and
/// has no daemon or launch-at-login behavior.
final class CodexAppServerController {
    typealias EventHandler = (CodexAppServerMessage) -> Void

    private let process: Process
    private let input: Pipe
    private let output: Pipe
    private var pending = Data()
    private(set) var isRunning = false
    var onEvent: EventHandler?

    init(executableURL: URL, environment: [String: String] = [:]) {
        process = Process()
        input = Pipe()
        output = Pipe()
        process.executableURL = executableURL
        process.arguments = ["app-server", "--stdio"]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        var safeEnvironment: [String: String] = [
            "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
            "TMPDIR": NSTemporaryDirectory(),
        ]
        for (key, value) in environment where key != "OPENAI_API_KEY" && key != "ANTHROPIC_API_KEY" {
            safeEnvironment[key] = value
        }
        process.environment = safeEnvironment
    }

    func start() throws {
        guard !isRunning else { return }
        try process.run()
        isRunning = true
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            self?.consume(handle.availableData)
        }
    }

    func stop() {
        output.fileHandleForReading.readabilityHandler = nil
        guard process.isRunning else {
            isRunning = false
            return
        }
        process.terminate()
        isRunning = false
    }

    func send(id: String, method: String, params: [String: Any]) throws {
        guard isRunning else { throw CodexAppServerError.notRunning }
        let object: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method, "params": params]
        let data = try JSONSerialization.data(withJSONObject: object)
        input.fileHandleForWriting.write(data)
        input.fileHandleForWriting.write(Data([0x0a]))
    }

    func notify(method: String, params: [String: Any] = [:]) throws {
        guard isRunning else { throw CodexAppServerError.notRunning }
        let object: [String: Any] = ["jsonrpc": "2.0", "method": method, "params": params]
        let data = try JSONSerialization.data(withJSONObject: object)
        input.fileHandleForWriting.write(data)
        input.fileHandleForWriting.write(Data([0x0a]))
    }

    func respond(id: String, result: [String: Any]) throws {
        guard isRunning else { throw CodexAppServerError.notRunning }
        let object: [String: Any] = ["jsonrpc": "2.0", "id": id, "result": result]
        let data = try JSONSerialization.data(withJSONObject: object)
        input.fileHandleForWriting.write(data)
        input.fileHandleForWriting.write(Data([0x0a]))
    }

    private func consume(_ data: Data) {
        guard !data.isEmpty else { return }
        pending.append(data)
        while let newline = pending.firstIndex(of: 0x0a) {
            let line = pending.prefix(upTo: newline)
            pending.removeSubrange(...newline)
            guard !line.isEmpty, let message = try? CodexAppServerMessage(data: Data(line)) else { continue }
            onEvent?(message)
        }
    }
}
