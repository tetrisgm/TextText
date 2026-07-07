import AppKit
import ServiceManagement

/// Regular Dock app + a menu-bar status item (menu rebuilt on open, the
/// partyparty shape; SwiftUI MenuBarExtra is deliberately avoided). The app
/// is never walled behind sign-in: the local folder opens and edits fine
/// signed out; only sync waits for a link.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static let syncRootKey = "WriteSyncRootPath"
    private static let loginItemAppliedKey = "WriteLoginItemDefaultApplied"

    private let store = StateStore()
    private var engine: SyncEngine!
    private var changeListener: ChangeListener!
    private var captureAgent: CaptureAgent!
    private var linkController: LinkController!
    private var updater: Updater?          // created AFTER the move check; Sparkle must
                                           // never download into a translocated/Downloads copy
    private var statusItem: NSStatusItem!
    private var statusWindow: StatusWindowController?
    private var webWindow: WebAppWindowController?
    private var activityLog: [String] = []
    private var wasBusy = false

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Before ANYTHING: offer to relocate to /Applications. Running from
        // ~/Downloads breaks Sparkle updates and triggers Gatekeeper
        // app-translocation; one click here fixes both (the LetsMove pattern).
        if moveToApplicationsIfNeeded() { return } // relaunching from the new home

        // Only when the build carries a real feed + key; otherwise the
        // updater stays dormant and invisible (no Sparkle, no launch alert).
        if Updater.isConfigured {
            updater = Updater(isBusy: { [weak self] in self?.engine?.isSyncing ?? false })
        }
        registerLoginItemByDefault()
        NSApp.mainMenu = buildMainMenu()

        linkController = LinkController(store: store)
        engine = SyncEngine(store: store)
        engine.makeClient = { [weak self] in
            guard let self, let credentials = self.store.loadCredentials() else { return nil }
            return ServerClient(origin: resolveServerOrigin(credentials: credentials),
                                token: credentials.token)
        }
        engine.syncRootProvider = { [weak self] in self?.syncRoot() ?? Self.defaultSyncRoot() }
        engine.onActivity = { [weak self] message in self?.appendActivity(message) }
        engine.onStateChange = { [weak self] in self?.syncStateChanged() }
        engine.onServerAppVersion = { [weak self] version in self?.serverAdvertisedAppVersion(version) }

        linkController.onChange = { [weak self] in self?.refreshUI() }
        linkController.onActivity = { [weak self] message in self?.appendActivity(message) }
        linkController.onLinked = { [weak self] _ in
            guard let self else { return }
            self.engine.syncNow()
            self.refreshUI()
            // Linking configures folder sync; bring the workspace forward.
            NSApp.activate(ignoringOtherApps: true)
            self.showMainWindow()
        }

        setupStatusItem()
        engine.start()

        // Near-instant remote sync: a change on the web (edit, delete, new
        // bookmark) triggers a pass within seconds; the engine's 60s timer
        // stays as the fallback. The capture agent rides the same signal.
        captureAgent = CaptureAgent(store: store)
        captureAgent.onActivity = { [weak self] message in self?.appendActivity(message) }
        changeListener = ChangeListener(store: store)
        changeListener.onRemoteChange = { [weak self] in
            self?.engine.syncNow()
            self?.captureAgent.poke()
        }
        changeListener.start()
        captureAgent.start()

        showMainWindow() // open the workspace window on launch
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        let unhandled = OpenFileHandler.open(urls: urls, store: store, syncRoot: syncRoot())
        if !unhandled.isEmpty {
            appendActivity("Could not open \(unhandled.count) file(s): not in the Write folder")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMainWindow() }
        return true
    }

    // Foreground check, throttled to one per 5 minutes (the partyparty rule).
    private var lastForegroundCheck = Date.distantPast
    func applicationDidBecomeActive(_ notification: Notification) {
        guard Date().timeIntervalSince(lastForegroundCheck) > 300 else { return }
        lastForegroundCheck = Date()
        updater?.checkNow()
    }

    // Push channel: the server advertises its latest app build; when it is
    // STRICTLY newer component-wise, trigger a background check, throttled to
    // one per 120s so a rolled-back marker cannot hammer the feed.
    private var lastPushCheck = Date.distantPast
    private func serverAdvertisedAppVersion(_ version: String) {
        guard versionNewer(version, appVersion) else { return }
        guard Date().timeIntervalSince(lastPushCheck) > 120 else { return }
        lastPushCheck = Date()
        updater?.checkNow()
    }

    private func syncStateChanged() {
        let busy = engine.isSyncing
        // An update Sparkle offered mid-pass was deferred; the moment the
        // engine goes idle, let it surface.
        if wasBusy && !busy { updater?.busyDidEnd() }
        wasBusy = busy
        refreshUI()
    }

    // MARK: Sync root

    static func defaultSyncRoot() -> URL {
        // ~/Write, never Desktop/Documents/Downloads: those are TCC-gated
        // folders and would prompt; the home root is not.
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Write", isDirectory: true)
    }

    private func syncRoot() -> URL {
        if let path = UserDefaults.standard.string(forKey: Self.syncRootKey), !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return Self.defaultSyncRoot()
    }

    private func changeSyncFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = syncRoot()
        panel.message = "Choose the folder \(appName) keeps in sync"
        panel.prompt = "Use This Folder"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        UserDefaults.standard.set(url.path, forKey: Self.syncRootKey)
        appendActivity("Sync folder is now \(url.path)")
        engine.resetForNewRoot()
        refreshUI()
    }

    // MARK: Account

    private func signIn() {
        // A pending code means a live approval page: reopen THAT page rather
        // than minting a second code the first tab could wrongly approve.
        if case .waiting = linkController.state {
            linkController.reopenApproval()
            return
        }
        guard !linkController.isLinking else { return }
        linkController.begin(serverOrigin: resolveServerOrigin(credentials: nil))
    }

    private func signOut() {
        // Local-only by design: the server-side revoke route may not exist
        // yet; degrade gracefully. The folder and its files stay put.
        store.deleteCredentials()
        engine.resetForSignOut()
        appendActivity("Signed out; local files kept")
        refreshUI()
    }

    // MARK: Self-install (move to /Applications), copied from partyparty

    /// True when running from /Applications or ~/Applications: an INSTALLED
    /// copy, as opposed to ~/Downloads (or a ~/Downloads/Applications decoy).
    private var isInstalled: Bool {
        let path = Bundle.main.bundleURL.path
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return path.hasPrefix("/Applications/") || path.hasPrefix(home + "/Applications/")
    }

    /// Returns true when a move+relaunch is underway and this instance should
    /// do nothing further. `interactive` = invoked from a menu action (always
    /// prompt); otherwise it is the launch check (skippable only in dev).
    @discardableResult
    private func moveToApplicationsIfNeeded(interactive: Bool = false) -> Bool {
        let src = Bundle.main.bundleURL
        if isInstalled { return false }
        // Dev escape hatch is an ENV var only, never a persisted default,
        // which would stick on a real install and silently defeat the move.
        if !interactive && ProcessInfo.processInfo.environment["WRITE_DEV_NO_MOVE"] == "1" { return false }
        // `swift run` from the checkout has no .app bundle to move.
        if !src.path.hasSuffix(".app") { return false }

        let fm = FileManager.default
        var destDir = URL(fileURLWithPath: "/Applications", isDirectory: true)
        if !fm.isWritableFile(atPath: destDir.path) {
            // Non-admin account: fall back to the per-user Applications folder.
            destDir = fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
            try? fm.createDirectory(at: destDir, withIntermediateDirectories: true)
        }
        let dest = destDir.appendingPathComponent(src.lastPathComponent)

        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Move \(appName) to the Applications folder?"
        alert.informativeText = "It will relaunch from there. Updates and permissions work best that way; takes a second, nothing to drag."
        alert.addButton(withTitle: "Move to Applications")
        alert.addButton(withTitle: "Not Now")
        guard alert.runModal() == .alertFirstButtonReturn else { return false }

        do {
            if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
            try fm.copyItem(at: src, to: dest) // COPY works even from a translocated read-only mount
            // Strip quarantine on the new copy: the user already approved the
            // Gatekeeper first-open, and without this a programmatic move
            // (unlike a Finder drag) would still be app-translocated.
            let xattr = Process()
            xattr.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
            xattr.arguments = ["-dr", "com.apple.quarantine", dest.path]
            try? xattr.run()
            xattr.waitUntilExit()

            let cfg = NSWorkspace.OpenConfiguration()
            cfg.createsNewApplicationInstance = true
            NSWorkspace.shared.openApplication(at: dest, configuration: cfg) { app, err in
                DispatchQueue.main.async {
                    // Only hand over if the new copy actually launched;
                    // terminating blindly could leave the user with NOTHING.
                    if app != nil { NSApp.terminate(nil); return }
                    let e = NSAlert()
                    e.messageText = "Couldn't relaunch from Applications"
                    e.informativeText = (err?.localizedDescription ?? "Unknown error")
                        + "\n\nThe copy IS in Applications; open it from there when you're ready."
                    e.runModal()
                    NSApp.terminate(nil) // this instance did no setup; don't linger half-alive
                }
            }
            return true
        } catch {
            let e = NSAlert()
            e.messageText = "Couldn't move \(appName)"
            e.informativeText = "\(error.localizedDescription)\n\nYou can drag it to Applications yourself; it keeps working from here meanwhile."
            e.runModal()
            return false
        }
    }

    // MARK: Login item

    /// A sync agent should just BE there after a restart: enroll
    /// start-at-login once, by default (no password, no dialog; it shows in
    /// System Settings > General > Login Items). The menu toggle is the
    /// opt-out, and because this runs only once, off STAYS off.
    private func registerLoginItemByDefault() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.loginItemAppliedKey) else { return }
        // Only from an installed home; a dev build in ~/dev must not enroll.
        guard isInstalled else { return }
        if SMAppService.mainApp.status == .enabled {
            defaults.set(true, forKey: Self.loginItemAppliedKey)
            return
        }
        do {
            try SMAppService.mainApp.register()
            defaults.set(true, forKey: Self.loginItemAppliedKey) // only after SUCCESS,
            // so a transient failure retries next launch instead of losing the default
        } catch {
            NSLog("Write: login-item default enroll failed (will retry next launch): \(error)")
        }
    }

    private var loginItemEnabled: Bool { SMAppService.mainApp.status == .enabled }

    @objc private func toggleLoginItem() {
        do {
            if loginItemEnabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            appendActivity("Login item change failed: \(error.localizedDescription)")
        }
        UserDefaults.standard.set(true, forKey: Self.loginItemAppliedKey) // an explicit choice sticks
    }

    // MARK: Status item + menu

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            if let image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: appName) {
                image.isTemplate = true
                button.image = image
            } else {
                button.title = "W"
            }
            button.toolTip = appName
        }
        let menu = NSMenu()
        menu.delegate = self // rebuilt on open so state is fresh
        statusItem.menu = menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        let header = NSMenuItem(title: "\(linkHeadline())  ·  v\(appVersion)", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)

        if case .waiting(let code, _, _) = linkController.state {
            let codeItem = NSMenuItem(title: "Code: \(code) (confirm in your browser)", action: nil, keyEquivalent: "")
            codeItem.isEnabled = false
            menu.addItem(codeItem)
            menu.addItem(item("Open Approval Page", #selector(reopenApprovalAction)))
        }
        if case .failed = linkController.state {
            menu.addItem(item("Try Linking Again", #selector(signInAction)))
        }

        let last = NSMenuItem(title: lastSyncLine(), action: nil, keyEquivalent: "")
        last.isEnabled = false
        menu.addItem(last)
        menu.addItem(.separator())

        // The primary action: the full workspace in a native window.
        let openWrite = item("Open Write", #selector(showMainWindowAction))
        menu.addItem(openWrite)
        menu.addItem(.separator())

        let sync = item("Sync Now", #selector(syncNowAction))
        sync.isEnabled = store.loadCredentials() != nil && !engine.isSyncing
        menu.addItem(sync)
        menu.addItem(item("Open Folder", #selector(openFolderAction)))
        if let blog = store.cachedWorkspace()?.blog {
            menu.addItem(item("Open \(blog.name.isEmpty ? "Blog" : blog.name) in browser", #selector(openBlogAction)))
        }
        menu.addItem(item("Sync & settings…", #selector(showStatusWindowAction)))
        menu.addItem(.separator())

        let login = item("Start \(appName) at Login", #selector(toggleLoginItem))
        login.state = loginItemEnabled ? .on : .off
        menu.addItem(login)
        // Dev builds carry no update config; the item would only apologize.
        if updater != nil {
            menu.addItem(item("Check for Updates…", #selector(checkUpdates)))
        }
        menu.addItem(.separator())
        menu.addItem(item("Quit \(appName)", #selector(quit)))
    }

    private func item(_ title: String, _ selector: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        i.target = self
        return i
    }

    private func linkHeadline() -> String {
        if store.loadCredentials() != nil {
            if let blog = store.cachedWorkspace()?.blog, !blog.name.isEmpty {
                return "Linked as \(blog.name)"
            }
            return "Linked"
        }
        switch linkController.state {
        case .starting, .waiting: return "Linking…"
        default: return "Not linked"
        }
    }

    private func lastSyncLine() -> String {
        if engine.isSyncing { return "Syncing now…" }
        guard let at = engine.lastSyncAt else { return "Not synced yet" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        var line = "Last sync \(formatter.localizedString(for: at, relativeTo: Date()))"
        if let s = engine.lastSummary, s.errors > 0 { line += " (\(s.errors) errors)" }
        return line
    }

    // MARK: Menu actions

    @objc private func syncNowAction() { engine.syncNow() }

    @objc private func openFolderAction() {
        let root = syncRoot()
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        NSWorkspace.shared.open(root)
    }

    @objc private func openBlogAction() {
        guard let blog = store.cachedWorkspace()?.blog else { return }
        let origin = resolveServerOrigin(credentials: store.loadCredentials())
        if let url = URL(string: "\(origin.absoluteString)/t/\(blog.handle)") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func showMainWindowAction() { showMainWindow() }

    @objc private func showStatusWindowAction() { showStatusWindow() }

    @objc private func signInAction() { signIn() }

    @objc private func reopenApprovalAction() { linkController.reopenApproval() }

    @objc private func checkUpdates() {
        guard let updater else { return } // dev build: the menu item is hidden anyway
        NSApp.activate(ignoringOtherApps: true) // Sparkle's alert needs a frontmost app
        // Sparkle can't update an app running from Downloads or a
        // translocated mount; offer the move first, it relaunches from
        // /Applications where the update just works.
        if !isInstalled && Bundle.main.bundleURL.path.hasSuffix(".app") {
            if moveToApplicationsIfNeeded(interactive: true) { return } // relaunching
        }
        updater.checkForUpdates()
    }

    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: Main window (the web app)

    /// The full Write web experience in a native window. The app is
    /// account-gated: it always opens on the workspace home (`/start?to=home`),
    /// which bounces through sign-in when needed and then lands on the blog with
    /// the sidebar open. The public landing is never the first thing shown, and
    /// an unlinked Mac mints its sync token silently in the web view (no visible
    /// link step) via the `needsToken` path.
    private func showMainWindow() {
        if webWindow == nil {
            let credentials = store.loadCredentials()
            let origin = resolveServerOrigin(credentials: credentials)
            webWindow = WebAppWindowController(
                origin: origin,
                startPath: "/start?to=home",
                needsToken: credentials == nil,
                onLinked: { [weak self] token, linkedOrigin in
                    self?.handleAppLinked(token: token, origin: linkedOrigin)
                })
        }
        webWindow?.present()
    }

    /// The web view minted a sync token in the background: store it and start
    /// syncing. No navigation here; the user is already on their workspace (the
    /// mint happens on that page), so reloading would only flicker.
    private func handleAppLinked(token: String, origin: URL) {
        guard store.loadCredentials() == nil else { return } // mint at most once
        let device = Host.current().localizedName ?? "this Mac"
        store.saveCredentials(Credentials(
            token: token,
            serverOrigin: origin.absoluteString,
            tokenName: "Write.app on \(device)",
            linkedAt: Date()))
        appendActivity("Linked this Mac")
        engine.syncNow()
        captureAgent.poke()
        refreshUI()
    }

    // MARK: Status / settings window

    private func showStatusWindow() {
        if statusWindow == nil {
            statusWindow = StatusWindowController(actions: .init(
                signIn: { [weak self] in self?.signIn() },
                signOut: { [weak self] in self?.signOut() },
                cancelLink: { [weak self] in self?.linkController.cancel() },
                reopenApproval: { [weak self] in self?.linkController.reopenApproval() },
                changeFolder: { [weak self] in self?.changeSyncFolder() },
                openFolder: { [weak self] in self?.openFolderAction() },
                syncNow: { [weak self] in self?.engine.syncNow() }
            ))
        }
        refreshUI()
        NSApp.activate(ignoringOtherApps: true)
        statusWindow?.showWindow(nil)
        statusWindow?.window?.makeKeyAndOrderFront(nil)
    }

    private func appendActivity(_ message: String) {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "HH:mm"
        activityLog.append("\(df.string(from: Date()))  \(message)")
        if activityLog.count > 100 { activityLog.removeFirst(activityLog.count - 100) }
        refreshUI()
    }

    private func refreshUI() {
        guard let statusWindow else { return }

        var accountLine = "Not linked"
        var accountDetail: String?
        var linkCode: String?
        var linkHint: String?
        let credentials = store.loadCredentials()
        let linked = credentials != nil

        if let credentials {
            let blog = store.cachedWorkspace()?.blog
            accountLine = "Linked as \(blog.map { $0.name.isEmpty ? $0.handle : $0.name } ?? credentials.tokenName)"
            accountDetail = "\(credentials.tokenName) · \(credentials.serverOrigin)"
        }
        var linkFailed = false
        var waitingApproval = false
        switch linkController.state {
        case .starting:
            accountLine = "Linking…"
        case .waiting(let code, _, _):
            accountLine = "Waiting for approval"
            waitingApproval = true
            linkCode = code
            linkHint = "Confirm this code matches the one in your browser"
        case .failed(let message):
            // The failure IS the headline; buried small print taught the
            // owner nothing when a code quietly expired.
            accountLine = message
            linkHint = "Click Try Again to get a fresh code."
            linkFailed = true
        case .idle:
            break
        }

        statusWindow.refresh(StatusModel(
            accountLine: accountLine,
            accountDetail: accountDetail,
            linkCode: linkCode,
            linkHint: linkHint,
            linked: linked,
            linking: linkController.isLinking,
            linkFailed: linkFailed,
            waitingApproval: waitingApproval,
            folderPath: syncRoot().path,
            lastSyncLine: lastSyncLine(),
            busy: engine.isSyncing,
            activity: activityLog
        ))
    }

    // MARK: Main menu (Cmd+W / Cmd+Q / copy-paste for the window)

    private func buildMainMenu() -> NSMenu {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        _ = appMenu.addItem(withTitle: "About \(appName)",
                            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        _ = appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        _ = appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        editItem.submenu = edit
        _ = edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        _ = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        _ = edit.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
        _ = edit.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
        _ = edit.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
        _ = edit.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")

        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        main.addItem(windowItem)
        let window = NSMenu(title: "Window")
        windowItem.submenu = window
        _ = window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        _ = window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        NSApp.windowsMenu = window

        return main
    }
}
