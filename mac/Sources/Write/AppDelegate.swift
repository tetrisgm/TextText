import AppKit
import CoreSpotlight
import FileProvider
import ServiceManagement
import WriteFileProviderKit
import WriteShareCore
import WriteSpotlight
import WriteWorkspaceCore

/// Regular Dock app + a menu-bar status item (menu rebuilt on open, the
/// partyparty shape; SwiftUI MenuBarExtra is deliberately avoided). The app
/// is never walled behind sign-in: the local folder opens and edits fine
/// signed out; only sync waits for a link.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static let syncRootKey = "WriteSyncRootPath"
    private static let workspaceMigrationAppliedKey = "WriteWorkspaceICloudPhase1MigrationApplied"
    private static let loginItemAppliedKey = "WriteLoginItemDefaultApplied"
    private static let productionBundleIdentifier = "net.writeapp.write.mac"
    private static let moveToApplicationsRelaunchArgument = "--write-moved-to-applications"
    private static let duplicateInstanceRecheckDelay: TimeInterval = 0.5
    static let fileProviderSchemaVersion = 9
    private static let fileProviderSchemaVersionKey = "WriteFileProviderSchemaVersion"

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
    private var sharingServicePicker: NSSharingServicePicker?
    private let openFileQueue = DispatchQueue(
        label: "com.example.write.mac.open-files", qos: .userInitiated)
    private var pendingExternalImports: [ExternalNoteImport] = []
    // Spotlight state is owned by spotlightQueue exclusively; the main
    // thread only ever schedules work onto it.
    private var spotlightIndexer: WorkspaceSpotlightIndexer?
    private var spotlightWatcher: WorkspaceFolderWatcher?
    private var spotlightIndexRootPath: String?
    private var spotlightIndexedIds = Set<String>()
    private var spotlightIndexedHashes: [String: String] = [:]
    private let spotlightQueue = DispatchQueue(label: "com.example.write.mac.spotlight", qos: .utility)
    private var spotlightDebounce: DispatchWorkItem?
    private var shareInboxWatcher: WorkspaceFolderWatcher?
    private var shareContainerAppearanceWatcher: WorkspaceFolderWatcher?
    private var shareInboxDebounce: DispatchWorkItem?
    private let shareInboxQueue = DispatchQueue(label: "com.example.write.mac.share-inbox", qos: .utility)
    private var activityLog: [String] = []
    private var wasBusy = false
    private let workspaceLocationLock = NSLock()
    private var workspaceLocation: WorkspaceLocation?
    // The one File Provider domain registered for the signed-in workspace, if any.
    private var registeredFileProviderDomain: NSFileProviderDomain?
    private let fileProviderStatusMonitor = FileProviderStatusMonitor()
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
            updater = Updater(isBusy: { [weak self] in self?.engine?.isSyncing ?? false })
        }
        registerLoginItemByDefault()
        NSApp.mainMenu = buildMainMenu()

        linkController = LinkController(store: store)
        setWorkspaceLocation(syncRootLocation())
        migrateLegacySyncFolderIfNeeded()
        if let workspaceLocation = currentWorkspaceLocation(), !workspaceLocation.iCloudAvailable {
            appendActivity(workspaceLocation.statusMessage)
        }
        engine = SyncEngine(store: store)
        engine.makeClient = { [weak self] in
            guard let self, let credentials = self.store.loadCredentials() else { return nil }
            return ServerClient(origin: resolveServerOrigin(credentials: credentials),
                                token: credentials.token)
        }
        engine.syncRootProvider = { [weak self] in self?.syncRoot() ?? Self.defaultSyncRoot() }
        engine.workspaceLocationProvider = { [weak self] in self?.currentWorkspaceLocation() ?? self?.syncRootLocation() }
        engine.onActivity = { [weak self] message in self?.appendActivity(message) }
        engine.onStateChange = { [weak self] in self?.syncStateChanged() }
        engine.onPassCompleted = { [weak self] summary in
            self?.syncPassCompleted(summary)
        }
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
        configureSpotlightIndexing()
        configureShareInbox()
        syncFileProviderDomain()

        // Near-instant remote sync: a change on the web (edit, delete, new
        // bookmark) triggers a pass within seconds; the engine's 60s timer
        // stays as the fallback. The capture agent rides the same signal.
        captureAgent = CaptureAgent(store: store)
        captureAgent.onActivity = { [weak self] message in self?.appendActivity(message) }
        changeListener = ChangeListener(store: store)
        changeListener.onRemoteChange = { [weak self] in
            self?.engine.syncNow()
            self?.captureAgent.poke()
            self?.signalFileProviderChange(serverReachable: true)
        }
        changeListener.start()
        captureAgent.start()

        fileProviderStatusMonitor.onChange = { [weak self] _ in
            self?.refreshUI()
        }

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
        let root = syncRoot()
        for url in fileURLs {
            switch OpenFileHandler.kind(for: url, syncRoot: root) {
            case .workspace:
                resolveAndOpenManagedFile(url)
            case .external:
                openExternalOrFileProviderItem(url)
            case .unsupported:
                appendActivity("Could not open \(url.lastPathComponent): unsupported file type")
            }
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
                        "Could not match \(url.lastPathComponent) to a Write item")
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
                self?.engine.syncNow()
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
        changeListener?.nudge()
        engine?.syncNow()
        captureAgent?.poke()
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
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.syncStateChanged() }
            return
        }
        let busy = engine.isSyncing
        // An update Sparkle offered mid-pass was deferred; the moment the
        // engine goes idle, let it surface.
        if wasBusy && !busy { updater?.busyDidEnd() }
        if wasBusy && !busy { scheduleSpotlightReindex() }
        wasBusy = busy
        refreshUI()
    }

    private func syncPassCompleted(_ summary: SyncSummary) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in
                self?.syncPassCompleted(summary)
            }
            return
        }
        // The workspace identity is first known after a completed pass. Signal
        // an existing domain only when that exact pass changed mirrored content;
        // ordinary focus/resume passes keep Finder's current presentation.
        syncFileProviderDomain(
            signalExistingDomain: Self.shouldSignalFileProviderAfterSync(summary))
    }

    static func shouldSignalFileProviderAfterSync(_ summary: SyncSummary) -> Bool {
        summary.pulled > 0 || summary.pushed > 0 || summary.conflicts > 0
    }

    // MARK: Sync root

    static func defaultSyncRoot() -> URL {
        WorkspaceRootResolver().resolve().url
    }

    private func syncRootLocation() -> WorkspaceLocation {
        if let path = UserDefaults.standard.string(forKey: Self.syncRootKey), !path.isEmpty {
            let url = URL(fileURLWithPath: path, isDirectory: true)
            return WorkspaceRootResolver(overrideRoot: url).resolve()
        }
        return WorkspaceRootResolver().resolve()
    }

    private func syncRoot() -> URL {
        if let location = currentWorkspaceLocation() {
            return location.url
        }
        let location = syncRootLocation()
        setWorkspaceLocation(location)
        return location.url
    }

    private func currentWorkspaceLocation() -> WorkspaceLocation? {
        workspaceLocationLock.lock()
        defer { workspaceLocationLock.unlock() }
        return workspaceLocation
    }

    private func setWorkspaceLocation(_ location: WorkspaceLocation?) {
        workspaceLocationLock.lock()
        workspaceLocation = location
        workspaceLocationLock.unlock()
    }

    private func migrateLegacySyncFolderIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.workspaceMigrationAppliedKey) else { return }
        if let custom = defaults.string(forKey: Self.syncRootKey), !custom.isEmpty {
            defaults.set(true, forKey: Self.workspaceMigrationAppliedKey)
            appendActivity("Keeping custom sync folder \(custom)")
            return
        }
        let destinationLocation = currentWorkspaceLocation() ?? syncRootLocation()
        guard destinationLocation.kind != .documentsFallback else {
            return
        }
        let destination = destinationLocation.url
        let legacy = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Write", isDirectory: true)
        if legacy.standardizedFileURL.path == destination.standardizedFileURL.path {
            return
        }
        let summary = WorkspaceMigrator.migrateLegacyMirror(
            from: legacy,
            to: destination,
            workspace: store.cachedWorkspace().map(descriptor(for:))
        )
        if summary.errors.isEmpty {
            defaults.set(true, forKey: Self.workspaceMigrationAppliedKey)
        }
        if summary.moved + summary.adopted + summary.conflicts > 0 {
            appendActivity("Adopted legacy sync folder into \(destination.path)")
        }
        for message in summary.errors.prefix(3) {
            appendActivity("Workspace migration issue: \(message)")
        }
    }

    private func descriptor(for workspace: Workspace) -> WorkspaceDescriptor {
        WorkspaceDescriptor(
            blog: WorkspaceBlogDescriptor(handle: workspace.blog.handle, name: workspace.blog.name),
            folders: workspace.folders.map {
                WorkspaceFolderDescriptor(
                    id: $0.id,
                    name: $0.name,
                    path: $0.path,
                    mode: $0.mode,
                    parentId: $0.parentId
                )
            }
        )
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

    private func drainShareInbox(containerURL: URL) {
        let root = syncRoot()
        let reader = InboxReader(containerURL: containerURL)
        let records: [InboxRecord]
        do {
            records = try reader.completeItems()
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.appendActivity("Share inbox read failed: \(error.localizedDescription)")
            }
            return
        }
        guard !records.isEmpty else { return }

        let filer = InboxFiler(root: root)
        var filed = 0
        for record in records {
            do {
                _ = try filer.file(record)
                try reader.deleteConsumed(record)
                filed += 1
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.appendActivity("Share inbox filing failed: \(error.localizedDescription)")
                }
            }
        }
        guard filed > 0 else { return }
        DispatchQueue.main.async { [weak self] in
            self?.appendActivity("Filed \(filed) shared item\(filed == 1 ? "" : "s")")
            self?.engine.syncNow()
            self?.scheduleSpotlightReindex()
            self?.refreshUI()
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

    private func configureSpotlightIndexing() {
        let root = syncRoot()
        spotlightQueue.async { [weak self] in
            guard let self else { return }
            let rootPath = root.standardizedFileURL.path
            self.spotlightWatcher?.stop()
            self.spotlightIndexer = WorkspaceSpotlightIndexer(root: root)
            self.spotlightIndexRootPath = rootPath
            self.spotlightIndexedHashes = [:]
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

    /// spotlightQueue only. Incremental: the engine's index is the source of
    /// truth (it reflects server state, so evicted or unreadable local files
    /// can never look like deletions), and only added, changed, or removed
    /// ids are submitted rather than the whole workspace on every event.
    private func refreshSpotlightIndex() {
        guard let indexer = spotlightIndexer else { return }
        let entries = store.loadIndex().entries
        let currentIds = Set(entries.keys)
        let removed = spotlightIndexedIds.subtracting(currentIds)
        var changed: [String: IndexEntry] = [:]
        for (id, entry) in entries where spotlightIndexedHashes[id] != entry.hash {
            changed[id] = entry
        }
        if !removed.isEmpty { indexer.remove(ids: Array(removed)) }
        if !changed.isEmpty { indexer.reindex(entries: changed) }
        spotlightIndexedIds = currentIds
        spotlightIndexedHashes = entries.mapValues(\.hash)
        let persisted = SpotlightPersistedState(
            rootPath: spotlightIndexRootPath ?? "",
            indexedIds: Array(currentIds)
        )
        if let data = try? JSONEncoder().encode(persisted) {
            try? data.write(to: spotlightStateURL, options: .atomic)
        }
    }

    /// Main thread. Resolution happens off-main and only through the known
    /// indexes: the scheme is invokable by any app on the system, so an
    /// unknown id must cost a dictionary miss, never a workspace scan.
    private func openWriteItemURL(_ url: URL) {
        guard url.host == "item",
              url.pathComponents.count == 2,
              let id = url.pathComponents.last else {
            appendActivity("Ignored malformed Write link \(url.absoluteString)")
            return
        }
        guard isValidWriteItemId(id) else {
            appendActivity("Ignored Write link with an invalid item id")
            return
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let action = query.first(where: { $0.name == "action" })?.value
        if let action {
            guard let rawTarget = query.first(where: { $0.name == "url" })?.value,
                  let target = validatedWriteWebURL(rawTarget) else {
                appendActivity("Ignored Write action with an invalid target")
                return
            }
            switch action {
            case "share":
                presentSharePicker(for: target)
            case "manage-access":
                presentAccessManagement(for: target)
            default:
                appendActivity("Ignored unknown Write action \(action)")
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
            appendActivity("Copied the Write link")
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

    private func openWriteItem(id: String) {
        guard isValidWriteItemId(id) else {
            appendActivity("Ignored Write link with an invalid item id")
            return
        }
        let root = syncRoot()
        spotlightQueue.async { [weak self] in
            guard let self else { return }
            var target: URL?
            if let entry = self.store.loadIndex().entries[id] {
                let candidate = root.appendingPathComponent(entry.relativePath)
                if FileManager.default.fileExists(atPath: candidate.path) { target = candidate }
            }
            if target == nil, let entry = WorkspaceIndexStore.load(root: root)?.entries[id] {
                let candidate = root.appendingPathComponent(entry.relativePath)
                if FileManager.default.fileExists(atPath: candidate.path) { target = candidate }
            }
            DispatchQueue.main.async {
                guard let target else {
                    self.appendActivity("No item found for Write link")
                    return
                }
                self.resolveAndOpenManagedFile(target)
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
        engine.resetForSignOut()
        removeFileProviderDomain()
        appendActivity("Signed out; local files kept")
        refreshUI()
    }

    // MARK: File Provider domain

    /// One stable "Write" File Provider domain now spans every workspace: the
    /// root lists a folder per workspace, so the Finder Locations entry is a
    /// single "Write" and the workspace name lives on the folder inside it.
    private static let fileProviderDomainId = "write"
    private static let fileProviderDomainName = "Write"

    /// Reconcile the single "Write" File Provider domain with sign-in + cached
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
                self.appendActivity("Upgraded Finder's local Write cache")
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
                        "Preserved local Write files at \(preservedLocation.path)")
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
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        switch engine.status {
        case .syncing:
            return "Syncing now…"
        case .error(let count, let retryScheduled):
            let noun = count == 1 ? "error" : "errors"
            let when = engine.lastSyncAt.map {
                " \(formatter.localizedString(for: $0, relativeTo: Date()))"
            } ?? ""
            let retry = retryScheduled ? ", retrying" : ""
            return "Sync failed\(when) (\(count) \(noun)\(retry))"
        case .idle:
            guard let at = engine.lastSyncAt else { return "Not synced yet" }
            return "Last sync \(formatter.localizedString(for: at, relativeTo: Date()))"
        }
    }

    // MARK: Menu actions

    @objc private func syncNowAction() { engine.syncNow() }

    @objc private func newNoteAction() {
        importExternalNote(ExternalNoteImport(
            title: "Untitled",
            body: "",
            representation: .textbundle,
            idempotencyKey: "new-note:\(UUID().uuidString)"
        ))
    }

    @objc private func openFolderAction() {
        if let fileProviderUserVisibleURL {
            NSWorkspace.shared.open(fileProviderUserVisibleURL)
            return
        }
        if let domain = registeredFileProviderDomain,
           let manager = NSFileProviderManager(for: domain) {
            manager.getUserVisibleURL(for: .rootContainer) { [weak self] url, _ in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let url {
                        self.fileProviderUserVisibleURL = url
                        NSWorkspace.shared.open(url)
                    } else {
                        self.openLocalMirrorFolder()
                    }
                }
            }
            return
        }
        openLocalMirrorFolder()
    }

    private func openLocalMirrorFolder() {
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
            tokenName: "Write.app on \(device)",
            linkedAt: Date()))
        appendActivity("Linked this Mac")
        engine.syncNow()
        captureAgent.poke()
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
                syncNow: { [weak self] in self?.engine.syncNow() },
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
            folderPath: fileProviderUserVisibleURL?.path ?? "Write in Finder",
            folderStatus: "All Markdown files are kept on this Mac.",
            lastSyncLine: lastSyncLine(),
            finderStatus: fileProviderStatusMonitor.snapshot,
            busy: engine.isSyncing,
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
                    self?.appendActivity("Could not set Write as the .md default: \(error.localizedDescription)")
                } else {
                    self?.appendActivity("Write is now the default app for .md files")
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
