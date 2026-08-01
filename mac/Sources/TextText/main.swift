import AppKit
import TextTextAppIntents

// App Intents run in THIS process; give them server-backed workspace access so
// create/list/search/open/append/move go through the sync API (the source of
// truth), never by scanning or writing the File Provider mount. Registered
// before the run loop so it is always in place before any intent runs.
WorkspaceIntentServerRegistry.makeServer = { WorkspaceIntentServerFactory.make() }

// App-owned release/runtime verification. This uses the same checks the
// installed app runs on first launch and each day, without creating UI.
if ProcessInfo.processInfo.environment["TEXTTEXT_HEALTH_CHECK"] == "1" {
    NSApplication.shared.setActivationPolicy(.prohibited)
    exit(AppHealthCLI.run())
}

// Headless verify mode (CI/agents, and the seed of a future CLI): no UI at
// all, one real sync pass through the same engine the app uses, a one-line
// JSON summary on stdout, exit 0/1.
if ProcessInfo.processInfo.environment["TEXTTEXT_HEADLESS"] == "1" {
    NSApplication.shared.setActivationPolicy(.prohibited)
    exit(Headless.run())
}

// AppKit entry point (no @main so lifecycle control stays explicit).
let app = NSApplication.shared
// SwiftPM executables do not get the application activation policy that an
// Xcode app target normally establishes for us. Without this, AppKit creates
// the window but orders it beneath the active app, which looks like a launch
// with no window.
_ = app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
