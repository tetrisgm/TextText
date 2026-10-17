import Foundation
import Darwin
import TextTextFileProviderKit

/// Test-only source evaluator. Application products never depend on this target.
public func makeTestSync(root: URL, binding: LocalVaultSyncBinding, transport: any LocalVaultSyncTransport, accountId: String? = nil) throws -> LocalVaultSync {
    try LocalVaultSync(root: root, binding: binding, transport: transport, accountId: accountId,
        mirrorPolicy: makeTestMirrorPolicy(workspaceId: binding.workspaceId, accountId: accountId))
}

public func makeTestMirrorPolicy(workspaceId: String, accountId: String? = nil) -> LocalVaultMirrorPolicy {
    let context = UUID().uuidString
    return LocalVaultMirrorPolicy(digest: String(repeating: "f", count: 64),
        scope: LocalVaultMirrorScope(accountId: accountId ?? "fixture-account", workspaceId: workspaceId, lifecycle: context)) { script in
            try await NativePolicyTestHost.shared.evaluate(context: context, script: script)
        }
}

private actor NativePolicyTestHost {
    static let shared = NativePolicyTestHost()
    private var child: Process?, input: FileHandle?, output: FileHandle?
    private var buffered = Data()
    private var failed = false
    private func wait(_ fd: Int32, events: Int16, until deadline: UInt64) throws {
        try Task.checkCancellation()
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < deadline else { throw LocalVaultMirrorPolicy.Failure.timeout }
        var descriptor = pollfd(fd: fd, events: events, revents: 0)
        let result = poll(&descriptor, 1, Int32(min((deadline - now) / 1_000_000 + 1, 4000)))
        guard result > 0, descriptor.revents & events != 0 else { throw CocoaError(.fileReadUnknown) }
    }
    private func fail() {
        failed = true
        if let child, child.isRunning { kill(child.processIdentifier, SIGKILL) }
        try? input?.close(); try? output?.close()
    }
    func evaluate(context: String, script: String) throws -> String {
        guard !failed else { throw CocoaError(.fileReadUnknown) }
        do {
        if child == nil {
            var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            while root.path != "/" && !FileManager.default.fileExists(atPath: root.appendingPathComponent("sync/native-policy-test-host.mjs").path) { root.deleteLastPathComponent() }
            guard root.path != "/" else { throw CocoaError(.fileNoSuchFile) }
            let process = Process(), incoming = Pipe(), outgoing = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", "--import", "tsx", "sync/native-policy-test-host.mjs"]
            process.currentDirectoryURL = root
            process.environment = ["PATH": ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin", "TMPDIR": NSTemporaryDirectory()]
            process.standardInput = incoming; process.standardOutput = outgoing
            try process.run(); child = process; input = incoming.fileHandleForWriting; output = outgoing.fileHandleForReading
            for handle in [incoming.fileHandleForWriting, outgoing.fileHandleForReading] {
                guard fcntl(handle.fileDescriptor, F_SETFL, O_NONBLOCK) != -1 else { throw CocoaError(.fileReadUnknown) }
            }
            // A dead child must report an error instead of terminating the test runner.
            _ = fcntl(incoming.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
        }
        guard let input, let output else { throw CocoaError(.fileReadUnknown) }
        let request = try JSONSerialization.data(withJSONObject: ["context": context, "script": script]) + Data([10])
        guard request.count <= 20000 else { throw CocoaError(.fileWriteUnknown) }
        let deadline = DispatchTime.now().uptimeNanoseconds + 4_000_000_000
        try request.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                try wait(input.fileDescriptor, events: Int16(POLLOUT), until: deadline)
                let count = Darwin.write(input.fileDescriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count == -1 && (errno == EAGAIN || errno == EINTR) { continue }
                guard count > 0 else { throw CocoaError(.fileWriteUnknown) }
                offset += count
            }
        }
        while !buffered.contains(10) {
            try wait(output.fileDescriptor, events: Int16(POLLIN), until: deadline)
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = Darwin.read(output.fileDescriptor, &bytes, bytes.count)
            if count == -1 && (errno == EAGAIN || errno == EINTR) { continue }
            guard count > 0, buffered.count + count < 32768 else { throw CocoaError(.fileReadCorruptFile) }
            buffered.append(contentsOf: bytes.prefix(count))
        }
        let end = buffered.firstIndex(of: 10)!
        let line = buffered.prefix(upTo: end); buffered.removeSubrange(...end)
        guard let reply = try JSONSerialization.jsonObject(with: line) as? [String: Any], reply["ok"] as? Bool == true,
              let result = reply["result"] as? String else { throw CocoaError(.fileReadCorruptFile) }
        return result
        } catch { fail(); throw error }
    }
}
