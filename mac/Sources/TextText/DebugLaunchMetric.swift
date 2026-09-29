#if DEBUG
import Foundation
import os

/// Manual native launch benchmark. Release builds contain none of this code.
enum DebugLaunchMetric {
    private static let startedAt = ProcessInfo.processInfo.systemUptime
    private static let logger = Logger(subsystem: "app.texttext.mac", category: "launch-benchmark")
    private static var recordedUsable = false

    static var enabled: Bool {
        ProcessInfo.processInfo.environment["TEXTTEXT_LAUNCH_METRICS"] == "1"
    }

    static func begin() {
        guard enabled else { return }
        _ = startedAt
        logger.notice("benchmark-process-start pid=\(ProcessInfo.processInfo.processIdentifier, privacy: .public)")
    }

    static func mark(_ stage: String) {
        guard enabled else { return }
        let milliseconds = Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
        logger.notice("benchmark-\(stage, privacy: .public)-ms=\(milliseconds, privacy: .public)")
    }

    static func usable() {
        guard enabled, !recordedUsable else { return }
        recordedUsable = true
        let milliseconds = Int((ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
        logger.notice("benchmark-first-usable-ms=\(milliseconds, privacy: .public)")
    }
}
#endif
