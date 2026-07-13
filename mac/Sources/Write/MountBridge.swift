import CryptoKit
import FileProvider
import Foundation
import os
import WriteFileProviderKit
import WriteWorkspaceCore

/// Trace the two-way mount reconcile. Read on the owner's Mac with:
///   /usr/bin/log show --last 10m --predicate 'subsystem == "net.writeapp.write"
///     AND category == "mountbridge"' --info --style compact
/// Every decision (push title / pull / push body / folder rename) logs the exact
/// values it compared, so a sync loop or a rename that did not stick is legible
/// without guessing. Titles are logged .public (the owner's own content, on the
/// owner's machine) so the strings are not redacted.
private let bridgeLog = Logger(subsystem: "net.writeapp.write", category: "mountbridge")

/// Keeps the File Provider mount and the server in sync FAST in BOTH directions,
/// because macOS does it on its own slow, deprioritized schedule. It watches the
/// mount and, on any local or remote change, reconciles each post:
///  - a local Finder edit (rename / body edit / move) is PUSHED to the server
///    (PATCH title, PUT content, PATCH folder);
///  - a server edit (made in the app) is PULLED into the mount by evicting the
///    stale local copy so the File Provider re-downloads it fresh.
///
/// Direction is decided by a per-post BASELINE: the title and body both sides
/// last agreed on. If only the mount moved off an axis it is pushed; if only the
/// server moved it is pulled. If both moved, the local file is preserved and the
/// provider is asked to re-enumerate. MountBridge never evicts an item while any
/// local axis is uncommitted or conflict-preserved. It never deletes and never
/// creates (the File Provider still owns those).
final class MountBridge: @unchecked Sendable {
    struct Context { let api: WriteSyncAPI; let handle: String; let workspaceName: String }
    struct ProviderOperations: @unchecked Sendable {
        let evictItem: (
            NSFileProviderItemIdentifier, @escaping ((any Error)?) -> Void
        ) -> Void
        let signalEnumerator: (
            NSFileProviderItemIdentifier, @escaping ((any Error)?) -> Void
        ) -> Void

        init(_ manager: NSFileProviderManager) {
            evictItem = { manager.evictItem(identifier: $0, completionHandler: $1) }
            signalEnumerator = { manager.signalEnumerator(for: $0, completionHandler: $1) }
        }

        init(
            evictItem: @escaping (
                NSFileProviderItemIdentifier, @escaping ((any Error)?) -> Void
            ) -> Void,
            signalEnumerator: @escaping (
                NSFileProviderItemIdentifier, @escaping ((any Error)?) -> Void
            ) -> Void
        ) {
            self.evictItem = evictItem
            self.signalEnumerator = signalEnumerator
        }
    }

    struct TestingState {
        let generation: UInt64
        let pendingPullCount: Int
    }

    /// Rebuilt per pass, so a sign in/out needs no plumbing here.
    var makeContext: () -> Context? = { nil }
    var onActivity: ((String) -> Void)?
    /// Called after a pull evicts a stale local file, to re-download it promptly.
    var onRefresh: (() -> Void)?

    private let queue = DispatchQueue(label: "net.writeapp.write.mountbridge", qos: .utility)
    private var watcher: WorkspaceFolderWatcher?
    private var debounce: DispatchWorkItem?
    private var mountRoot: URL?
    private var provider: ProviderOperations?
    private var inFlight = false
    private var pending = false
    private var generation: UInt64 = 0
    private var session: Session?
    private var reconcileTask: Task<Void, Never>?

    // Test seams retain production defaults.
    var watchesFileSystem = true
    var debounceDelay: TimeInterval = 0.4
    var retryLimit = 6
    var retryBaseDelay: TimeInterval = 0.75
    var providerIdentifierResolver: (URL) async -> WriteItemIdentifier? = {
        await MountBridge.systemProviderIdentifier(for: $0)
    }
    var onPassFinished: ((UInt64) -> Void)?

    private struct Baseline: Equatable { var title: String; var body: String }
    private struct LocalSnapshot: Equatable {
        let filename: String
        let title: String
        let body: String
        let full: String
    }
    private struct PendingPull {
        let target: Baseline
        let base: Baseline
        let source: LocalSnapshot
    }
    private struct FolderState {
        var agreedName: String
        var pendingRemoteName: String?
    }
    private struct RetryState { var fingerprint: String; var attempts: Int; var notBefore: Date }
    private enum RetryDecision { case exhausted, scheduled(TimeInterval) }
    private final class Session: @unchecked Sendable {
        let generation: UInt64
        var handle: String?
        var baseline: [String: Baseline] = [:]
        var folderState: [String: FolderState] = [:]
        var rejected: [String: String] = [:]
        var pendingPull: [String: PendingPull] = [:]
        var retryState: [String: RetryState] = [:]
        private let stateLock = NSLock()
        private var active = true

        init(generation: UInt64, handle: String?) {
            self.generation = generation
            self.handle = handle
        }

        func deactivate() {
            stateLock.lock()
            active = false
            stateLock.unlock()
        }

        @discardableResult
        func withState<T>(_ body: (Session) -> T) -> T? {
            stateLock.lock()
            defer { stateLock.unlock() }
            guard active else { return nil }
            return body(self)
        }
    }

    struct SyncPlan: Equatable {
        let pushTitle: Bool
        let pushBody: Bool
        let pullAfterPushes: Bool
        let preserveConflict: Bool
        let localDirty: Bool
    }

    static func syncPlan(
        baseline: (title: String, body: String),
        local: (title: String, body: String),
        server: (title: String, body: String),
        canonicalNameMismatch: Bool
    ) -> SyncPlan {
        let localTitleMoved = local.title != baseline.title
        let serverTitleMoved = server.title != baseline.title
        let localBodyMoved = local.body != baseline.body
        let serverBodyMoved = server.body != baseline.body
        // Both sides moving to the same value is convergence, not a conflict.
        // Only preserve when an axis moved away from the baseline in two
        // different directions.
        let conflict = (localTitleMoved && serverTitleMoved && local.title != server.title)
            || (localBodyMoved && serverBodyMoved && local.body != server.body)
        return SyncPlan(
            pushTitle: localTitleMoved && !serverTitleMoved && !conflict,
            pushBody: localBodyMoved && !serverBodyMoved && !conflict,
            pullAfterPushes: !conflict && (
                (serverTitleMoved && !localTitleMoved)
                    || (serverBodyMoved && !localBodyMoved)
                    || (canonicalNameMismatch && !localTitleMoved)
            ),
            preserveConflict: conflict,
            localDirty: localTitleMoved || localBodyMoved
        )
    }

    static func needsCanonicalFilename(
        _ filename: String, serverTitle: String, slug: String, stableId: String
    ) -> Bool {
        if WriteFilename.isCanonicalFilename(
            filename, title: serverTitle, slug: slug, stableId: stableId) {
            return false
        }
        // A different decoded title is a semantic edit and belongs to the title
        // axis. This helper only normalizes an equivalent but non-portable path.
        return WriteFilename.titleFromFilename(filename, stableId: stableId) == serverTitle
    }

    static func canonicalCollisionFilename(
        serverTitle: String, slug: String, stableId: String
    ) -> String {
        WriteFilename.collisionFilename(
            title: serverTitle, slug: slug, stableId: stableId)
    }

    func start(mountRoot root: URL, manager: NSFileProviderManager) {
        start(mountRoot: root, provider: ProviderOperations(manager))
    }

    func start(mountRoot root: URL, provider: ProviderOperations) {
        queue.async { [weak self] in
            guard let self else { return }
            if self.mountRoot == root, self.session != nil {
                self.provider = provider
                self.installWatcherIfNeeded(root: root)
                self.scheduleOnQueue()
                return
            }
            self.debounce?.cancel()
            self.watcher?.stop()
            self.mountRoot = root
            self.provider = provider
            self.replaceSession(handle: nil)
            self.installWatcherIfNeeded(root: root)
            self.scheduleOnQueue()
        }
    }

    func stop() {
        queue.async { [weak self] in
            self?.debounce?.cancel()
            self?.watcher?.stop()
            self?.watcher = nil
            self?.mountRoot = nil
            self?.provider = nil
            self?.invalidateSession()
        }
    }

    /// Poke a pass. Wired to the app's remote-change signal so a server edit is
    /// pulled into the mount promptly (the mount itself does not fire FSEvents
    /// when only the server changed).
    func nudge() { queue.async { [weak self] in self?.scheduleOnQueue() } }

    private func installWatcherIfNeeded(root: URL) {
        guard watchesFileSystem, watcher == nil else { return }
        watcher = WorkspaceFolderWatcher(
            path: root.path, queue: queue,
            includeUbiquitousItems: false, latency: 0.3
        ) { [weak self] in self?.scheduleOnQueue() }
    }

    private func replaceSession(handle: String?) {
        generation &+= 1
        session?.deactivate()
        reconcileTask?.cancel()
        reconcileTask = nil
        inFlight = false
        pending = false
        session = Session(generation: generation, handle: handle)
    }

    private func invalidateSession() {
        generation &+= 1
        session?.deactivate()
        reconcileTask?.cancel()
        reconcileTask = nil
        inFlight = false
        pending = false
        session = nil
    }

    private func scheduleOnQueue(after delay: TimeInterval? = nil) {
        debounce?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.run() }
        debounce = work
        queue.asyncAfter(deadline: .now() + (delay ?? debounceDelay), execute: work)
    }

    private func scheduleRetry(
        session: Session, postId: String, fingerprint: String, reason: String
    ) {
        guard isActive(session) else { return }
        guard let decision = session.withState({ session -> RetryDecision in
            var state = session.retryState[postId]
            if state?.fingerprint != fingerprint {
                state = RetryState(
                    fingerprint: fingerprint, attempts: 0, notBefore: .distantPast)
            }
            guard var state, state.attempts < retryLimit else { return .exhausted }
            state.attempts += 1
            let delay = min(30.0, retryBaseDelay * pow(2.0, Double(state.attempts - 1)))
            state.notBefore = Date().addingTimeInterval(delay)
            session.retryState[postId] = state
            return .scheduled(delay)
        }) else { return }
        guard case .scheduled(let delay) = decision else {
            bridgeLog.error("retry[\(postId, privacy: .public)] exhausted for \(reason, privacy: .public)")
            return
        }
        bridgeLog.info("retry[\(postId, privacy: .public)] \(reason, privacy: .public) in \(delay, privacy: .public)s")
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.session === session else { return }
            self.scheduleOnQueue(after: 0)
        }
    }

    private func isBackedOff(
        session: Session, postId: String, fingerprint: String
    ) -> Bool {
        session.withState { session in
            guard let state = session.retryState[postId],
                  state.fingerprint == fingerprint else { return false }
            return state.notBefore > Date()
        } ?? false
    }

    private func clearRetry(_ session: Session, _ postId: String) {
        session.withState { $0.retryState.removeValue(forKey: postId) }
    }

    private func run() {
        guard let root = mountRoot, let provider, let ctx = makeContext() else { return }
        if let handle = session?.handle, handle != ctx.handle {
            replaceSession(handle: ctx.handle)
        } else if session == nil {
            replaceSession(handle: ctx.handle)
        } else {
            session?.handle = ctx.handle
        }
        guard let session else { return }
        if inFlight { pending = true; return }
        inFlight = true
        let task = Task { [weak self] in
            await self?.reconcile(
                root: root, provider: provider, ctx: ctx, session: session)
            self?.queue.async {
                guard let self, self.session === session else { return }
                self.reconcileTask = nil
                self.inFlight = false
                self.onPassFinished?(session.generation)
                if self.pending { self.pending = false; self.run() }
            }
        }
        reconcileTask = task
    }

    private func isActive(_ candidate: Session) -> Bool {
        guard !Task.isCancelled else { return false }
        return queue.sync {
            session === candidate && mountRoot != nil && provider != nil
        }
    }

    func testingState() -> TestingState {
        queue.sync {
            TestingState(
                generation: generation,
                pendingPullCount: session?.withState { $0.pendingPull.count } ?? 0)
        }
    }

    // MARK: The pass

    private struct ServerPost {
        let postId: String
        let folderId: String
        let slug: String
        let title: String
    }

    private struct ServerSnapshot {
        let postId: String
        let folderId: String
        let slug: String
        var title: String
        var hash: String
        let body: String
    }

    private static func mountedEntries(at root: URL) -> (directories: [URL], files: [URL]) {
        var directories: [URL] = []
        var files: [URL] = []
        let keys: [URLResourceKey] = [.isDirectoryKey]
        if let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: keys
        ) {
            for case let url as URL in walker {
                let isDirectory = (try? url.resourceValues(forKeys: Set(keys)))?.isDirectory ?? false
                if isDirectory { directories.append(url) }
                else if url.pathExtension == "md" { files.append(url) }
            }
        }
        return (directories, files)
    }

    private func reconcile(
        root: URL, provider: ProviderOperations, ctx: Context, session: Session
    ) async {
        guard isActive(session) else { return }
        let api = ctx.api
        let workspaceResult = await api.workspace()
        guard isActive(session) else { return }
        guard case .success(let ws) = workspaceResult else {
            queue.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self, self.session === session else { return }
                self.scheduleOnQueue(after: 0)
            }
            return
        }
        var bySlug: [String: ServerPost] = [:]
        var byId: [String: ServerPost] = [:]
        var folderName: [String: String] = [:]
        for folder in ws.folders {
            guard isActive(session) else { return }
            folderName[folder.id] = folder.name
            let manifestResult = await api.manifest(folderId: folder.id)
            guard isActive(session) else { return }
            if case .success(let items) = manifestResult {
                for item in items where (item.id ?? "").isEmpty == false {
                    let post = ServerPost(
                        postId: item.id!, folderId: folder.id, slug: item.slug, title: item.title)
                    bySlug[item.slug] = post
                    byId[post.postId] = post
                }
            }
        }

        let entries = Self.mountedEntries(at: root)
        guard isActive(session) else { return }
        let dirs = entries.directories
        let files = entries.files

        bridgeLog.info("reconcile: \(files.count, privacy: .public) files, \(dirs.count, privacy: .public) dirs, \(ws.folders.count, privacy: .public) server folders")

        // Folder names use the same two-sided baseline as files. A stale mounted
        // name following a remote rename is held until File Provider applies the
        // new server name; only a local-only move away from an agreed name is
        // proven Finder rename intent and may be pushed.
        for dir in dirs {
            guard isActive(session) else { return }
            let name = dir.lastPathComponent
            guard dir != root else { continue }
            guard let fid = await folderId(
                for: dir, handle: ctx.handle,
                validFolderIds: Set(folderName.keys), bySlug: bySlug
            ) else {
                // Provider identity handles normal empty, dataless, and renamed
                // folders. This can still fail for a legacy path that predates a
                // provider identifier and has no readable child to vote with.
                if name != root.lastPathComponent {
                    bridgeLog.info("folder '\(name, privacy: .public)': unresolved legacy identity; rename deferred")
                }
                continue
            }
            guard isActive(session) else { return }
            let serverName = folderName[fid] ?? "?"
            let prior: FolderState? = session.withState { $0.folderState[fid] } ?? nil
            let localName = Self.mountedComponentValue(
                name, stableId: fid,
                knownValues: [serverName, prior?.agreedName, prior?.pendingRemoteName]
                    .compactMap { $0 })
            guard !localName.isEmpty else { continue }

            if localName == serverName {
                session.withState {
                    $0.folderState[fid] = FolderState(
                        agreedName: serverName, pendingRemoteName: nil)
                }
                continue
            }
            guard var state = prior else {
                session.withState {
                    $0.folderState[fid] = FolderState(
                        agreedName: serverName, pendingRemoteName: serverName)
                }
                bridgeLog.info("folder '\(localName, privacy: .public)': first-sight mismatch; server name remains authoritative")
                requestProviderRefresh(provider: provider, session: session)
                continue
            }
            if state.pendingRemoteName != nil {
                state.pendingRemoteName = serverName
                session.withState { $0.folderState[fid] = state }
                requestProviderRefresh(provider: provider, session: session)
                continue
            }

            let localMoved = localName != state.agreedName
            let serverMoved = serverName != state.agreedName
            if localMoved && !serverMoved {
                guard isActive(session) else { return }
                let result = await api.renameFolder(folderId: fid, name: localName)
                guard isActive(session) else { return }
                switch result {
                case .success:
                    session.withState {
                        $0.folderState[fid] = FolderState(
                            agreedName: localName, pendingRemoteName: nil)
                    }
                    bridgeLog.info("folder-rename fid=\(fid, privacy: .public) '\(serverName, privacy: .public)' -> '\(localName, privacy: .public)': OK")
                    emitActivity("Renamed folder to \(localName)", session: session)
                case .failure(let error):
                    bridgeLog.error("folder-rename fid=\(fid, privacy: .public) '\(serverName, privacy: .public)' -> '\(localName, privacy: .public)': FAILED \(String(describing: error), privacy: .public)")
                }
            } else if serverMoved {
                state.pendingRemoteName = serverName
                session.withState { $0.folderState[fid] = state }
                bridgeLog.info("folder-rename fid=\(fid, privacy: .public): remote name '\(serverName, privacy: .public)' wins over stale/local '\(localName, privacy: .public)'")
                requestProviderRefresh(provider: provider, session: session)
            }
        }

        for file in files {
            guard isActive(session) else { return }
            if Self.isDataless(file) { continue }
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            let post: ServerPost
            if let identity = await providerIdentifier(for: file) {
                guard isActive(session) else { return }
                guard case .file(let handle, let id) = identity,
                      handle == ctx.handle, let identified = byId[id] else {
                    bridgeLog.error("file '\(file.lastPathComponent, privacy: .public)': provider identity does not match this workspace snapshot")
                    continue
                }
                post = identified
            } else {
                let frontmatterSlug = MountFrontmatter.value(text, "slug") ?? ""
                guard let structural = bySlug[frontmatterSlug] else { continue }
                post = structural
            }
            let slug = post.slug

            let name = file.lastPathComponent
            let mountBody = Self.sha256(MountFrontmatter.stripTitle(text))
            let mountFull = Self.sha256(text)
            let contentResult = await api.fileText(postId: post.postId)
            guard isActive(session) else { return }
            guard case .success(let content) = contentResult,
                  let contentHash = content.hash, !contentHash.isEmpty else {
                let fingerprint = "snapshot:\(post.postId):\(mountFull)"
                scheduleRetry(
                    session: session, postId: post.postId,
                    fingerprint: fingerprint, reason: "missing fresh snapshot")
                continue
            }
            var snapshot = ServerSnapshot(
                postId: post.postId, folderId: post.folderId, slug: slug,
                title: MountFrontmatter.value(content.text, "title") ?? post.title,
                hash: contentHash,
                body: Self.sha256(MountFrontmatter.stripTitle(content.text)))
            let remembered = session.withState { session in
                (
                    baseline: session.baseline[post.postId]?.title,
                    pendingBase: session.pendingPull[post.postId]?.base.title,
                    pendingTarget: session.pendingPull[post.postId]?.target.title,
                    pendingSource: session.pendingPull[post.postId]?.source.title
                )
            }
            let knownTitles = [
                snapshot.title,
                remembered?.baseline,
                remembered?.pendingBase,
                remembered?.pendingTarget,
                remembered?.pendingSource,
            ].compactMap { $0 }
            let filenameTitle = Self.mountedFileTitle(
                name, slug: snapshot.slug, stableId: snapshot.postId,
                knownTitles: knownTitles)
            let local = LocalSnapshot(
                filename: name, title: filenameTitle,
                body: mountBody, full: mountFull)
            let canonicalNameMismatch = Self.needsCanonicalFilename(
                name, serverTitle: snapshot.title, slug: snapshot.slug,
                stableId: snapshot.postId)
            let fingerprint = [mountFull, snapshot.hash, name, snapshot.title].joined(separator: "\n")
            if isBackedOff(
                session: session, postId: post.postId, fingerprint: fingerprint) {
                continue
            }

            var recoveredBase: Baseline?
            let pending: PendingPull? = session.withState {
                $0.pendingPull[post.postId]
            } ?? nil
            if let pendingPull = pending {
                let currentServer = Baseline(title: snapshot.title, body: snapshot.body)
                if filenameTitle == currentServer.title, mountBody == currentServer.body {
                    // The server may have advanced again while File Provider was
                    // materializing. Accept the newest snapshot rather than wait
                    // forever for an intermediate target that can no longer land.
                    session.withState {
                        $0.baseline[post.postId] = currentServer
                        $0.pendingPull.removeValue(forKey: post.postId)
                    }
                    clearRetry(session, post.postId)
                    bridgeLog.info("pull[\(slug, privacy: .public)] mount reached latest server state")
                    continue
                } else if filenameTitle == pendingPull.target.title,
                          mountBody == pendingPull.target.body {
                    session.withState {
                        $0.baseline[post.postId] = pendingPull.target
                        $0.pendingPull.removeValue(forKey: post.postId)
                    }
                    clearRetry(session, post.postId)
                    bridgeLog.info("pull[\(slug, privacy: .public)] mount reached target")
                    continue
                } else if local.filename != pendingPull.source.filename
                            || local.full != pendingPull.source.full {
                    // File Provider has not landed the requested target, but the
                    // materialized local file moved after eviction. Treat those
                    // bytes as a fresh local side of the original baseline. The
                    // normal planner below will either make a safe cross-axis
                    // push or preserve a same-axis conflict; it will not evict.
                    session.withState {
                        $0.pendingPull.removeValue(forKey: post.postId)
                        $0.baseline[post.postId] = pendingPull.base
                    }
                    clearRetry(session, post.postId)
                    recoveredBase = pendingPull.base
                    bridgeLog.error("pull[\(slug, privacy: .public)] local file changed while provider pull was pending; converting to normal conflict planning")
                } else {
                    requestProviderRefresh(provider: provider, session: session)
                    scheduleRetry(
                        session: session, postId: post.postId,
                        fingerprint: fingerprint, reason: "waiting for provider pull")
                    continue
                }
            }

            let base: Baseline
            if let recoveredBase {
                base = recoveredBase
            } else if let existing = session.withState({ $0.baseline[post.postId] }) ?? nil {
                base = existing
            } else {
                if filenameTitle == snapshot.title, mountBody == snapshot.body {
                    let agreed = Baseline(title: snapshot.title, body: snapshot.body)
                    session.withState { $0.baseline[post.postId] = agreed }
                    clearRetry(session, post.postId)
                    base = agreed
                } else {
                    // With no prior baseline, divergence has unknown provenance.
                    // Pulling could erase a Finder edit; pushing could erase an app
                    // edit. Preserve the local file and let File Provider reconcile.
                    bridgeLog.error("first-sight[\(slug, privacy: .public)] divergent local/server state preserved")
                    requestProviderRefresh(provider: provider, session: session)
                    scheduleRetry(
                        session: session, postId: post.postId,
                        fingerprint: fingerprint, reason: "first-sight divergence")
                    continue
                }
            }

            let plan = Self.syncPlan(
                baseline: (base.title, base.body),
                local: (filenameTitle, mountBody),
                server: (snapshot.title, snapshot.body),
                // Normalize equivalent non-portable spelling, while accepting
                // the mapper's exact stable-identity collision spelling.
                canonicalNameMismatch: canonicalNameMismatch)
            bridgeLog.info("plan[\(slug, privacy: .public)] title=\(plan.pushTitle ? "push" : "hold", privacy: .public) body=\(plan.pushBody ? "push" : "hold", privacy: .public) pull=\(plan.pullAfterPushes, privacy: .public) conflict=\(plan.preserveConflict, privacy: .public)")

            if plan.preserveConflict {
                requestProviderRefresh(provider: provider, session: session)
                scheduleRetry(
                    session: session, postId: post.postId,
                    fingerprint: fingerprint, reason: "local/server conflict preserved")
                continue
            }

            var committed = base
            var mutationFailed = false
            if plan.pushTitle {
                guard isActive(session) else { return }
                switch await api.patchFile(
                    postId: post.postId, folderId: nil, slug: nil,
                    title: filenameTitle, ifMatch: snapshot.hash) {
                case .success(let saved) where !saved.hash.isEmpty:
                    guard isActive(session) else { return }
                    snapshot.hash = saved.hash
                    snapshot.title = filenameTitle
                    committed.title = filenameTitle
                    emitActivity("Renamed to \(filenameTitle)", session: session)
                case .success:
                    guard isActive(session) else { return }
                    mutationFailed = true
                    bridgeLog.error("title[\(slug, privacy: .public)] PUSH returned no hash")
                case .failure(let error):
                    guard isActive(session) else { return }
                    mutationFailed = true
                    bridgeLog.error("title[\(slug, privacy: .public)] PUSH failed: \(String(describing: error), privacy: .public)")
                }
            }

            if !mutationFailed, plan.pushBody {
                if session.withState({ $0.rejected[post.postId] == mountFull }) ?? false {
                    mutationFailed = true
                    bridgeLog.info("content[\(slug, privacy: .public)] skipped (already rejected)")
                } else {
                    guard isActive(session) else { return }
                    switch await api.putFile(
                        postId: post.postId,
                        body: MountFrontmatter.setTitle(text, snapshot.title),
                        ifMatch: snapshot.hash) {
                    case .success(let saved) where !saved.hash.isEmpty:
                        guard isActive(session) else { return }
                        snapshot.hash = saved.hash
                        committed.body = mountBody
                        session.withState { $0.rejected.removeValue(forKey: post.postId) }
                        emitActivity("Synced edits", session: session)
                    case .success:
                        guard isActive(session) else { return }
                        mutationFailed = true
                        bridgeLog.error("content[\(slug, privacy: .public)] PUSH returned no hash")
                    case .failure(.rejected):
                        guard isActive(session) else { return }
                        mutationFailed = true
                        session.withState { $0.rejected[post.postId] = mountFull }
                        bridgeLog.error("content[\(slug, privacy: .public)] PUSH rejected (400), backing off")
                    case .failure(let error):
                        guard isActive(session) else { return }
                        mutationFailed = true
                        bridgeLog.error("content[\(slug, privacy: .public)] PUSH failed: \(String(describing: error), privacy: .public)")
                    }
                }
            }

            if mutationFailed {
                // Preserve any axis that did commit, but never pull while another
                // local axis remains uncommitted.
                session.withState { $0.baseline[post.postId] = committed }
                scheduleRetry(
                    session: session, postId: post.postId,
                    fingerprint: fingerprint, reason: "guarded mutation failed")
                continue
            }

            let target = Baseline(
                title: plan.pushTitle ? filenameTitle : snapshot.title,
                body: plan.pushBody ? mountBody : snapshot.body)
            clearRetry(session, post.postId)
            if plan.pullAfterPushes {
                session.withState {
                    $0.baseline[post.postId] = committed
                    $0.pendingPull[post.postId] = PendingPull(
                        target: target, base: committed, source: local)
                }
                let result = await pull(
                    file: file, expectedLocal: local, post: snapshot,
                    handle: ctx.handle, provider: provider, session: session)
                guard isActive(session) else { return }
                switch result {
                case .evicted:
                    break
                case .localChanged:
                    session.withState {
                        $0.pendingPull.removeValue(forKey: post.postId)
                        $0.baseline[post.postId] = committed
                    }
                    clearRetry(session, post.postId)
                    scheduleCurrentPass(session: session)
                case .failed:
                    session.withState {
                        $0.pendingPull.removeValue(forKey: post.postId)
                        $0.baseline[post.postId] = committed
                    }
                    scheduleRetry(
                        session: session, postId: post.postId, fingerprint: fingerprint,
                        reason: "provider eviction failed")
                case .cancelled:
                    return
                }
            } else {
                session.withState { $0.baseline[post.postId] = target }
            }
        }
    }

    /// Pull a server edit into the mount: evict the stale local copy so the File
    /// Provider drops the old bytes and re-fetches. This is needed because a file
    /// that is already downloaded-but-stale has no other trigger to refresh.
    /// Items normally use `downloadEagerlyAndKeepDownloaded` for fast local reads,
    /// so this controlled eviction is followed immediately by re-enumeration and
    /// re-materialization. Safe: the caller has committed every local movement or
    /// proved that the local axis is unchanged from the baseline, and `pull` reads
    /// the local bytes once more immediately before asking File Provider to evict.
    private enum PullResult { case evicted, localChanged, failed, cancelled }

    private func pull(
        file: URL,
        expectedLocal: LocalSnapshot,
        post: ServerSnapshot,
        handle: String,
        provider: ProviderOperations,
        session: Session
    ) async -> PullResult {
        guard isActive(session) else { return .cancelled }
        let identifier = NSFileProviderItemIdentifier(
            rawValue: WriteItemIdentifier.file(handle: handle, id: post.postId).rawValue)
        bridgeLog.info("pull[\(post.postId, privacy: .public)] evict + re-materialize '\(post.title, privacy: .public)'")

        // This synchronous read is deliberately the last file operation before
        // eviction. The planner's earlier snapshot is not sufficient: a Finder
        // edit can land while the server GET or a preceding guarded push awaits.
        guard !Self.isDataless(file),
              file.lastPathComponent == expectedLocal.filename,
              let currentText = try? String(contentsOf: file, encoding: .utf8),
              Self.sha256(currentText) == expectedLocal.full else {
            bridgeLog.info("pull[\(post.postId, privacy: .public)] local file changed after planning; eviction cancelled")
            return .localChanged
        }
        guard !Task.isCancelled else { return .cancelled }

        let error: (any Error)? = await withCheckedContinuation { continuation in
            var started = false
            queue.sync {
                guard self.session === session, self.mountRoot != nil else { return }
                started = true
                provider.evictItem(identifier) { continuation.resume(returning: $0) }
            }
            if !started { continuation.resume(returning: CancellationError()) }
        }
        guard isActive(session) else { return .cancelled }
        guard error == nil else {
            bridgeLog.error("pull[\(post.postId, privacy: .public)] eviction failed: \(String(describing: error), privacy: .public)")
            return .failed
        }
        requestProviderRefresh(provider: provider, session: session)
        emitActivity("Updated \(post.title) from the app", session: session)
        return .evicted
    }

    private func requestProviderRefresh(
        provider: ProviderOperations, session: Session
    ) {
        queue.sync {
            guard self.session === session, self.mountRoot != nil else { return }
            provider.signalEnumerator(.workingSet) { _ in }
            onRefresh?()
        }
    }

    private func emitActivity(_ message: String, session: Session) {
        queue.sync {
            guard self.session === session, self.mountRoot != nil else { return }
            onActivity?(message)
        }
    }

    private func scheduleCurrentPass(session: Session) {
        queue.async { [weak self] in
            guard let self, self.session === session else { return }
            self.scheduleOnQueue(after: 0)
        }
    }

    private static func mountedComponentValue(
        _ component: String, stableId: String, knownValues: [String]
    ) -> String {
        if let known = knownValues.first(where: {
            WriteFilename.isCanonicalComponent(
                component, value: $0, stableId: stableId)
        }) {
            return known
        }
        var raw = component
        let suffix = WriteFilename.collisionSuffix(stableId)
        if raw.hasSuffix(suffix) { raw.removeLast(suffix.count) }
        return WriteFilename.decodeComponent(raw)
    }

    private static func mountedFileTitle(
        _ filename: String, slug: String, stableId: String, knownTitles: [String]
    ) -> String {
        if let known = knownTitles.first(where: {
            WriteFilename.isCanonicalFilename(
                filename, title: $0, slug: slug, stableId: stableId)
        }) {
            return known
        }
        return WriteFilename.titleFromFilename(filename, stableId: stableId)
    }

    private func providerIdentifier(for url: URL) async -> WriteItemIdentifier? {
        await providerIdentifierResolver(url)
    }

    private static func systemProviderIdentifier(for url: URL) async -> WriteItemIdentifier? {
        await withCheckedContinuation { continuation in
            NSFileProviderManager.getIdentifierForUserVisibleFile(at: url) { identifier, _, _ in
                continuation.resume(returning: identifier.flatMap {
                    WriteItemIdentifier(rawValue: $0.rawValue)
                })
            }
        }
    }

    private func folderId(
        for dir: URL,
        handle: String,
        validFolderIds: Set<String>,
        bySlug: [String: ServerPost],
        excluding: String? = nil
    ) async -> String? {
        // Provider identity is authoritative even for an empty or renamed folder.
        // The structural vote is only a compatibility fallback for a path that has
        // not yet been assigned an identifier by File Provider.
        if let identity = await providerIdentifier(for: dir) {
            guard case .folder(let itemHandle, let id) = identity,
                  itemHandle == handle, validFolderIds.contains(id) else {
                bridgeLog.error("folder '\(dir.lastPathComponent, privacy: .public)': provider identity does not match this workspace snapshot")
                return nil
            }
            return id
        }
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: nil) else { return nil }
        var votes: [String: Int] = [:]
        for entry in entries where entry.pathExtension == "md" {
            guard let text = try? String(contentsOf: entry, encoding: .utf8),
                  let slug = MountFrontmatter.value(text, "slug"),
                  let post = bySlug[slug], post.postId != excluding else { continue }
            votes[post.folderId, default: 0] += 1
        }
        return votes.max { $0.value < $1.value }?.key
    }

    static func sha256(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func isDataless(_ url: URL) -> Bool {
        var st = stat()
        guard lstat(url.path, &st) == 0 else { return false }
        return (st.st_flags & UInt32(bitPattern: SF_DATALESS)) != 0
    }
}

/// Minimal frontmatter surgery for the mount files, mirroring the server's
/// render (src/lib/markdown-files.ts): a `---` fence, one `key: <scalar>` per
/// line where a scalar is JSON-quoted or bare.
enum MountFrontmatter {
    /// The scalar value for a frontmatter key (JSON string or bare), or nil.
    static func value(_ text: String, _ key: String) -> String? {
        guard let lines = frontmatterLines(text) else { return nil }
        let prefix = key + ":"
        for line in lines where line.hasPrefix(prefix) {
            let raw = String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            if raw.hasPrefix("\"") {
                if let data = raw.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(String.self, from: data) {
                    return decoded
                }
                return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            }
            return raw
        }
        return nil
    }

    /// The file with transport-owned frontmatter removed, for a content
    /// signature that ignores title-only and revision-only differences.
    static func stripTitle(_ text: String) -> String {
        guard text.hasPrefix("---\n") else { return text }
        var out: [String] = []
        var inFrontmatter = false
        for (index, line) in lines(text).enumerated() {
            if index == 0, line == "---" { inFrontmatter = true; out.append(line); continue }
            if inFrontmatter, line == "---" { inFrontmatter = false; out.append(line); continue }
            if inFrontmatter,
               line.hasPrefix("title:") || line.hasPrefix("syncRevision:") {
                continue
            }
            out.append(line)
        }
        return out.joined(separator: "\n")
    }

    /// The file with the frontmatter `title:` value rewritten (JSON-encoded).
    static func setTitle(_ text: String, _ title: String) -> String {
        guard text.hasPrefix("---\n") else { return text }
        var rows = lines(text)
        var inFrontmatter = false
        for index in rows.indices {
            let line = rows[index]
            if index == 0, line == "---" { inFrontmatter = true; continue }
            if inFrontmatter, line == "---" { break }
            if inFrontmatter, line.hasPrefix("title:") { rows[index] = "title: " + json(title); break }
        }
        return rows.joined(separator: "\n")
    }

    private static func lines(_ text: String) -> [String] {
        text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private static func frontmatterLines(_ text: String) -> [String]? {
        guard text.hasPrefix("---\n") else { return nil }
        let rest = text.dropFirst(4)
        guard let end = rest.range(of: "\n---") else { return nil }
        return rest[rest.startIndex..<end.lowerBound]
            .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private static func json(_ value: String) -> String {
        if let data = try? JSONEncoder().encode(value), let string = String(data: data, encoding: .utf8) {
            return string
        }
        return "\"\(value)\""
    }
}
