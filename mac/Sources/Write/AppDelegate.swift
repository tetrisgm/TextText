import AppKit
import Carbon.HIToolbox
import CoreSpotlight
import FileProvider
import ServiceManagement
import WriteFileProviderKit
import WriteShareCore
import WriteSpotlight
import WriteWorkspaceCore

/// Regular Dock app + a menu-bar status item (menu rebuilt on open, the
/// partyparty shape; SwiftUI MenuBarExtra is deliberately avoided). The app
/// keeps the File Provider workspace and web app available from one process.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static let loginItemAppliedKey = "WriteLoginItemDefaultApplied"
    private static let productionBundleIdentifier = "net.writeapp.write.mac"
    private static let moveToApplicationsRelaunchArgument = "--write-moved-to-applications"
    private static let duplicateInstanceRecheckDelay: TimeInterval = 0.5
    // Bumped 10 -> 11 to rebuild the File Provider replica once more, converting
    // posts to `.textpack` (a single zipped textbundle) - the owner's create
    // format. A .textpack is one leaf file, so it keeps the phantom-free guarantee
    // of the interim flat `.md` (name and content are one node) while bundling
    // assets and importing into Bear/Ulysses. (9->10 was the flat `.md` step.) The
    // rebuild waits for zero pending local edits, so no in-flight edit is stranded.
    // 11 -> 12: refill leaf .textpack files that materialized as 0 bytes (a leaf
    // must advertise documentSize; see WriteItem).
    static let fileProviderSchemaVersion = 12
    private static let fileProviderSchemaVersionKey = "WriteFileProviderSchemaVersion"

    private let store = StateStore()
    private var changeListener: ChangeListener!
    private var captureAgent: CaptureAgent!
    private var linkController: LinkController!
    private var updater: Updater?          // created AFTER the move check; Sparkle must
                                           // never download into a translocated/Downloads copy
    private var statusItem: NSStatusItem!
    private var statusWindow: StatusWindowController?
    private var webWindow: WebAppWindowController?
    private var sharingServicePicker: NSSharingServicePicker?
    private var quickCaptureController: QuickCaptureController?
    private var quickCaptureHotKey: GlobalHotKey?
    private var quickBookmarkHotKey: GlobalHotKey?
    private var toggleWindowHotKey: GlobalHotKey?
    private var clipboardCaptureHotKey: GlobalHotKey?
    private var quickCaptureOutbox: QuickCaptureOutbox?
    private var quickCaptureRetry: DispatchWorkItem?
    private let quickCaptureQueue = DispatchQueue(
        label: "net.writeapp.write.quick-capture", qos: .userInitiated)
    private let openFileQueue = DispatchQueue(
        label: "com.example.write.mac.open-files", qos: .userInitiated)
    private var pendingExternalImports: [ExternalNoteImport] = []
    // Spotlight state is owned by spotlightQueue exclusively; the main
    // thread only ever schedules work onto it.
    private var spotlightIndexer: WorkspaceSpotlightIndexer?
    private var spotlightWatcher: WorkspaceFolderWatcher?
    private var spotlightIndexRootPath: String?
    private var spotlightIndexedIds = Set<String>()
    private var spotlightIndexedSignatures: [String: String] = [:]
    // Spotlight indexes from the server manifest (the mount's .textpack bodies are
    // zipped and carry no writeId). Cache per-folder etags + items so an unchanged
    // folder is a cheap 304 and a transient failure reuses the last good list.
    private var spotlightFolderETags: [String: String] = [:]
    private var spotlightManifestCache: [String: [ManifestItem]] = [:]
    private let spotlightQueue = DispatchQueue(label: "com.example.write.mac.spotlight", qos: .utility)
    private var spotlightDebounce: DispatchWorkItem?
    private var shareInboxWatcher: WorkspaceFolderWatcher?
    private var shareContainerAppearanceWatcher: WorkspaceFolderWatcher?
    private var shareInboxDebounce: DispatchWorkItem?
    private let shareInboxQueue = DispatchQueue(label: "com.example.write.mac.share-inbox", qos: .utility)
    private var activityLog: [String] = []
    private var wasBusy = false
    // The one File Provider domain registered for the signed-in workspace, if any.
    private var registeredFileProviderDomain: NSFileProviderDomain?
    private let fileProviderStatusMonitor = FileProviderStatusMonitor()
    // Main-thread generations for remote workspace metadata refreshes. A slower
    // older response may fill the cache after a newer request fails, but may not
    // overwrite a newer response that already landed.
    private var workspaceMetadataRefreshGeneration: UInt64 = 0
    private var workspaceMetadataAppliedGeneration: UInt64 = 0
    private var healthReporter: AppHealthReporter?
    private var fileProviderUserVisibleURL: URL?
    private var fileProviderDomainEpoch = 0
    private var fileProviderDesiredIdentity: String?
    private var fileProviderReconcileIdentity: String?
    private var fileProviderRemovalInFlight = false
    private var fileProviderRetry: DispatchWorkItem?
    private var fileProviderSchemaRepairRetry: DispatchWorkItem?
    private var fileProviderSchemaRepairInFlight = false
    private var fileProviderSchemaPendingEnumeration:
        (any FileProviderPendingEnumeration)?
    private var materializationEpoch = 0
    private var materializationRetry: DispatchWorkItem?
    private var isMaterializing = false

    // MARK: Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Before ANYTHING: offer to relocate to /Applications. Running from
        // ~/Downloads breaks Sparkle updates and triggers Gatekeeper
        // app-translocation; one click here fixes both (the LetsMove pattern).
        if moveToApplicationsIfNeeded() { return } // relaunching from the new home

        if terminateIfAnotherInstanceIsAlreadyRunning() { return }

        WebAppWindowController.configureURLCacheForStartup()

        // Only when the build carries a real feed + key; otherwise the
        // updater stays dormant and invisible (no Sparkle, no launch alert).
        if Updater.isConfigured {
            updater = Updater(isBusy: { [weak self] in
                self?.fileProviderStatusMonitor.snapshot.severity == .working })
        }
        registerLoginItemByDefault()
        NSApp.mainMenu = buildMainMenu()

        linkController = LinkController(store: store)
        // Sole-writer cutover: the File Provider mount is the ONLY sync path in
        // the GUI. There is no legacy `~/Write` mirror engine here anymore (it
        // survives only for the headless CLI, which builds its own SyncEngine in
        // Headless.swift). Sign-in seeds+registers the domain; the extension owns
        // create/rename/move/delete/body; a remote change re-materializes the
        // mount. This removes the double-writer and the races that let a stray
        // engine pass re-create the iCloud mirror.

        linkController.onChange = { [weak self] in self?.refreshUI() }
        linkController.onActivity = { [weak self] message in self?.appendActivity(message) }
        linkController.onLinked = { [weak self] _ in
            guard let self else { return }
            // Fetch+cache the workspace, then register the File Provider domain
            // (never a mirror pass). seedCachedWorkspaceIfNeeded calls
            // syncFileProviderDomain() once account.json is cached.
            self.seedCachedWorkspaceIfNeeded()
            self.healthReporter?.flushAsync()
            // Shared items filed while signed out could not reach the server;
            // drain them now that credentials exist.
            self.retryShareInboxDrain()
            self.retryQuickCaptureDrain()
            self.refreshUI()
            // Linking configures folder sync; bring the workspace forward.
            NSApp.activate(ignoringOtherApps: true)
            self.showMainWindow()
        }

        setupStatusItem()
        configureQuickCapture()
        // Warm account.json for a returning user so the File Provider domain can
        // register on launch. Best effort and file-free.
        seedCachedWorkspaceIfNeeded()
        configureSpotlightIndexing()
        configureShareInbox()
        syncFileProviderDomain()

        // Near-instant remote sync: a change on the web (edit, delete, new
        // bookmark) triggers a pass within seconds. The capture agent rides the
        // same signal.
        captureAgent = CaptureAgent(store: store)
        captureAgent.onActivity = { [weak self] message in self?.appendActivity(message) }
        changeListener = ChangeListener(store: store)
        changeListener.onRemoteChange = { [weak self] in
            guard let self else { return }
            self.captureAgent.poke()
            // The File Provider mount is the sole writer: a remote change means
            // re-materialize it and refresh the workspace metadata the retired
            // SyncEngine used to keep current.
            self.refreshWorkspaceMetadataAfterRemoteChange()
        }
        changeListener.start()
        captureAgent.start()

        fileProviderStatusMonitor.onChange = { [weak self] snapshot in
            guard let self else { return }
            // The mount is the sole writer, so its status drives what the engine's
            // onStateChange used to: let a Sparkle update deferred mid-sync surface
            // once sync settles, and reindex Spotlight after content lands.
            let busy = snapshot.severity == .working
            if self.wasBusy && !busy {
                self.updater?.busyDidEnd()
                self.scheduleSpotlightReindex()
            }
            self.wasBusy = busy
            self.refreshUI()
        }
        healthReporter = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { [weak self] in
                // The File Provider mount is the only on-disk home; nil until
                // the domain resolves (workspace.storage treats that as
                // nothing-to-verify, never a failure on a retired path).
                self?.fileProviderUserVisibleURL
            },
            finderStatusProvider: { [weak self] in
                guard let self else { return .unavailable }
                if Thread.isMainThread { return self.fileProviderStatusMonitor.snapshot }
                return DispatchQueue.main.sync {
                    self.fileProviderStatusMonitor.snapshot
                }
            })
        healthReporter?.start()

        let workspaceCenter = NSWorkspace.shared.notificationCenter
        workspaceCenter.addObserver(
            self, selector: #selector(systemDidResume(_:)),
            name: NSWorkspace.didWakeNotification, object: nil)
        workspaceCenter.addObserver(
            self, selector: #selector(systemDidResume(_:)),
            name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)

        showMainWindow() // open the workspace window on launch
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "write-app" {
            openWriteItemURL(url)
        }
        let fileURLs = urls.filter { $0.scheme != "write-app" }
        guard !fileURLs.isEmpty else { return }
        // The legacy syncRoot()/kind() classification is gone: with the File
        // Provider as the sole writer, every managed file lives in the mount, so
        // ask the system which items it owns. openExternalOrFileProviderItem
        // routes Write items to the managed opener and everything else to
        // external import.
        for url in fileURLs {
            guard OpenFileHandler.isSupported(url) else {
                appendActivity("Could not open \(url.lastPathComponent): unsupported file type")
                continue
            }
            openExternalOrFileProviderItem(url)
        }
    }

    private func openExternalOrFileProviderItem(_ url: URL) {
        NSFileProviderManager.getIdentifierForUserVisibleFile(at: url) {
            [weak self] identifier, domainIdentifier, _ in
            guard let self else { return }
            let belongsToWrite = OpenFileHandler.isWriteFileProviderItem(identifier?.rawValue)
                || domainIdentifier?.rawValue == Self.fileProviderDomainId
            if belongsToWrite {
                self.resolveAndOpenManagedFile(
                    url, fileProviderIdentifier: identifier?.rawValue)
            } else {
                self.prepareExternalImport(url)
            }
        }
    }

    private func resolveAndOpenManagedFile(
        _ url: URL,
        fileProviderIdentifier: String? = nil
    ) {
        let fallbackHandle = store.cachedWorkspace()?.blog.handle
        openFileQueue.async { [weak self] in
            guard let self else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let target = OpenFileHandler.managedTarget(
                for: url,
                fallbackHandle: fallbackHandle,
                fileProviderIdentifier: fileProviderIdentifier
            )
            DispatchQueue.main.async {
                guard let target else {
                    self.appendActivity(
                        "Could not match \(url.lastPathComponent) to a Texttext item")
                    self.showMainWindow()
                    return
                }
                self.openInMainWindow(target)
            }
        }
    }

    private func prepareExternalImport(_ url: URL) {
        openFileQueue.async { [weak self] in
            guard let self else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                let item = try OpenFileHandler.externalNoteImport(for: url)
                DispatchQueue.main.async { self.importExternalNote(item) }
            } catch {
                DispatchQueue.main.async {
                    self.appendActivity(
                        "Could not import \(url.lastPathComponent): \(error.localizedDescription)")
                    self.showMainWindow()
                }
            }
        }
    }

    private func importExternalNote(_ item: ExternalNoteImport) {
        guard store.loadCredentials() != nil else {
            pendingExternalImports.append(item)
            showMainWindow()
            return
        }
        openFileQueue.async { [weak self] in self?.createSyncedNote(item) }
    }

    private func createSyncedNote(_ item: ExternalNoteImport) {
        guard let credentials = store.loadCredentials() else {
            DispatchQueue.main.async { [weak self] in
                self?.pendingExternalImports.append(item)
                self?.showMainWindow()
            }
            return
        }
        let client = ServerClient(
            origin: resolveServerOrigin(credentials: credentials),
            token: credentials.token)
        let workspace: Workspace
        if let cached = store.cachedWorkspace() {
            workspace = cached
        } else {
            switch client.workspace() {
            case .failure(let error):
                DispatchQueue.main.async { [weak self] in
                    self?.appendActivity("Could not open note: \(error.description)")
                    self?.showMainWindow()
                }
                return
            case .success(let result):
                workspace = result.0
                store.cacheWorkspace(result.1)
            }
        }
        guard let notesFolder = workspace.folders.first(where: { $0.mode == "notes" }) else {
            DispatchQueue.main.async { [weak self] in
                self?.appendActivity("Could not open note: this workspace has no Notes folder")
                self?.showMainWindow()
            }
            return
        }
        switch client.postFile(
            body: item.markdown,
            folderId: notesFolder.id,
            representation: item.representation,
            idempotencyKey: item.idempotencyKey
        ) {
        case .failure(let error):
            DispatchQueue.main.async { [weak self] in
                self?.appendActivity("Could not import note: \(error.description)")
                self?.showMainWindow()
            }
        case .success(.conflict):
            DispatchQueue.main.async { [weak self] in
                self?.appendActivity("Could not import note because it changed on the server")
                self?.showMainWindow()
            }
        case .success(.rejected(let message)):
            DispatchQueue.main.async { [weak self] in
                self?.appendActivity("Could not import note: \(message)")
                self?.showMainWindow()
            }
        case .success(.saved(let saved)):
            guard let itemId = saved.id else {
                DispatchQueue.main.async { [weak self] in
                    self?.appendActivity("Could not import note: the server returned no item id")
                    self?.showMainWindow()
                }
                return
            }
            let target = WriteItemOpenTarget(
                handle: workspace.blog.handle,
                itemId: itemId,
                slug: saved.slug,
                kind: "note"
            )
            DispatchQueue.main.async { [weak self] in
                // The note now lives on the server; re-materialize the mount
                // (a signed-in workspace is always File-Provider-backed).
                self?.signalFileProviderChange(serverReachable: true)
                self?.openInMainWindow(target)
            }
        }
    }

    private func openInMainWindow(_ target: WriteItemOpenTarget) {
        showMainWindow(path: target.appPath)
    }

    func application(
        _ application: NSApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void
    ) -> Bool {
        guard userActivity.activityType == CSSearchableItemActionType,
              let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String else {
            return false
        }
        openWriteItem(id: id)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        changeListener?.stop()
        materializationRetry?.cancel()
        fileProviderRetry?.cancel()
        quickCaptureRetry?.cancel()
        quickCaptureHotKey?.unregister()
        quickBookmarkHotKey?.unregister()
        toggleWindowHotKey?.unregister()
        clipboardCaptureHotKey?.unregister()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMainWindow() }
        return true
    }

    @discardableResult
    private func terminateIfAnotherInstanceIsAlreadyRunning() -> Bool {
        if ProcessInfo.processInfo.arguments.contains(Self.moveToApplicationsRelaunchArgument) {
            return false
        }
        guard let runningInstance = runningInstanceForSingleInstanceGuard() else { return false }
        activateRunningInstance(runningInstance)

        Thread.sleep(forTimeInterval: Self.duplicateInstanceRecheckDelay)
        guard let confirmedInstance = runningInstanceForSingleInstanceGuard() else { return false }
        activateRunningInstance(confirmedInstance)
        NSApp.terminate(nil)
        return true
    }

    private func runningInstanceForSingleInstanceGuard() -> NSRunningApplication? {
        guard let bundleIdentifier = Bundle.main.bundleIdentifier
                ?? (Bundle.main.bundleURL.path.hasSuffix(".app") ? Self.productionBundleIdentifier : nil) else {
            return nil
        }
        let current = NSRunningApplication.current
        let currentProcessIdentifier = current.processIdentifier
        let currentLaunchDate = current.launchDate

        return NSRunningApplication
            .runningApplications(withBundleIdentifier: bundleIdentifier)
            .filter { app in
                app.processIdentifier != currentProcessIdentifier
                    && !app.isTerminated
                    && wasLaunchedBeforeCurrent(app,
                                                currentLaunchDate: currentLaunchDate,
                                                currentProcessIdentifier: currentProcessIdentifier)
            }
            .sorted(by: launchedEarlier)
            .first
    }

    private func activateRunningInstance(_ app: NSRunningApplication) {
        app.activate(options: [.activateAllWindows])
    }

    private func wasLaunchedBeforeCurrent(_ app: NSRunningApplication,
                                          currentLaunchDate: Date?,
                                          currentProcessIdentifier: pid_t) -> Bool {
        if let appLaunchDate = app.launchDate, let currentLaunchDate, appLaunchDate != currentLaunchDate {
            return appLaunchDate < currentLaunchDate
        }
        return app.processIdentifier < currentProcessIdentifier
    }

    private func launchedEarlier(_ lhs: NSRunningApplication, _ rhs: NSRunningApplication) -> Bool {
        if let lhsLaunchDate = lhs.launchDate,
           let rhsLaunchDate = rhs.launchDate,
           lhsLaunchDate != rhsLaunchDate {
            return lhsLaunchDate < rhsLaunchDate
        }
        return lhs.processIdentifier < rhs.processIdentifier
    }

    // Foreground check, throttled to one per 5 minutes (the partyparty rule).
    private var lastForegroundCheck = Date.distantPast
    private var lastBackgroundRecoveryUptime: TimeInterval?
    func applicationDidBecomeActive(_ notification: Notification) {
        recoverBackgroundSync()
        healthReporter?.runIfNeededAsync()
        guard Date().timeIntervalSince(lastForegroundCheck) > 300 else { return }
        lastForegroundCheck = Date()
        updater?.checkNow()
    }

    @objc private func systemDidResume(_ notification: Notification) {
        recoverBackgroundSync()
    }

    /// Wake, unlock, network recovery, and foregrounding all converge here. The
    /// operations coalesce in their respective owners, so this never reloads the
    /// web view, replaces local state, or redraws Finder before a sync pass has
    /// established that mirrored content actually changed.
    private func recoverBackgroundSync() {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.recoverBackgroundSync() }
            return
        }
        let uptime = ProcessInfo.processInfo.systemUptime
        guard Self.shouldRunBackgroundRecovery(
            lastRunUptime: lastBackgroundRecoveryUptime,
            nowUptime: uptime
        ) else { return }
        lastBackgroundRecoveryUptime = uptime
        // Recover a domain that never registered (e.g. a transient sign-in fetch);
        // a no-op once the workspace is cached and the domain is up.
        seedCachedWorkspaceIfNeeded()
        changeListener?.nudge()
        signalFileProviderChange(serverReachable: true)
        captureAgent?.poke()
        retryQuickCaptureDrain()
        fileProviderStatusMonitor.refresh()
    }

    static func shouldRunBackgroundRecovery(
        lastRunUptime: TimeInterval?,
        nowUptime: TimeInterval,
        coalescingWindow: TimeInterval = 1
    ) -> Bool {
        guard let lastRunUptime else { return true }
        return nowUptime - lastRunUptime >= coalescingWindow
    }

    // MARK: Quick capture

    private func configureQuickCapture() {
        do {
            quickCaptureOutbox = try QuickCaptureOutbox(baseDirectory: store.baseDir)
        } catch {
            appendActivity(error.localizedDescription)
        }

        do {
            quickCaptureHotKey = try GlobalHotKey { [weak self] in
                DispatchQueue.main.async { self?.presentQuickCapture() }
            }
        } catch {
            appendActivity(error.localizedDescription)
        }

        quickBookmarkHotKey = registerQuickCaptureHotKey(
            keyCode: UInt32(kVK_ANSI_B)) { [weak self] in
                self?.newBookmarkAction()
            }
        toggleWindowHotKey = registerQuickCaptureHotKey(
            keyCode: UInt32(kVK_ANSI_W)) { [weak self] in
                self?.toggleMainWindowAction()
            }
        clipboardCaptureHotKey = registerQuickCaptureHotKey(
            keyCode: UInt32(kVK_ANSI_V)) { [weak self] in
                self?.captureClipboardAction()
            }

        // A prior offline session may have left durable records. A returning
        // signed-in app should file them without requiring another capture.
        retryQuickCaptureDrain()
    }

    @objc private func quickCaptureAction() {
        presentQuickCapture()
    }

    private func registerQuickCaptureHotKey(
        keyCode: UInt32,
        action: @escaping () -> Void
    ) -> GlobalHotKey? {
        do {
            return try GlobalHotKey(keyCode: keyCode) {
                DispatchQueue.main.async(execute: action)
            }
        } catch {
            appendActivity(error.localizedDescription)
            return nil
        }
    }

    @objc private func newBookmarkAction() {
        enqueueQuickCapture(
            QuickCaptureContent(title: "Untitled", body: ""),
            target: .bookmarks)
    }

    @objc private func captureClipboardAction() {
        guard let text = NSPasteboard.general.string(forType: .string),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        enqueueQuickCapture(QuickCaptureContent.parse(text), target: .notes)
    }

    private func enqueueQuickCapture(
        _ content: QuickCaptureContent,
        target: QuickCaptureTarget
    ) {
        guard let outbox = quickCaptureOutbox else {
            appendActivity("The capture outbox is unavailable")
            return
        }
        do {
            try outbox.enqueue(content, target: target)
            retryQuickCaptureDrain()
        } catch {
            appendActivity(error.localizedDescription)
        }
    }

    private func presentQuickCapture() {
        if quickCaptureController == nil {
            quickCaptureController = QuickCaptureController { [weak self] content in
                guard let self, let outbox = self.quickCaptureOutbox else {
                    throw QuickCaptureOutboxError.couldNotPersist(
                        "The capture outbox is unavailable")
                }
                try outbox.enqueue(content)
                self.retryQuickCaptureDrain()
            }
        }
        NSApp.activate(ignoringOtherApps: true)
        quickCaptureController?.present()
    }

    private func retryQuickCaptureDrain(delay: TimeInterval = 0) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.retryQuickCaptureDrain(delay: delay)
            }
            return
        }
        guard quickCaptureOutbox != nil else { return }
        quickCaptureRetry?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.quickCaptureQueue.async { [weak self] in
                self?.drainQuickCaptureOutbox()
            }
        }
        quickCaptureRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Runs away from the main thread because ServerClient is synchronous. The
    /// outbox record remains untouched on every transient failure and is retried
    /// with the same key, including after a later device link.
    private func drainQuickCaptureOutbox() {
        guard let outbox = quickCaptureOutbox,
              !outbox.pendingRecords().isEmpty else { return }
        guard let credentials = store.loadCredentials() else { return }

        let client = ServerClient(
            origin: resolveServerOrigin(credentials: credentials),
            token: credentials.token)
        let workspace: Workspace
        let usedCachedWorkspace: Bool
        if let cached = store.cachedWorkspace() {
            workspace = cached
            usedCachedWorkspace = true
        } else {
            switch client.workspace() {
            case .success(let (fetched, data)):
                workspace = fetched
                usedCachedWorkspace = false
                store.cacheWorkspace(data)
            case .failure(let error):
                appendActivity("Could not file capture: \(error.description)")
                retryQuickCaptureDrain(delay: 15)
                return
            }
        }

        let drainer = QuickCaptureOutboxDrainer(outbox: outbox)
        var summary = drainer.drain(
            workspace: workspace,
            client: client,
            deferRejections: usedCachedWorkspace
        )
        if usedCachedWorkspace && summary.shouldRetry {
            switch client.workspace() {
            case .success(let (freshWorkspace, data)):
                store.cacheWorkspace(data)
                let refreshed = drainer.drain(
                    workspace: freshWorkspace,
                    client: client)
                summary.savedItems.append(contentsOf: refreshed.savedItems)
                summary.rejectedMessages.append(
                    contentsOf: refreshed.rejectedMessages)
                summary.retryMessages = refreshed.retryMessages
            case .failure:
                break
            }
        }
        if !summary.savedItems.isEmpty {
            appendActivity(
                "Filed \(summary.savedItems.count) capture\(summary.savedItems.count == 1 ? "" : "s")")
            DispatchQueue.main.async { [weak self] in
                self?.signalFileProviderChange(serverReachable: true)
            }
        }
        for message in summary.rejectedMessages {
            appendActivity("Capture rejected: \(message); kept in Capture Rejected")
        }
        if summary.shouldRetry {
            if let message = summary.retryMessages.first {
                appendActivity("Could not file capture: \(message); will retry")
            }
            retryQuickCaptureDrain(delay: 15)
        }
    }

    // MARK: Share inbox

    private func configureShareInbox() {
        guard let container = shareInboxContainerURL() else {
            // The group container does not exist until the Share extension runs
            // for the first time. Watch the Group Containers root so the very
            // first shared item is picked up without an app restart.
            watchForShareContainerCreation()
            return
        }
        shareContainerAppearanceWatcher?.stop()
        shareContainerAppearanceWatcher = nil
        let inboxURL = InboxReader.inboxURL(containerURL: container)
        try? FileManager.default.createDirectory(at: inboxURL, withIntermediateDirectories: true)

        shareInboxWatcher?.stop()
        shareInboxWatcher = WorkspaceFolderWatcher(
            path: inboxURL.path,
            queue: shareInboxQueue,
            includeUbiquitousItems: false
        ) { [weak self] in
            self?.scheduleShareInboxDrain(containerURL: container)
        }
        scheduleShareInboxDrain(containerURL: container, delay: 0)
    }

    /// The system group-containers directory; WRITE_GROUP_CONTAINERS_DIR
    /// overrides it for isolated tests (the real path ignores $HOME).
    private static func groupContainersRoot() -> URL {
        if let override = ProcessInfo.processInfo.environment["WRITE_GROUP_CONTAINERS_DIR"],
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Group Containers", isDirectory: true)
    }

    private func watchForShareContainerCreation() {
        guard shareContainerAppearanceWatcher == nil else { return }
        let groupsRoot = Self.groupContainersRoot()
        guard FileManager.default.fileExists(atPath: groupsRoot.path) else { return }
        shareContainerAppearanceWatcher = WorkspaceFolderWatcher(
            path: groupsRoot.path,
            queue: shareInboxQueue,
            includeUbiquitousItems: false
        ) { [weak self] in
            guard let self, self.shareInboxContainerURL() != nil else { return }
            DispatchQueue.main.async {
                self.configureShareInbox()
                // The container now exists: (re)publish the handoff so the
                // File Provider extension can read the token.
                self.syncFileProviderDomain()
            }
        }
    }

    private func shareInboxContainerURL() -> URL? {
        let envGroup = ProcessInfo.processInfo.environment["WRITE_APP_GROUP"]
        guard let groupIdentifier = envGroup
            ?? Bundle.main.object(forInfoDictionaryKey: "WriteAppGroupIdentifier") as? String,
              !groupIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              groupIdentifier != "WRITE_APP_GROUP" else {
            return nil
        }
        // The app ships non-sandboxed and without the app-group entitlement, so
        // FileManager.containerURL(forSecurityApplicationGroupIdentifier:) is no
        // help here: on a non-entitled process it returns a naive
        // "<home>/Library/Group Containers/<group id>" path, but the sandboxed
        // Share extension actually creates a TEAM-PREFIXED container
        // ("<team>.<group id>"). A non-sandboxed app running as the same user can
        // read that directory directly, so locate it by scanning and matching
        // the id as either the bare name or a ".<group id>" suffix.
        let groupsRoot = Self.groupContainersRoot()
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: groupsRoot, includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]) else {
            return nil
        }
        return entries.first { entry in
            let name = entry.lastPathComponent
            return name == groupIdentifier || name.hasSuffix(".\(groupIdentifier)")
        }
    }

    private func scheduleShareInboxDrain(containerURL: URL, delay: TimeInterval = 0.5) {
        shareInboxDebounce?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.drainShareInbox(containerURL: containerURL)
        }
        shareInboxDebounce = work
        shareInboxQueue.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Re-drive the share inbox after credentials arrive (called from sign-in).
    private func retryShareInboxDrain() {
        guard let container = shareInboxContainerURL() else { return }
        scheduleShareInboxDrain(containerURL: container, delay: 0)
    }

    /// Drain shared items straight to the server (the sole writer now creates
    /// nothing in the legacy mirror). Runs on shareInboxQueue, so the
    /// synchronous ServerClient calls are safe here.
    private func drainShareInbox(containerURL: URL) {
        let reader = InboxReader(containerURL: containerURL)
        let records: [InboxRecord]
        do {
            records = try reader.completeItems()
        } catch {
            appendActivity("Share inbox read failed: \(error.localizedDescription)")
            return
        }
        guard !records.isEmpty else { return }

        // Signed out: keep the items (do NOT deleteConsumed) so they drain after
        // the next sign-in via retryShareInboxDrain().
        guard let credentials = store.loadCredentials() else {
            appendActivity("Sign in to file shared items")
            return
        }
        let client = ServerClient(
            origin: resolveServerOrigin(credentials: credentials),
            token: credentials.token)
        let workspace: Workspace
        if let cached = store.cachedWorkspace() {
            workspace = cached
        } else {
            switch client.workspace() {
            case .success(let (ws, data)):
                workspace = ws
                store.cacheWorkspace(data)
            case .failure(let error):
                appendActivity("Share inbox filing failed: \(error.description)")
                return
            }
        }

        let filer = InboxFiler()
        var filed = 0
        for record in records {
            do {
                switch try filer.prepare(record) {
                case let .create(folderMode, body, representation, idempotencyKey):
                    let folderId = workspace.folders.first { $0.mode == folderMode }?.id
                    switch client.postFile(
                        body: body, folderId: folderId,
                        representation: representation, idempotencyKey: idempotencyKey
                    ) {
                    case .success(.saved):
                        try reader.deleteConsumed(record)
                        filed += 1
                    case .success(.conflict):
                        // Do not drop it; the next drain retries the POST.
                        appendActivity("A shared item conflicted on the server; will retry")
                    case .success(.rejected(let message)):
                        // Retrying identical bytes is futile, but the shared text
                        // may be the user's only copy: park it, never destroy it.
                        appendActivity("Shared item rejected: \(message); kept in Inbox Rejected")
                        try reader.moveToDeadLetter(record)
                    case .failure(let error):
                        appendActivity("Could not file a shared item: \(error.description)")
                    }
                case let .append(targetWriteId, text):
                    if appendSharedText(
                        text, toDocument: targetWriteId, client: client,
                        appliedMarkerURL: record.directoryURL
                            .appendingPathComponent(".append-applied")
                    ) {
                        try reader.deleteConsumed(record)
                        filed += 1
                    }
                case let .unsupported(reason):
                    appendActivity("Skipped a shared item: \(reason)")
                    try reader.deleteConsumed(record)
                }
            } catch {
                appendActivity("Share inbox filing failed: \(error.localizedDescription)")
            }
        }
        guard filed > 0 else { return }
        DispatchQueue.main.async { [weak self] in
            self?.appendActivity("Filed \(filed) shared item\(filed == 1 ? "" : "s")")
            // A signed-in workspace is always File-Provider-backed; re-materialize.
            self?.signalFileProviderChange(serverReachable: true)
            self?.scheduleSpotlightReindex()
            self?.refreshUI()
        }
    }

    /// Append shared text to an existing server document with If-Match, so a
    /// stale hash surfaces as a conflict (retried next drain) rather than a
    /// silent drop. Returns true only when the append landed.
    private func appendSharedText(
        _ text: String, toDocument id: String, client: ServerClient,
        appliedMarkerURL: URL? = nil
    ) -> Bool {
        // A prior drain PUT this record's text and crashed before consuming the
        // record: the applied marker is definitive proof, so consume without
        // appending again. (Content is never sniffed; a deliberate second share
        // of identical text has its own record directory and no marker.)
        if let appliedMarkerURL,
           FileManager.default.fileExists(atPath: appliedMarkerURL.path) {
            return true
        }
        switch client.fileText(postId: id) {
        case .failure(let error):
            appendActivity("Could not load the shared target: \(error.description)")
            return false
        case .success(let (existing, hash)):
            guard let hash else {
                appendActivity("Could not append shared text: the server sent no version")
                return false
            }
            var body = existing
            if !body.hasSuffix("\n") { body += "\n" }
            body += text
            if !body.hasSuffix("\n") { body += "\n" }
            switch client.putFile(postId: id, body: body, ifMatch: hash) {
            case .success(.saved):
                // Record that THIS record's append landed, before the caller's
                // deleteConsumed. A crash in between re-drains the record, and
                // the marker (definitive, keyed to this record, never inferred
                // from document content) lets the retry consume it without
                // doubling the text. A crash mid-PUT leaves no marker and the
                // retry simply PUTs again: the residual double-append window is
                // the local marker write, not the network round-trip.
                if let appliedMarkerURL {
                    try? Data("applied".utf8).write(to: appliedMarkerURL)
                }
                return true
            case .success(.conflict):
                appendActivity("The shared target changed on the server; will retry the append")
                return false
            case .success(.rejected(let message)):
                appendActivity("Append rejected: \(message)")
                return false
            case .failure(let error):
                appendActivity("Could not append shared text: \(error.description)")
                return false
            }
        }
    }

    // MARK: Spotlight and deep links

    private struct SpotlightPersistedState: Codable {
        var rootPath: String
        var indexedIds: [String]
    }

    private var spotlightStateURL: URL {
        store.baseDir.appendingPathComponent("spotlight-index.json")
    }

    /// Resolve the File Provider root, then configure indexing against it.
    private func configureSpotlightIndexing() {
        resolveFileProviderRoot { [weak self] root in
            guard let self, let root else { return }
            self.configureSpotlightIndexing(root: root)
        }
    }

    /// Completion runs on the main thread. nil means the domain has not
    /// materialized yet.
    private func resolveFileProviderRoot(completion: @escaping (URL?) -> Void) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.resolveFileProviderRoot(completion: completion)
            }
            return
        }
        if let cached = fileProviderUserVisibleURL {
            completion(cached)
            return
        }
        guard let domain = registeredFileProviderDomain,
              let manager = NSFileProviderManager(for: domain) else {
            // No File Provider domain yet: the mount is the sole writer, so there
            // is no mirror to index; wait for the domain to materialize.
            completion(nil)
            return
        }
        manager.getUserVisibleURL(for: .rootContainer) { [weak self] url, _ in
            DispatchQueue.main.async {
                if let url { self?.fileProviderUserVisibleURL = url }
                completion(url)
            }
        }
    }

    private func configureSpotlightIndexing(root: URL) {
        spotlightQueue.async { [weak self] in
            guard let self else { return }
            let rootPath = root.standardizedFileURL.path
            // Same root already wired: a cheap incremental reindex, no rebuild
            // of the indexer/watcher. Covers the re-drive on every remote change.
            if self.spotlightIndexRootPath == rootPath, self.spotlightIndexer != nil {
                self.scheduleSpotlightReindexOnQueue()
                return
            }
            self.spotlightWatcher?.stop()
            self.spotlightIndexer = WorkspaceSpotlightIndexer()
            self.spotlightIndexRootPath = rootPath
            self.spotlightIndexedSignatures = [:]
            // Reconcile with what earlier runs indexed: a changed root drops
            // the whole domain; the same root seeds the known-id set so items
            // deleted while the app was not running get removed on the first
            // refresh instead of persisting forever.
            if let data = try? Data(contentsOf: self.spotlightStateURL),
               let persisted = try? JSONDecoder().decode(SpotlightPersistedState.self, from: data),
               persisted.rootPath == rootPath {
                self.spotlightIndexedIds = Set(persisted.indexedIds)
            } else {
                self.spotlightIndexer?.removeAll()
                self.spotlightIndexedIds = []
            }
            self.spotlightWatcher = WorkspaceFolderWatcher(
                path: root.path, queue: self.spotlightQueue
            ) { [weak self] in
                self?.scheduleSpotlightReindexOnQueue()
            }
            self.scheduleSpotlightReindexOnQueue()
        }
    }

    /// Safe from any thread.
    private func scheduleSpotlightReindex() {
        spotlightQueue.async { [weak self] in
            self?.scheduleSpotlightReindexOnQueue()
        }
    }

    /// spotlightQueue only.
    private func scheduleSpotlightReindexOnQueue() {
        spotlightDebounce?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.refreshSpotlightIndex() }
        spotlightDebounce = work
        spotlightQueue.asyncAfter(deadline: .now() + 1, execute: work)
    }

    /// spotlightQueue only. Build the identity index from server manifests and
    /// submit only added, changed, or removed ids. A partial manifest pass skips
    /// removals and unions the ids it did see with the prior set.
    private func refreshSpotlightIndex() {
        guard let indexer = spotlightIndexer else { return }
        // Source of truth is the server manifest, not a file scan: the mount's
        // .textpack bodies are zipped and carry no writeId. Skip (never destroy
        // the existing index) when signed out or the workspace cache is cold.
        guard let credentials = store.loadCredentials(),
              let workspace = store.cachedWorkspace() else { return }
        let client = ServerClient(
            origin: resolveServerOrigin(credentials: credentials),
            token: credentials.token)
        let mountRoot = spotlightIndexRootPath.map {
            URL(fileURLWithPath: $0, isDirectory: true)
        }

        var documents: [WorkspaceSpotlightDocument] = []
        var signatures: [String: String] = [:]
        // A degenerate empty folder list must never compute removed = everything.
        var healthy = !workspace.folders.isEmpty
        for folder in workspace.folders {
            let items: [ManifestItem]
            switch client.manifest(
                folderId: folder.id, etag: spotlightFolderETags[folder.id]
            ) {
            case .success(.manifest(let fetched, let etag)):
                spotlightFolderETags[folder.id] = etag
                spotlightManifestCache[folder.id] = fetched
                items = fetched
            case .success(.notModified):
                items = spotlightManifestCache[folder.id] ?? []
            case .failure:
                // Keep the last good list; a transient failure must not drop ids.
                healthy = false
                items = spotlightManifestCache[folder.id] ?? []
            }
            for item in items {
                guard let id = item.id, !id.isEmpty else { continue }
                documents.append(makeSpotlightDocument(
                    item: item, folder: folder, workspace: workspace,
                    mountRoot: mountRoot))
                signatures[id] = Self.spotlightSignature(
                    item: item, folder: folder, workspace: workspace)
            }
        }

        let currentIds = Set(signatures.keys)
        let changed = documents.filter {
            spotlightIndexedSignatures[$0.writeId] != signatures[$0.writeId]
        }
        // Only a fully-healthy pass may remove ids, so a transient manifest
        // failure never drops still-present posts.
        let removed = healthy ? spotlightIndexedIds.subtracting(currentIds) : []
        if !removed.isEmpty {
            indexer.remove(ids: Array(removed))
            // Forget removed signatures so a reappearing id is indexed again.
            for id in removed { spotlightIndexedSignatures[id] = nil }
        }
        if !changed.isEmpty { indexer.indexDocuments(changed) }

        let knownIds = healthy ? currentIds : spotlightIndexedIds.union(currentIds)
        spotlightIndexedIds = knownIds
        for (id, signature) in signatures {
            spotlightIndexedSignatures[id] = signature
        }
        let persisted = SpotlightPersistedState(
            rootPath: spotlightIndexRootPath ?? "",
            indexedIds: Array(knownIds)
        )
        if let data = try? JSONEncoder().encode(persisted) {
            try? data.write(to: spotlightStateURL, options: .atomic)
        }
    }

    /// Build a Spotlight document from a manifest item. Its markdown is the
    /// frontmatter the indexer expects, synthesized from the authoritative
    /// manifest (title/kind/status/slug); a Spotlight click routes by writeId to
    /// openWriteItem(id:), so no on-disk body or resolved URL is required.
    private func makeSpotlightDocument(
        item: ManifestItem, folder: WorkspaceFolder, workspace: Workspace,
        mountRoot: URL?
    ) -> WorkspaceSpotlightDocument {
        let relativePath = Self.spotlightRelativePath(
            item: item, folder: folder, workspace: workspace)
        let fileURL = (mountRoot ?? URL(fileURLWithPath: "/"))
            .appendingPathComponent(relativePath)
        let markdown = """
        ---
        title: \(jsonEncodedString(item.title))
        kind: \(jsonEncodedString(item.kind))
        status: \(jsonEncodedString(item.status))
        slug: \(jsonEncodedString(item.slug))
        canonical_url: \(jsonEncodedString(item.canonicalUrl ?? ""))
        ---
        """
        return WorkspaceSpotlightDocument(
            writeId: item.id ?? "",
            entry: IndexEntry(
                hash: item.hash, relativePath: relativePath,
                fileMtime: nil, folderId: folder.id, kind: item.kind),
            relativePath: relativePath,
            fileURL: fileURL,
            markdown: markdown)
    }

    /// Spotlight metadata changes when an item moves even if its Markdown hash
    /// does not. Include every manifest field used to build the searchable item,
    /// plus its reconstructed File Provider path.
    static func spotlightSignature(
        item: ManifestItem, folder: WorkspaceFolder, workspace: Workspace
    ) -> String {
        [
            item.hash, item.title, item.kind, item.status, item.slug,
            item.canonicalUrl ?? "", folder.id,
            spotlightRelativePath(item: item, folder: folder, workspace: workspace),
        ].map { "\($0.utf8.count):\($0)" }.joined()
    }

    /// Reconstruct the File Provider mount path from user-visible workspace,
    /// folder, and title components. The sync manifest's `posts/<slug>` path is
    /// a transport path and does not exist in Finder.
    static func spotlightRelativePath(
        item: ManifestItem, folder: WorkspaceFolder, workspace: Workspace
    ) -> String {
        let foldersById = Dictionary(
            uniqueKeysWithValues: workspace.folders.map { ($0.id, $0) })
        var chain: [String] = []
        var current: WorkspaceFolder? = folder
        var visited = Set<String>()
        while let value = current, visited.insert(value.id).inserted {
            chain.append(WriteFilename.encodeComponent(value.name))
            current = value.parentId.flatMap { foldersById[$0] }
        }
        let representation = WriteFileRepresentation.inferred(
            fromFilename: item.file) ?? .textpack
        let filename = WriteFilename.filename(
            title: item.title, slug: item.slug, representation: representation)
        let workspaceName = WriteFilename.encodeComponent(workspace.blog.name)
        return ([workspaceName] + Array(chain.reversed()) + [filename])
            .joined(separator: "/")
    }

    private func jsonEncodedString(_ value: String) -> String {
        if let data = try? JSONEncoder().encode(value),
           let string = String(data: data, encoding: .utf8) { return string }
        return "\"\(value)\""
    }

    /// Main thread. Resolution happens off-main and only through the known
    /// indexes: the scheme is invokable by any app on the system, so an
    /// unknown id must cost a dictionary miss, never a workspace scan.
    private func openWriteItemURL(_ url: URL) {
        guard url.host == "item",
              url.pathComponents.count == 2,
              let id = url.pathComponents.last else {
            appendActivity("Ignored malformed Texttext link \(url.absoluteString)")
            return
        }
        guard isValidWriteItemId(id) else {
            appendActivity("Ignored Texttext link with an invalid item id")
            return
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let action = query.first(where: { $0.name == "action" })?.value
        if let action {
            guard let rawTarget = query.first(where: { $0.name == "url" })?.value,
                  let target = validatedWriteWebURL(rawTarget) else {
                appendActivity("Ignored Texttext action with an invalid target")
                return
            }
            switch action {
            case "share":
                presentSharePicker(for: target)
            case "manage-access":
                presentAccessManagement(for: target)
            default:
                appendActivity("Ignored unknown Texttext action \(action)")
            }
            return
        }
        openWriteItem(id: id)
    }

    private func validatedWriteWebURL(_ value: String) -> URL? {
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              let host = url.host?.lowercased() else { return nil }
        let origin = resolveServerOrigin(credentials: store.loadCredentials())
        guard host == origin.host?.lowercased(),
              url.port == origin.port else { return nil }
        return url
    }

    private func presentSharePicker(for url: URL) {
        NSApp.activate(ignoringOtherApps: true)
        let picker = NSSharingServicePicker(items: [url])
        sharingServicePicker = picker
        if let button = statusItem.button {
            picker.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        } else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url.absoluteString, forType: .string)
            appendActivity("Copied the Texttext link")
        }
    }

    private func presentAccessManagement(for url: URL) {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        var query = components.queryItems ?? []
        query.removeAll(where: { $0.name == "manageAccess" })
        query.append(URLQueryItem(name: "manageAccess", value: "1"))
        components.queryItems = query
        guard components.url != nil else { return }
        showMainWindow()
        let querySuffix = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        let path = components.percentEncodedPath + querySuffix
        webWindow?.load(path: path)
    }

    /// Main thread. Resolve a Write deep link through the File Provider: the
    /// item's stable identifier maps to a user-visible URL the managed opener
    /// then interprets. A cold, freshly-created item may not be enumerated yet,
    /// so a nil URL nudges the enumerator and retries briefly before giving up.
    private func openWriteItem(id: String) {
        guard isValidWriteItemId(id) else {
            appendActivity("Ignored Texttext link with an invalid item id")
            return
        }
        guard let handle = store.cachedWorkspace()?.blog.handle, !handle.isEmpty,
              let domain = registeredFileProviderDomain,
              let manager = NSFileProviderManager(for: domain) else {
            appendActivity("No item found for Texttext link")
            return
        }
        let identifier = NSFileProviderItemIdentifier(
            rawValue: WriteItemIdentifier.file(handle: handle, id: id).rawValue)
        resolveWriteFileProviderURL(identifier, manager: manager) { [weak self] url in
            guard let self else { return }
            guard let url else {
                self.appendActivity("No item found for Texttext link")
                return
            }
            self.resolveAndOpenManagedFile(url, fileProviderIdentifier: identifier.rawValue)
        }
    }

    /// Ask the File Provider for an item's user-visible URL, nudging the
    /// enumerator and retrying a couple of times for a just-created cold item.
    /// Completion runs on the main thread.
    private func resolveWriteFileProviderURL(
        _ identifier: NSFileProviderItemIdentifier,
        manager: NSFileProviderManager,
        attempt: Int = 0,
        completion: @escaping (URL?) -> Void
    ) {
        manager.getUserVisibleURL(for: identifier) { [weak self] url, _ in
            if let url {
                DispatchQueue.main.async { completion(url) }
                return
            }
            guard let self, attempt < 2 else {
                DispatchQueue.main.async { completion(nil) }
                return
            }
            // Not enumerated yet: nudge the working set and retry shortly.
            manager.signalEnumerator(for: .workingSet) { _ in }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                self.resolveWriteFileProviderURL(
                    identifier, manager: manager,
                    attempt: attempt + 1, completion: completion)
            }
        }
    }

    private func isValidWriteItemId(_ id: String) -> Bool {
        guard !id.isEmpty, id.count <= 64 else { return false }
        return id.allSatisfy { character in
            (character.isASCII && (character.isLetter || character.isNumber))
                || character == "-"
        }
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
        store.clearIndex()
        removeFileProviderDomain()
        appendActivity("Signed out; local files kept")
        refreshUI()
    }

    // MARK: File Provider domain

    /// Signal content immediately, then refresh account.json from the server.
    /// The GUI no longer runs SyncEngine, so without this refresh newly-created
    /// folders and workspace renames remain absent from Spotlight and the File
    /// Provider handoff until the app relaunches.
    private func refreshWorkspaceMetadataAfterRemoteChange() {
        signalFileProviderChange(serverReachable: true)
        guard let credentials = store.loadCredentials() else { return }

        workspaceMetadataRefreshGeneration &+= 1
        let generation = workspaceMetadataRefreshGeneration
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let client = ServerClient(
                origin: resolveServerOrigin(credentials: credentials),
                token: credentials.token)
            guard case .success(let (_, data)) = client.workspace() else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self,
                      generation > self.workspaceMetadataAppliedGeneration,
                      let current = self.store.loadCredentials(),
                      current.token == credentials.token,
                      current.serverOrigin == credentials.serverOrigin else { return }
                self.workspaceMetadataAppliedGeneration = generation
                self.store.cacheWorkspace(data)
                // Refresh the extension handoff, including workspace name and
                // folder-aware signals, then rebuild Spotlight from live metadata.
                self.syncFileProviderDomain(signalExistingDomain: true)
                self.scheduleSpotlightReindex()
                self.refreshUI()
            }
        }
    }

    /// One stable "Texttext" File Provider domain now spans every workspace: the
    /// root lists a folder per workspace, so the Finder Locations entry is a
    /// single "Texttext" and the workspace name lives on the folder inside it.
    private static let fileProviderDomainId = "write"
    private static let fileProviderDomainName = "Texttext"

    /// Warm account.json so the File Provider domain can register: syncFileProvider-
    /// Domain() needs a cached workspace handle, which a fresh sign-in does not yet
    /// have (the retired mirror engine's first pass used to populate it). A
    /// lightweight workspace fetch, no local writes; on success it drives the
    /// File Provider domain forward now that the identity is known.
    ///
    /// The GUI no longer has the mirror engine's 60s timer to auto-recover a
    /// transient sign-in fetch failure, so retry with bounded backoff; otherwise a
    /// single hiccup at sign-in would leave the user unsynced (no mount, no mirror)
    /// for the whole session. When identity is already cached, just (re)drive the
    /// domain - this also makes "Sync Now"/wake a recovery lever.
    private func seedCachedWorkspaceIfNeeded(attempt: Int = 0) {
        guard let credentials = store.loadCredentials() else { return }
        guard store.cachedWorkspace() == nil else {
            syncFileProviderDomain()
            return
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let client = ServerClient(
                origin: resolveServerOrigin(credentials: credentials),
                token: credentials.token)
            switch client.workspace() {
            case .success(let (_, data)):
                self.store.cacheWorkspace(data)
                DispatchQueue.main.async { [weak self] in
                    self?.syncFileProviderDomain()
                }
            case .failure(let error):
                DispatchQueue.main.async { [weak self] in
                    guard let self,
                          self.store.loadCredentials() != nil,
                          self.store.cachedWorkspace() == nil else { return }
                    guard attempt < 5 else {
                        self.appendActivity(
                            "Could not reach Texttext to set up sync (\(error.description)); "
                            + "use Sync Now to retry")
                        return
                    }
                    let delay = pow(2, Double(attempt)) // 1, 2, 4, 8, 16s
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                        self?.seedCachedWorkspaceIfNeeded(attempt: attempt + 1)
                    }
                }
            }
        }
    }

    /// Reconcile the single "Texttext" File Provider domain with sign-in + cached
    /// workspace state, and (re)publish the credential handoff for the extension.
    /// The app holds one workspace token today, so the handoff carries a
    /// one-element workspace list; the extension already fans out per handle, so
    /// joining more workspaces later just appends descriptors.
    private func syncFileProviderDomain(
        signalExistingDomain: Bool = false
    ) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.syncFileProviderDomain(
                    signalExistingDomain: signalExistingDomain)
            }
            return
        }
        guard let credentials = store.loadCredentials() else {
            removeFileProviderDomain()
            return
        }
        // A completed sync repopulates transient workspace metadata. Keep the
        // existing domain while that cache is unavailable so wake/focus cannot
        // turn a temporary read failure into a destructive Finder reimport.
        guard let blog = store.cachedWorkspace()?.blog,
              !blog.handle.isEmpty else { return }
        let origin = resolveServerOrigin(credentials: credentials).absoluteString
        let handoff = FileProviderHandoff(version: 1, workspaces: [
            WriteFileProviderKit.FileProviderWorkspace(
                name: blog.name.isEmpty ? blog.handle : blog.name,
                handle: blog.handle, origin: origin, token: credentials.token)
        ])
        let identity = [origin, blog.handle, blog.name, credentials.token]
            .joined(separator: "\u{0}")

        if fileProviderDesiredIdentity == identity {
            guard writeFileProviderHandoff(handoff) else {
                scheduleFileProviderRetry(identity: identity)
                return
            }
            if signalExistingDomain, registeredFileProviderDomain != nil {
                signalFileProviderChange()
            }
            return
        }

        fileProviderDesiredIdentity = identity
        fileProviderRemovalInFlight = false
        fileProviderDomainEpoch += 1
        let epoch = fileProviderDomainEpoch
        invalidateMaterialization()
        fileProviderRetry?.cancel()
        fileProviderRetry = nil
        fileProviderReconcileIdentity = identity

        guard writeFileProviderHandoff(handoff) else {
            fileProviderReconcileIdentity = nil
            appendActivity("File Provider credentials could not be published; retrying")
            scheduleFileProviderRetry(identity: identity)
            return
        }

        let identifier = NSFileProviderDomainIdentifier(rawValue: Self.fileProviderDomainId)
        NSFileProviderManager.getDomainsWithCompletionHandler { [weak self] domains, _ in
            DispatchQueue.main.async {
                guard let self,
                      self.fileProviderDomainEpoch == epoch,
                      self.fileProviderDesiredIdentity == identity else { return }
                // Only remove domains created by the old per-workspace scheme.
                // Other identifiers must never be treated as ours by accident.
                for domain in domains where domain.identifier.rawValue.hasPrefix("workspace-") {
                    self.removeFileProviderDomainPreservingLocalData(domain)
                }
                if let existing = domains.first(where: { $0.identifier == identifier }) {
                    // The domain is intentionally stable across app updates. An
                    // upgrade signals the existing cache; it never destroys the
                    // user's local replica or pending changes.
                    self.finishFileProviderReconcile(
                        domain: existing, handoff: handoff, epoch: epoch, identity: identity,
                        existingDomain: true)
                    return
                }
                self.addFileProviderDomain(
                    identifier: identifier, handoff: handoff,
                    epoch: epoch, identity: identity)
            }
        }
    }

    /// Legacy key (workspace name once labelled the mount); cleared on sign-out.
    private static let fpDomainNameKey = "fpDomainName"

    private func addFileProviderDomain(
        identifier: NSFileProviderDomainIdentifier, handoff: FileProviderHandoff,
        epoch: Int, identity: String
    ) {
        let domain = NSFileProviderDomain(
            identifier: identifier, displayName: Self.fileProviderDomainName)
        NSFileProviderManager.add(domain) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.fileProviderDomainEpoch == epoch,
                      self.fileProviderDesiredIdentity == identity else {
                    if error == nil, self.fileProviderDesiredIdentity == nil {
                        self.removeFileProviderDomainPreservingLocalData(domain)
                    }
                    return
                }
                if let error, (error as NSError).code != NSFileWriteFileExistsError {
                    self.appendActivity(
                        "File Provider register failed: \(error.localizedDescription)")
                    self.fileProviderReconcileIdentity = nil
                    self.scheduleFileProviderRetry(identity: identity)
                    return
                }
                self.finishFileProviderReconcile(
                    domain: domain, handoff: handoff, epoch: epoch, identity: identity,
                    existingDomain: false)
            }
        }
    }

    private func finishFileProviderReconcile(
        domain: NSFileProviderDomain, handoff: FileProviderHandoff,
        epoch: Int, identity: String, existingDomain: Bool
    ) {
        guard fileProviderDomainEpoch == epoch,
              fileProviderDesiredIdentity == identity else { return }
        guard writeFileProviderHandoff(handoff) else {
            fileProviderReconcileIdentity = nil
            scheduleFileProviderRetry(identity: identity)
            return
        }
        registeredFileProviderDomain = domain
        fileProviderStatusMonitor.bind(to: domain)
        fileProviderReconcileIdentity = nil
        if existingDomain, !handoff.workspaces.isEmpty,
           Self.needsFileProviderSchemaRepair(
            storedVersion: UserDefaults.standard.integer(
                forKey: Self.fileProviderSchemaVersionKey)
           ) {
            repairFileProviderSchema(
                domain: domain, handoff: handoff,
                epoch: epoch, identity: identity)
            return
        }
        UserDefaults.standard.set(
            Self.fileProviderSchemaVersion, forKey: Self.fileProviderSchemaVersionKey)
        signalFileProviderChange()
        scheduleFileProviderMaterialization(epoch: epoch, identity: identity)
    }

    static func needsFileProviderSchemaRepair(storedVersion: Int) -> Bool {
        storedVersion < fileProviderSchemaVersion
    }

    enum FileProviderSchemaRepairDecision: Equatable {
        case rebuildCache
        case waitForPendingItems
        case retry
    }

    static func fileProviderSchemaRepairDecision(
        pendingCount: Int, error: Error?
    ) -> FileProviderSchemaRepairDecision {
        if error != nil { return .retry }
        return pendingCount == 0 ? .rebuildCache : .waitForPendingItems
    }

    /// A representation migration can leave Finder's downloaded replica with
    /// old `.md` files while the provider now advertises `.textbundle` packages.
    /// Reimporting preserves those stale paths, so File Provider can never create
    /// the replacement items. Rebuild the disposable provider cache only after
    /// Finder confirms there are no pending local edits. The server-backed
    /// workspace remains authoritative and is materialized again immediately.
    private func repairFileProviderSchema(
        domain: NSFileProviderDomain, handoff: FileProviderHandoff,
        epoch: Int, identity: String, attempt: Int = 0
    ) {
        guard fileProviderDomainEpoch == epoch,
              fileProviderDesiredIdentity == identity,
              !fileProviderSchemaRepairInFlight else { return }
        guard let provider = SystemFileProviderStatusProvider(domain) else {
            scheduleFileProviderSchemaRepair(
                domain: domain, handoff: handoff,
                epoch: epoch, identity: identity, attempt: attempt + 1)
            return
        }
        fileProviderSchemaRepairRetry?.cancel()
        fileProviderSchemaRepairRetry = nil
        fileProviderSchemaRepairInFlight = true
        fileProviderSchemaPendingEnumeration = provider.enumeratePendingItems {
            [weak self] pendingCount, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.fileProviderSchemaPendingEnumeration = nil
                guard self.fileProviderDomainEpoch == epoch,
                      self.fileProviderDesiredIdentity == identity else { return }
                switch Self.fileProviderSchemaRepairDecision(
                    pendingCount: pendingCount, error: error
                ) {
                case .retry:
                    self.fileProviderSchemaRepairInFlight = false
                    self.appendActivity(
                        "Finder migration check failed: "
                        + (error?.localizedDescription ?? "Unknown error"))
                    self.scheduleFileProviderSchemaRepair(
                        domain: domain, handoff: handoff,
                        epoch: epoch, identity: identity,
                        attempt: attempt + 1)
                case .waitForPendingItems:
                    self.fileProviderSchemaRepairInFlight = false
                    self.appendActivity(
                        "Waiting for \(pendingCount) Finder change"
                        + (pendingCount == 1 ? "" : "s")
                        + " before upgrading the local cache")
                    self.signalFileProviderChange()
                    self.scheduleFileProviderSchemaRepair(
                        domain: domain, handoff: handoff,
                        epoch: epoch, identity: identity,
                        attempt: attempt + 1)
                case .rebuildCache:
                    self.rebuildFileProviderCache(
                        domain: domain, handoff: handoff,
                        epoch: epoch, identity: identity,
                        attempt: attempt)
                }
            }
        }
    }

    private func rebuildFileProviderCache(
        domain: NSFileProviderDomain, handoff: FileProviderHandoff,
        epoch: Int, identity: String, attempt: Int
    ) {
        NSFileProviderManager.remove(domain, mode: .removeAll) {
            [weak self] _, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.fileProviderSchemaRepairInFlight = false
                guard self.fileProviderDomainEpoch == epoch,
                      self.fileProviderDesiredIdentity == identity else { return }
                if let error {
                    self.appendActivity(
                        "Finder cache upgrade failed: \(error.localizedDescription)")
                    self.scheduleFileProviderSchemaRepair(
                        domain: domain, handoff: handoff,
                        epoch: epoch, identity: identity,
                        attempt: attempt + 1)
                    return
                }

                self.registeredFileProviderDomain = nil
                self.fileProviderStatusMonitor.unbind()
                self.fileProviderUserVisibleURL = nil
                self.invalidateMaterialization()
                UserDefaults.standard.set(
                    Self.fileProviderSchemaVersion,
                    forKey: Self.fileProviderSchemaVersionKey)
                self.appendActivity("Upgraded Finder's local Texttext cache")
                self.addFileProviderDomain(
                    identifier: domain.identifier, handoff: handoff,
                    epoch: epoch, identity: identity)
            }
        }
    }

    private func scheduleFileProviderSchemaRepair(
        domain: NSFileProviderDomain, handoff: FileProviderHandoff,
        epoch: Int, identity: String, attempt: Int
    ) {
        guard fileProviderDomainEpoch == epoch,
              fileProviderDesiredIdentity == identity else { return }
        fileProviderSchemaRepairRetry?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.repairFileProviderSchema(
                domain: domain, handoff: handoff,
                epoch: epoch, identity: identity, attempt: attempt)
        }
        fileProviderSchemaRepairRetry = work
        let delay = min(pow(2, Double(min(attempt, 4))), 30)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func scheduleFileProviderMaterialization(
        epoch: Int, identity: String, delay: TimeInterval = 2
    ) {
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.fileProviderDomainEpoch == epoch,
                  self.fileProviderDesiredIdentity == identity else { return }
            self.materializeWorkspace()
        }
        materializationRetry?.cancel()
        materializationRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func scheduleFileProviderRetry(identity: String) {
        guard fileProviderDesiredIdentity == identity else { return }
        fileProviderRetry?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.fileProviderDesiredIdentity == identity else { return }
            self.fileProviderDesiredIdentity = nil
            self.syncFileProviderDomain()
        }
        fileProviderRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    }

    private func removeFileProviderDomain() {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.removeFileProviderDomain() }
            return
        }
        guard !fileProviderRemovalInFlight else { return }
        fileProviderRemovalInFlight = true
        fileProviderDomainEpoch += 1
        let epoch = fileProviderDomainEpoch
        fileProviderDesiredIdentity = nil
        fileProviderReconcileIdentity = nil
        fileProviderRetry?.cancel()
        fileProviderRetry = nil
        fileProviderSchemaRepairRetry?.cancel()
        fileProviderSchemaRepairRetry = nil
        fileProviderSchemaPendingEnumeration?.cancel()
        fileProviderSchemaPendingEnumeration = nil
        fileProviderSchemaRepairInFlight = false
        invalidateMaterialization()
        registeredFileProviderDomain = nil
        fileProviderStatusMonitor.unbind()
        fileProviderUserVisibleURL = nil
        UserDefaults.standard.removeObject(forKey: Self.fileProviderSchemaVersionKey)
        UserDefaults.standard.removeObject(forKey: Self.fpDomainNameKey)
        FileProviderHandoffStore.clear()
        NSFileProviderManager.getDomainsWithCompletionHandler { [weak self] domains, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.fileProviderDomainEpoch == epoch else { return }
                self.fileProviderRemovalInFlight = false
                // Sign-out removes Write from Locations, but all downloaded files
                // and any dirty local edits are preserved by File Provider.
                for domain in domains where
                    domain.identifier.rawValue == Self.fileProviderDomainId
                    || domain.identifier.rawValue.hasPrefix("workspace-") {
                    self.removeFileProviderDomainPreservingLocalData(domain)
                }
            }
        }
    }

    private func removeFileProviderDomainPreservingLocalData(_ domain: NSFileProviderDomain) {
        NSFileProviderManager.remove(
            domain, mode: .preserveDownloadedUserData
        ) { [weak self] preservedLocation, error in
            guard let error else {
                if let preservedLocation {
                    self?.appendActivity(
                        "Preserved local Texttext files at \(preservedLocation.path)")
                }
                return
            }
            self?.appendActivity(
                "Could not remove old File Provider domain: \(error.localizedDescription)")
        }
    }

    /// Signal the registered domain that the workspace changed. Called from the
    /// app's existing long-poll; the long-poll lives here, not in the extension.
    private func signalFileProviderChange(serverReachable: Bool = false) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.signalFileProviderChange(serverReachable: serverReachable)
            }
            return
        }
        guard let domain = registeredFileProviderDomain,
              let manager = NSFileProviderManager(for: domain) else { return }
        if serverReachable {
            let error = NSError(
                domain: NSFileProviderErrorDomain,
                code: NSFileProviderError.serverUnreachable.rawValue)
            manager.signalErrorResolved(error) { _ in }
        }
        manager.signalEnumerator(for: .rootContainer) { _ in }
        manager.signalEnumerator(for: .workingSet) { _ in }
        if let workspace = store.cachedWorkspace() {
            let handle = workspace.blog.handle
            manager.signalEnumerator(
                for: NSFileProviderItemIdentifier(
                    rawValue: WriteItemIdentifier.workspace(handle).rawValue)
            ) { _ in }
            for folder in workspace.folders {
                manager.signalEnumerator(
                    for: NSFileProviderItemIdentifier(
                        rawValue: WriteItemIdentifier.folder(
                            handle: handle, id: folder.id
                        ).rawValue)
                ) { _ in }
            }
        }
        // A remote change can add files; keep the workspace fully downloaded.
        materializeWorkspace()
    }

    /// Keep the workspace materialized on disk instead of dataless cloud
    /// placeholders: walk every folder (root -> workspace -> system folders ->
    /// posts) and read each file so the system downloads it (a dataless File
    /// Provider file materializes on read). Off the main thread, coalesced, and
    /// retried on a delay: a COLD first enumeration right after a domain
    /// (re)register can time out and cache a folder as empty, so we re-drive the
    /// walk until the tree lists fully and no file is still dataless. We descend
    /// with contentsOfDirectory (which forces each folder's enumeration) rather
    /// than a lazy deep enumerator, so a folder that failed to list is retried
    /// even when it exposed no files to notice.
    private func materializeWorkspace(attempt: Int = 0, generation: Int? = nil) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.materializeWorkspace(attempt: attempt, generation: generation)
            }
            return
        }
        guard let domain = registeredFileProviderDomain,
              let manager = NSFileProviderManager(for: domain) else { return }
        let activeGeneration: Int
        if attempt == 0 {
            if isMaterializing { return }
            isMaterializing = true
            materializationEpoch += 1
            activeGeneration = materializationEpoch
        } else {
            guard let generation, generation == materializationEpoch else { return }
            activeGeneration = generation
        }
        manager.getUserVisibleURL(for: .rootContainer) { [weak self] rootURL, _ in
            DispatchQueue.main.async {
                guard let self, activeGeneration == self.materializationEpoch else { return }
                guard let root = rootURL else { self.isMaterializing = false; return }
                self.fileProviderUserVisibleURL = root
                // The mount is the sole content source now: (re)point Spotlight
                // at it here so the launch race and every remote change re-drive
                // indexing against the freshly-resolved root.
                self.configureSpotlightIndexing(root: root)
                self.refreshUI()
                DispatchQueue.global(qos: .utility).async {
                let scoped = root.startAccessingSecurityScopedResource()
                let incomplete = Self.warmAndMaterialize(root)
                if scoped { root.stopAccessingSecurityScopedResource() }
                DispatchQueue.main.async {
                    guard activeGeneration == self.materializationEpoch else { return }
                    if incomplete && attempt < 5 {
                        let work = DispatchWorkItem { [weak self] in
                            self?.materializeWorkspace(
                                attempt: attempt + 1, generation: activeGeneration)
                        }
                        self.materializationRetry?.cancel()
                        self.materializationRetry = work
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6, execute: work)
                    } else {
                        self.isMaterializing = false
                        self.materializationRetry = nil
                    }
                }
            }
            }
        }
    }

    private func invalidateMaterialization() {
        materializationEpoch += 1
        materializationRetry?.cancel()
        materializationRetry = nil
        isMaterializing = false
    }

    /// Walk the whole tree (a deep enumerator's readdir traversal forces each
    /// dataless folder to enumerate) and read every regular file or TextBundle
    /// package so all content and package assets stay available offline.
    /// Returns true if the tree still looks cold: nothing enumerated yet, or a
    /// file is still dataless after the read. The caller retries on that signal,
    /// which covers a cold first walk that reached only the top level before the
    /// deeper folders had enumerated.
    private static func warmAndMaterialize(_ root: URL) -> Bool {
        let fm = FileManager.default
        let coordinator = NSFileCoordinator()
        var files: [(url: URL, isPackage: Bool)] = []
        var containsLegacySidecar = false
        if let walker = fm.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey, .isPackageKey]) {
            for case let url as URL in walker {
                if url.pathExtension.lowercased() == "assets" {
                    containsLegacySidecar = true
                }
                let values = try? url.resourceValues(
                    forKeys: [.isRegularFileKey, .isPackageKey])
                let isPackage = values?.isPackage == true
                if values?.isRegularFile == true || isPackage {
                    files.append((url, isPackage))
                    if isPackage { walker.skipDescendants() }
                }
            }
        }
        var incomplete = files.isEmpty || containsLegacySidecar
        for file in files where isDataless(file.url) {
            var err: NSError?
            coordinator.coordinate(
                readingItemAt: file.url,
                options: file.isPackage ? .forUploading : [],
                error: &err
            ) { u in
                _ = try? Data(contentsOf: u) // reading downloads it
            }
            if isDataless(file.url) { incomplete = true }
        }
        return incomplete
    }

    /// Whether a File Provider file is still a dataless placeholder (SF_DATALESS
    /// in st_flags), i.e. its content has not been downloaded yet.
    private static func isDataless(_ url: URL) -> Bool {
        var st = stat()
        guard lstat(url.path, &st) == 0 else { return false }
        return (st.st_flags & UInt32(bitPattern: SF_DATALESS)) != 0
    }

    /// Publish the credential handoff to the shared keychain group the File
    /// Provider extension reads. Keychain, not the app-group container: a
    /// non-sandboxed app is blocked from writing a Group Container even when
    /// entitled (that write is sandbox-gated, EPERM), but the keychain is not.
    @discardableResult
    private func writeFileProviderHandoff(_ handoff: FileProviderHandoff) -> Bool {
        FileProviderHandoffStore.save(handoff)
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
            cfg.arguments = [Self.moveToApplicationsRelaunchArgument]
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
            NSLog("Texttext: login-item default enroll failed (will retry next launch): \(error)")
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
                button.title = "T"
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

        let finderStatus = fileProviderStatusMonitor.snapshot
        let finder = NSMenuItem(
            title: finderStatus.title, action: nil, keyEquivalent: "")
        finder.isEnabled = false
        finder.image = NSImage(
            systemSymbolName: finderStatus.symbolName,
            accessibilityDescription: finderStatus.title)
        menu.addItem(finder)
        let last = NSMenuItem(title: lastSyncLine(), action: nil, keyEquivalent: "")
        last.isEnabled = false
        menu.addItem(last)
        menu.addItem(.separator())

        // The primary action: the full workspace in a native window.
        let windowVisible = webWindow?.window?.isVisible == true
        menu.addItem(item(
            windowVisible ? "Hide Texttext" : "Open Texttext",
            #selector(toggleMainWindowAction),
            keyEquivalent: "w",
            modifiers: [.command, .shift]))
        menu.addItem(item(
            "New note", #selector(quickCaptureAction),
            keyEquivalent: " ", modifiers: [.command, .shift]))
        menu.addItem(item(
            "New bookmark", #selector(newBookmarkAction),
            keyEquivalent: "b", modifiers: [.command, .shift]))
        menu.addItem(item(
            "New note from clipboard", #selector(captureClipboardAction),
            keyEquivalent: "v", modifiers: [.command, .shift]))
        menu.addItem(.separator())

        let sync = item("Sync Now", #selector(syncNowAction))
        sync.isEnabled = store.loadCredentials() != nil
            && fileProviderStatusMonitor.snapshot.severity != .working
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

    private func item(
        _ title: String,
        _ selector: Selector,
        keyEquivalent: String = "",
        modifiers: NSEvent.ModifierFlags = []
    ) -> NSMenuItem {
        let i = NSMenuItem(
            title: title, action: selector, keyEquivalent: keyEquivalent)
        i.keyEquivalentModifierMask = modifiers
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
        // The File Provider mount is the sole writer, so its live status is the
        // sync status. (The full snapshot is also surfaced as finderStatus.)
        guard store.loadCredentials() != nil else { return "Not synced yet" }
        let snapshot = fileProviderStatusMonitor.snapshot
        switch snapshot.severity {
        case .working: return "Syncing now…"
        case .warning: return snapshot.detail.isEmpty ? snapshot.title : snapshot.detail
        case .healthy, .neutral:
            return snapshot.detail.isEmpty ? snapshot.title : snapshot.detail
        }
    }

    // MARK: Menu actions

    @objc private func syncNowAction() { requestSyncNow() }

    /// "Sync Now" from the menu/status window. The File Provider mount is the
    /// sole writer, so poll the server and re-materialize the mount. Also re-drives
    /// domain registration: if a transient sign-in fetch left the domain
    /// unregistered, this is the manual recovery lever.
    private func requestSyncNow() {
        seedCachedWorkspaceIfNeeded()
        changeListener?.nudge()
        signalFileProviderChange(serverReachable: true)
        retryQuickCaptureDrain()
    }

    @objc private func newNoteAction() {
        importExternalNote(ExternalNoteImport(
            title: "Untitled",
            body: "",
            representation: .textpack,
            idempotencyKey: "new-note:\(UUID().uuidString)"
        ))
    }

    @objc private func openFolderAction() {
        // Only ever open the File Provider mount (the sole location now). Never
        // create/open a legacy `~/Write` mirror.
        if let fileProviderUserVisibleURL {
            NSWorkspace.shared.open(fileProviderUserVisibleURL)
            return
        }
        guard let domain = registeredFileProviderDomain,
              let manager = NSFileProviderManager(for: domain) else {
            appendActivity(store.loadCredentials() == nil
                ? "Sign in to open your Texttext folder"
                : "Texttext folder is still setting up; try again in a moment")
            materializeWorkspace()
            return
        }
        manager.getUserVisibleURL(for: .rootContainer) { [weak self] url, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if let url {
                    self.fileProviderUserVisibleURL = url
                    NSWorkspace.shared.open(url)
                } else {
                    self.appendActivity(
                        "Texttext folder is still setting up; try again in a moment")
                    self.materializeWorkspace()
                }
            }
        }
    }

    @objc private func openBlogAction() {
        guard let blog = store.cachedWorkspace()?.blog else { return }
        let origin = resolveServerOrigin(credentials: store.loadCredentials())
        if let url = URL(string: "\(origin.absoluteString)/t/\(blog.handle)") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func showMainWindowAction() { showMainWindow() }

    @objc private func toggleMainWindowAction() {
        if webWindow?.window?.isVisible == true {
            webWindow?.hide()
        } else {
            showMainWindow()
        }
    }

    @objc private func showStatusWindowAction() { showStatusWindow() }

    @objc private func signInAction() { signIn() }

    @objc private func reopenApprovalAction() { linkController.reopenApproval() }

    @objc private func reloadWebWindowAction() { webWindow?.reloadFromOrigin() }

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
    private func showMainWindow(path: String? = nil) {
        if webWindow == nil {
            let credentials = store.loadCredentials()
            let origin = resolveServerOrigin(credentials: credentials)
            webWindow = WebAppWindowController(
                origin: origin,
                startPath: path ?? "/start?to=home",
                needsToken: credentials == nil,
                onLinked: { [weak self] token, linkedOrigin in
                    self?.handleAppLinked(token: token, origin: linkedOrigin)
                })
        } else if let path {
            webWindow?.load(path: path)
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
            tokenName: "Texttext on \(device)",
            linkedAt: Date()))
        appendActivity("Linked this Mac")
        // Fetch+cache the workspace, then register the File Provider domain
        // (the sole writer); no legacy mirror pass.
        seedCachedWorkspaceIfNeeded()
        captureAgent.poke()
        // Drain anything shared before this Mac was linked.
        retryShareInboxDrain()
        retryQuickCaptureDrain()
        let pending = pendingExternalImports
        pendingExternalImports.removeAll()
        for item in pending { importExternalNote(item) }
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
                openFolder: { [weak self] in self?.openFolderAction() },
                syncNow: { [weak self] in self?.requestSyncNow() },
                makeDefaultMarkdown: { [weak self] in self?.makeWriteDefaultForMarkdown() }
            ))
        }
        refreshUI()
        NSApp.activate(ignoringOtherApps: true)
        statusWindow?.showWindow(nil)
        statusWindow?.window?.makeKeyAndOrderFront(nil)
    }

    private func appendActivity(_ message: String) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.appendActivity(message) }
            return
        }
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
            folderPath: fileProviderUserVisibleURL?.path ?? "Texttext in Finder",
            folderStatus: "All Markdown files are kept on this Mac.",
            lastSyncLine: lastSyncLine(),
            finderStatus: fileProviderStatusMonitor.snapshot,
            busy: fileProviderStatusMonitor.snapshot.severity == .working,
            activity: activityLog,
            isDefaultForMarkdown: MarkdownDefaultHandler.isDefault()
        ))
    }

    /// Make Write the system default for .md files (from the status window). No
    /// prompt: Launch Services just updates the binding, like a browser claiming
    /// the default. Reflect success/failure in the activity log + button state.
    private func makeWriteDefaultForMarkdown() {
        MarkdownDefaultHandler.makeDefault { [weak self] error in
            DispatchQueue.main.async {
                if let error {
                    self?.appendActivity("Could not set Texttext as the .md default: \(error.localizedDescription)")
                } else {
                    self?.appendActivity("Texttext is now the default app for .md files")
                }
                self?.refreshUI()
            }
        }
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

        let fileItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        main.addItem(fileItem)
        let file = NSMenu(title: "File")
        fileItem.submenu = file
        let newNote = file.addItem(withTitle: "New Note", action: #selector(newNoteAction), keyEquivalent: "n")
        newNote.target = self

        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        editItem.submenu = edit
        _ = edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        _ = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        _ = edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        _ = edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        _ = edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        _ = edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        main.addItem(viewItem)
        let view = NSMenu(title: "View")
        viewItem.submenu = view
        let reload = view.addItem(withTitle: "Reload", action: #selector(reloadWebWindowAction), keyEquivalent: "r")
        reload.target = self

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
