import AppKit
import CoreSpotlight
import FileProvider
import ServiceManagement
import WriteEditor
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
    private var editorWindows: [URL: EditorWindowController] = [:]
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
    // Pushes local Finder edits on the FP mount to the server instantly (the OS
    // uploads them on its own slow schedule otherwise).
    private let mountBridge = MountBridge()

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
            self?.signalFileProviderChange()
            // A server edit does not move the mount, so nudge the bridge to pull
            // it into the local files promptly (evict + re-download).
            self?.mountBridge.nudge()
        }
        changeListener.start()
        captureAgent.start()

        // Instant folder -> server: watch the File Provider mount and push local
        // Finder edits (rename, folder rename, content edit, move) immediately,
        // rather than waiting on the OS's File Provider upload scheduler. Started
        // from materializeWorkspace once the mount root is known.
        mountBridge.makeContext = { [weak self] in
            guard let self, let credentials = self.store.loadCredentials(),
                  let blog = self.store.cachedWorkspace()?.blog, !blog.handle.isEmpty else { return nil }
            let api = LiveWriteSyncAPI(
                origin: resolveServerOrigin(credentials: credentials), token: credentials.token)
            return MountBridge.Context(
                api: api, handle: blog.handle,
                workspaceName: blog.name.isEmpty ? blog.handle : blog.name)
        }
        mountBridge.onActivity = { [weak self] message in self?.appendActivity(message) }

        showMainWindow() // open the workspace window on launch
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "write-app" {
            openWriteItemURL(url)
        }
        let fileURLs = urls.filter { $0.scheme != "write-app" }
        guard !fileURLs.isEmpty else { return }
        let unhandled = OpenFileHandler.open(urls: fileURLs, store: store, syncRoot: syncRoot()) { [weak self] url in
            self?.openEditorWindow(for: url) ?? false
        }
        if !unhandled.isEmpty {
            appendActivity("Could not open \(unhandled.count) file(s): not in the Write folder")
        }
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
        if wasBusy && !busy { scheduleSpotlightReindex() }
        wasBusy = busy
        refreshUI()
        // The workspace handle only becomes known after the first sync caches it,
        // so this is the natural place to reconcile the File Provider domain.
        syncFileProviderDomain()
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
        setWorkspaceLocation(WorkspaceRootResolver(overrideRoot: url).resolve())
        appendActivity("Sync folder is now \(url.path)")
        engine.resetForNewRoot()
        configureSpotlightIndexing()
        configureShareInbox()
        refreshUI()
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
        openWriteItem(id: id)
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
                let unhandled = OpenFileHandler.open(
                    urls: [target], store: self.store, syncRoot: root
                ) { [weak self] url in
                    self?.openEditorWindow(for: url) ?? false
                }
                if !unhandled.isEmpty {
                    self.showMainWindow()
                    NSWorkspace.shared.activateFileViewerSelecting([target])
                }
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
    private func syncFileProviderDomain() {
        guard let credentials = store.loadCredentials(),
              let blog = store.cachedWorkspace()?.blog,
              !blog.handle.isEmpty else {
            removeFileProviderDomain()
            return
        }
        let origin = resolveServerOrigin(credentials: credentials).absoluteString
        let handoff = FileProviderHandoff(version: 1, workspaces: [
            WriteFileProviderKit.FileProviderWorkspace(
                name: blog.name.isEmpty ? blog.handle : blog.name,
                handle: blog.handle, origin: origin, token: credentials.token)
        ])
        writeFileProviderHandoff(handoff)

        let identifier = NSFileProviderDomainIdentifier(rawValue: Self.fileProviderDomainId)
        NSFileProviderManager.getDomainsWithCompletionHandler { [weak self] domains, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                // Migrate + de-dup: exactly one "write" domain. Remove every other
                // domain we own (the legacy per-workspace "workspace-<handle>"
                // ones) so the upgrade does not leave a second Locations entry.
                for domain in domains where domain.identifier != identifier {
                    NSFileProviderManager.remove(domain) { _ in }
                }
                let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
                let lastBuild = UserDefaults.standard.string(forKey: Self.fpDomainBuildKey)
                if let existing = domains.first(where: { $0.identifier == identifier }) {
                    // A new build can render enumeration differently (the system
                    // holds a cache); refresh by remove + re-add. Otherwise keep
                    // the domain but re-arm it: republish the handoff and signal,
                    // so a relaunch reconnects with zero Finder clicks.
                    if lastBuild == build {
                        self.registeredFileProviderDomain = existing
                        self.writeFileProviderHandoff(handoff)
                        if let manager = NSFileProviderManager(for: existing) {
                            manager.signalEnumerator(for: .rootContainer) { _ in }
                            manager.signalEnumerator(for: .workingSet) { _ in }
                        }
                        self.materializeWorkspace()
                        return
                    }
                    NSFileProviderManager.remove(existing) { _ in
                        DispatchQueue.main.async {
                            self.addFileProviderDomain(
                                identifier: identifier, handoff: handoff, build: build)
                        }
                    }
                    return
                }
                self.addFileProviderDomain(identifier: identifier, handoff: handoff, build: build)
            }
        }
    }

    /// UserDefaults key for the app build that last registered the FP domain, so
    /// a new build (enumeration cache) triggers a refreshing remove + re-add.
    private static let fpDomainBuildKey = "fpDomainBuild"
    /// Legacy key (workspace name once labelled the mount); cleared on sign-out.
    private static let fpDomainNameKey = "fpDomainName"

    private func addFileProviderDomain(
        identifier: NSFileProviderDomainIdentifier, handoff: FileProviderHandoff, build: String
    ) {
        let domain = NSFileProviderDomain(
            identifier: identifier, displayName: Self.fileProviderDomainName)
        NSFileProviderManager.add(domain) { error in
            DispatchQueue.main.async {
                if let error, (error as NSError).code != NSFileWriteFileExistsError {
                    self.appendActivity(
                        "File Provider register failed: \(error.localizedDescription)")
                    return
                }
                self.registeredFileProviderDomain = domain
                UserDefaults.standard.set(build, forKey: Self.fpDomainBuildKey)
                // The extension may have launched before the handoff landed;
                // re-publish and nudge it to enumerate.
                self.writeFileProviderHandoff(handoff)
                if let manager = NSFileProviderManager(for: domain) {
                    manager.signalEnumerator(for: .rootContainer) { _ in }
                    manager.signalEnumerator(for: .workingSet) { _ in }
                }
                // Download the whole workspace so it is present locally by default,
                // after a moment for the first enumeration to populate the tree.
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                    self?.materializeWorkspace()
                }
            }
        }
    }

    private func removeFileProviderDomain() {
        NSFileProviderManager.getDomainsWithCompletionHandler { domains, _ in
            // Remove the current "write" domain AND any legacy per-workspace one,
            // so sign-out never leaves an orphaned (empty) Locations entry.
            for domain in domains where
                domain.identifier.rawValue == Self.fileProviderDomainId
                || domain.identifier.rawValue.hasPrefix("workspace-") {
                NSFileProviderManager.remove(domain) { _ in }
            }
        }
        registeredFileProviderDomain = nil
        mountBridge.stop()
        UserDefaults.standard.removeObject(forKey: Self.fpDomainBuildKey)
        UserDefaults.standard.removeObject(forKey: Self.fpDomainNameKey)
        FileProviderHandoffStore.clear()
    }

    /// Signal the registered domain that the workspace changed. Called from the
    /// app's existing long-poll; the long-poll lives here, not in the extension.
    private func signalFileProviderChange() {
        guard let domain = registeredFileProviderDomain else { return }
        NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet) { _ in }
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
    private func materializeWorkspace(attempt: Int = 0) {
        guard let domain = registeredFileProviderDomain,
              let manager = NSFileProviderManager(for: domain) else { return }
        if attempt == 0 {
            if isMaterializing { return }
            isMaterializing = true
        }
        manager.getUserVisibleURL(for: .rootContainer) { [weak self] rootURL, _ in
            guard let self else { return }
            guard let root = rootURL else { self.isMaterializing = false; return }
            // The mount root is known now: start the instant-push watcher (idempotent).
            self.mountBridge.start(mountRoot: root, manager: manager)
            DispatchQueue.global(qos: .utility).async {
                let scoped = root.startAccessingSecurityScopedResource()
                let incomplete = Self.warmAndMaterialize(root)
                if scoped { root.stopAccessingSecurityScopedResource() }
                DispatchQueue.main.async {
                    if incomplete && attempt < 5 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
                            self?.materializeWorkspace(attempt: attempt + 1)
                        }
                    } else {
                        self.isMaterializing = false
                    }
                }
            }
        }
    }
    private var isMaterializing = false

    /// Walk the whole tree (a deep enumerator's readdir traversal forces each
    /// dataless folder to enumerate) and read every `.md` so it downloads.
    /// Returns true if the tree still looks cold: nothing enumerated yet, or a
    /// file is still dataless after the read. The caller retries on that signal,
    /// which covers a cold first walk that reached only the top level before the
    /// deeper folders had enumerated.
    private static func warmAndMaterialize(_ root: URL) -> Bool {
        let fm = FileManager.default
        let coordinator = NSFileCoordinator()
        var files: [URL] = []
        if let walker = fm.enumerator(
            at: root, includingPropertiesForKeys: [.isRegularFileKey]) {
            for case let url as URL in walker where url.pathExtension == "md" {
                files.append(url)
            }
        }
        var incomplete = files.isEmpty // nothing enumerated yet -> retry
        for fileURL in files where isDataless(fileURL) {
            var err: NSError?
            coordinator.coordinate(readingItemAt: fileURL, options: [], error: &err) { u in
                _ = try? Data(contentsOf: u) // reading downloads it
            }
            if isDataless(fileURL) { incomplete = true }
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
    private func writeFileProviderHandoff(_ handoff: FileProviderHandoff) {
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

    @objc private func newNoteAction() {
        do {
            let url = try EditorNoteCreator.createUntitledNote(in: syncRoot())
            _ = openEditorWindow(for: url)
        } catch {
            appendActivity("Could not create note: \(error.localizedDescription)")
        }
    }

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

    @discardableResult
    private func openEditorWindow(for url: URL) -> Bool {
        let key = url.standardizedFileURL
        if let existing = editorWindows[key] {
            existing.present()
            return true
        }

        do {
            let controller = try EditorWindowController(
                fileURL: key,
                workspaceRootURL: syncRoot(),
                onClose: { [weak self] closedURL in
                    self?.editorWindows.removeValue(forKey: closedURL.standardizedFileURL)
                }
            )
            editorWindows[key] = controller
            controller.present()
            return true
        } catch {
            appendActivity("Could not open \(url.lastPathComponent): \(error.localizedDescription)")
            return false
        }
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
            folderStatus: currentWorkspaceLocation()?.statusMessage,
            lastSyncLine: lastSyncLine(),
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
