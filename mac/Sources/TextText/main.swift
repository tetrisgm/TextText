import AppKit
import TextTextAppIntents

#if DEBUG
DebugLaunchMetric.begin()
#endif

// App Intents run in THIS process; give them server-backed workspace access so
// create/list/search/open/append/move go through the sync API (the source of
// truth), never by scanning or writing the File Provider mount. Registered
// before the run loop so it is always in place before any intent runs.
WorkspaceIntentServerRegistry.makeServer = { WorkspaceIntentServerFactory.make() }
NativeWorkspaceCommandRegistry.makeServer = {
    guard let credentials = StateStore().loadCredentials() else { return nil }
    return ServerClient(origin: resolveServerOrigin(credentials: credentials), token: credentials.token)
}
NativeWorkspaceCommandRegistry.openURL = { NSWorkspace.shared.open($0) }

#if TEXTTEXT_STRESS_ACTOR
// Six-client stress actor (mac-app role), compiled only with
// `-Xswiftc -DTEXTTEXT_STRESS_ACTOR`; see NativeStressRunner.swift. Product
// builds never contain this branch. Invoked by mac/scripts/stress-native.py as
// `TextText --stress <config.json> <session-dir>`; it runs the production
// LocalVaultWindowController instead of AppDelegate and never returns.
if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--stress" {
    NativeStressActor.run(arguments: CommandLine.arguments)
}
#endif

// App-owned release/runtime verification. This uses the same checks the
// installed app runs on first launch and each day, without creating UI.
if ProcessInfo.processInfo.environment["TEXTTEXT_HEALTH_CHECK"] == "1" {
    NSApplication.shared.setActivationPolicy(.prohibited)
    exit(AppHealthCLI.run())
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
