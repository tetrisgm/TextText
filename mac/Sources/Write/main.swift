import AppKit

// Headless verify mode (CI/agents, and the seed of a future CLI): no UI at
// all, one real sync pass through the same engine the app uses, a one-line
// JSON summary on stdout, exit 0/1.
if ProcessInfo.processInfo.environment["WRITE_HEADLESS"] == "1" {
    NSApplication.shared.setActivationPolicy(.prohibited)
    exit(Headless.run())
}

// AppKit entry point (no @main so lifecycle control stays explicit).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
