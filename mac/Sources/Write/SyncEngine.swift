import AppKit
import CryptoKit
import Foundation
import WriteWorkspaceCore

/// One pass's outcome; also the headless mode's JSON summary.
struct SyncSummary {
    var pulled = 0
    var pushed = 0
    var conflicts = 0
    var errors = 0
}

/// The heart: mirrors the workspace's folders to <syncRoot>/<folder.path>/
/// <slug>.md. One serial queue; one pass = pull (per-folder manifest against
/// the index) then push (local edits, creations, deletions). The index records
/// the last state both sides agreed on; every decision is a three-way compare
/// of remote hash, indexed hash, and local file hash.
///
/// State machine per (postId, file) at pull time, R = remote hash,
/// I = indexed hash, L = local file hash (nil = file missing):
///   R == I                     -> nothing to pull (push owns L != I)
///   R != I,  L == I            -> overwrite file with server copy, I = R
///   R != I,  L == nil          -> resurrect: write server copy, I = R
///   R != I,  L != I            -> CONFLICT: local moves to "<slug>
///                                 (conflicted copy <yyyy-mm-dd hhmm>).md",
///                                 server copy becomes <slug>.md, I = R
///   id in index, not in manifest -> move file to state trash, drop index row
///   id not in index            -> new remote item: write file (adopting an
///                                 identical local file silently; a differing
///                                 one becomes a conflicted copy first)
/// And at push time:
///   L == nil                   -> DELETE server, drop index row
///   L != I                     -> PUT If-Match: I; 200 refreshes I (re-pull
///                                 the file only when the server's render
///                                 differs, to converge canonicalization);
///                                 412 takes the conflict path above
///   file with no index row     -> POST (kind injected from the folder mode
///                                 when the frontmatter has none); rename the
///                                 local file to the server's slug
/// Conflicted copies are never pushed automatically. The server's slug is
/// authoritative: slug changes rename local files.
final class SyncEngine {
    enum PassKind { case full, pushOnly }
    private enum LocalFileHash {
        case missing
        case unreadable(Error)
        case readable(String)
    }

    private struct IdentityScan {
        var index: SyncIndex
        var unreadableRelativePaths: [String]
        /// Posts whose move PATCH did not land this pass. Their local file sits
        /// at a new path but the server still has the old folder, so the push
        /// pass must neither adopt the new path (which would settle the move and
        /// stop it retrying) nor re-POST the file as new.
        var failedMovePatchIds: Set<String> = []
    }

    /// Dot-prefixed so the new-file scan never sees it; its absence next to a
    /// non-empty index is the vanished-mirror signal (see performPass).
    private let breadcrumbRelativePath = "\(WorkspaceLayout.localMetadataDirectoryName)/state/sync-marker.txt"
    private let breadcrumbBody =
        "Write keeps this folder in sync. This marker tells the app the folder is the same mirror it indexed; if the folder is deleted or replaced, Write re-mirrors from the server instead of propagating the loss as deletions.\n"

    /// The mirror id inside the marker file, or nil when the marker is
    /// missing or predates mirror ids. The index only trusts a marker whose
    /// id matches the one it recorded, which pins the index to ONE mirror:
    /// root flips (iCloud sign-out re-mirroring to the local fallback, then
    /// back) can then never run the delete loop against a foreign mirror.
    private func mirrorId(atBreadcrumb url: URL) -> String? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") where line.hasPrefix("mirror-id: ") {
            let value = line.dropFirst("mirror-id: ".count)
                .trimmingCharacters(in: .whitespaces)
            return value.isEmpty ? nil : value
        }
        return nil
    }

    private func writeBreadcrumb(at url: URL, mirrorId: String) {
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data((breadcrumbBody + "mirror-id: \(mirrorId)\n").utf8)
            .write(to: url, options: .atomic)
    }

    /// True only when the path is CONFIRMED absent (ENOENT). Permission or
    /// I/O errors on the file or a parent directory make files invisible to
    /// fileExists without being deleted; those must never become server
    /// deletes.
    private func fileConfirmedMissing(at url: URL) -> Bool {
        // An evicted iCloud item can vanish from its real path while a
        // ".name.icloud" placeholder holds its place; that is not a deletion.
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent("." + url.lastPathComponent + ".icloud")
        if FileManager.default.fileExists(atPath: placeholder.path) {
            return false
        }
        do {
            _ = try FileManager.default.attributesOfItem(atPath: url.path)
            return false
        } catch let error as NSError {
            if error.domain == NSCocoaErrorDomain,
               error.code == CocoaError.fileReadNoSuchFile.rawValue
                || error.code == CocoaError.fileNoSuchFile.rawValue {
                return true
            }
            if error.domain == NSPOSIXErrorDomain, error.code == Int(ENOENT) {
                return true
            }
            if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError,
               underlying.domain == NSPOSIXErrorDomain,
               underlying.code == Int(ENOENT) {
                return true
            }
            return false
        }
    }

    private let queue = DispatchQueue(label: "com.example.write.mac.sync", qos: .utility)
    private let store: StateStore

    /// Sentinel index hash meaning "the local file is not known to match the
    /// server render; the next pull MUST re-download it before any push acts".
    /// A real content hash is a non-empty hex string, so this never collides
    /// with one: `guard item.hash != entry.hash` in the pull always proceeds,
    /// and the push edits loop skips it.
    static let needsPullHash = ""

    /// nil when not linked; rebuilt each pass so sign in/out needs no plumbing.
    var makeClient: () -> SyncClient? = { nil }
    var syncRootProvider: () -> URL = {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Write", isDirectory: true)
    }
    var workspaceLocationProvider: () -> WorkspaceLocation? = { nil }

    /// Test seam: when set and it returns true for a moved file's relative path,
    /// the post-move convergence read is treated as if the local file were
    /// unreadable (localHash nil), to exercise the "needs pull" sentinel path.
    /// nil in production, so the real read runs.
    var convergenceReadShouldFail: ((String) -> Bool)?

    /// UI hooks. Delivered on `callbackQueue` (main by default); headless
    /// sets it nil to get inline delivery, since no runloop spins there.
    var onActivity: ((String) -> Void)?
    var onStateChange: (() -> Void)?
    var onServerAppVersion: ((String) -> Void)?
    var callbackQueue: DispatchQueue? = .main

    private let stateLock = NSLock()
    private var _isSyncing = false
    private var _lastSyncAt: Date?
    private var _lastSummary: SyncSummary?
    private var pendingKinds = Set<String>()

    /// Files whose exact content the server rejected (400): don't hot-loop
    /// them every pass; retry only when the bytes change. In-memory on
    /// purpose; a relaunch retries once.
    private var rejectedContent: [String: String] = [:] // relativePath -> content hash

    private var timer: DispatchSourceTimer?
    private var watcher: FolderWatcher?
    private var fileCoordinator: WorkspaceFileCoordinator?
    private var pushDebounce: DispatchWorkItem?
    private var wakeObserver: NSObjectProtocol?

    init(store: StateStore) {
        self.store = store
    }

    // MARK: Public surface

    var isSyncing: Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        return _isSyncing
    }

    var lastSyncAt: Date? {
        stateLock.lock(); defer { stateLock.unlock() }
        return _lastSyncAt
    }

    var lastSummary: SyncSummary? {
        stateLock.lock(); defer { stateLock.unlock() }
        return _lastSummary
    }

    func syncNow() { enqueue(.full) }

    /// GUI mode: periodic full passes, FSEvents-debounced push passes, a full
    /// pass on wake, and one right now.
    func start() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 60, repeating: 60)
        t.setEventHandler { [weak self] in self?.runPass(.full) }
        t.resume()
        timer = t

        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: nil
        ) { [weak self] _ in self?.enqueue(.full) }

        startWatcher()
        enqueue(.full)
    }

    /// The user picked a different sync root: forget the old mapping (paths in
    /// the index are relative to the root) and mirror afresh. Files identical
    /// to the server are adopted in place, so re-pointing at an existing
    /// mirror moves nothing.
    func resetForNewRoot() {
        queue.async { [weak self] in
            guard let self else { return }
            self.store.clearIndex()
            self.rejectedContent.removeAll()
        }
        startWatcher()
        enqueue(.full)
    }

    /// Sign-out hygiene: a stale index against a future different account
    /// would misread every file, so drop it. Local files stay untouched.
    func resetForSignOut() {
        queue.async { [weak self] in
            guard let self else { return }
            self.store.clearIndex()
            self.rejectedContent.removeAll()
        }
        notifyStateChange()
    }

    /// Headless mode: run exactly one full pass on the caller's thread's
    /// behalf (still serialized through the engine queue) and return it.
    func runOnePassBlocking() -> SyncSummary {
        var summary = SyncSummary()
        queue.sync { summary = self.runPass(.full) }
        return summary
    }

    // MARK: Scheduling

    private func enqueue(_ kind: PassKind) {
        let key = kind == .full ? "full" : "push"
        stateLock.lock()
        let alreadyQueued = pendingKinds.contains(key)
        if !alreadyQueued { pendingKinds.insert(key) }
        stateLock.unlock()
        guard !alreadyQueued else { return }
        queue.async { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            self.pendingKinds.remove(key)
            self.stateLock.unlock()
            self.runPass(kind)
        }
    }

    private func startWatcher() {
        let root = syncRootProvider()
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        pushDebounce?.cancel()
        watcher?.stop()
        watcher = FolderWatcher(path: root.path, queue: queue) { [weak self] in
            guard let self else { return }
            // Debounce 2s: editors save in bursts, and our own pull writes
            // fire events too (those become cheap no-op passes).
            self.pushDebounce?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.runPass(.pushOnly) }
            self.pushDebounce = work
            self.queue.asyncAfter(deadline: .now() + 2, execute: work)
        }
    }

    @discardableResult
    private func runPass(_ kind: PassKind) -> SyncSummary {
        stateLock.lock()
        if _isSyncing { stateLock.unlock(); return SyncSummary() } // queue is serial; belt and braces
        _isSyncing = true
        stateLock.unlock()
        notifyStateChange()

        let summary = performPass(kind)

        stateLock.lock()
        _isSyncing = false
        _lastSyncAt = Date()
        _lastSummary = summary
        stateLock.unlock()
        notifyStateChange()
        return summary
    }

    // MARK: The pass

    private func performPass(_ kind: PassKind) -> SyncSummary {
        var summary = SyncSummary()
        guard let client = makeClient() else { return summary } // not linked: local editing still works

        let root = syncRootProvider()
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        _ = coordinator(for: root)

        let workspace: Workspace
        switch client.workspace() {
        case .success(let (ws, data)):
            workspace = ws
            store.cacheWorkspace(data)
        case .failure(let error):
            activity("Sync paused: \(error)")
            summary.errors += 1
            return summary
        }
        let workspaceDescriptor = descriptor(for: workspace)
        do {
            try WorkspaceLayout.ensureSkeleton(
                at: root,
                workspace: workspaceDescriptor,
                location: workspaceLocationProvider()
            )
        } catch {
            activity("Could not prepare Write workspace: \(error.localizedDescription)")
            summary.errors += 1
            return summary
        }

        var index = loadIndex(root: root)

        // Mass-deletion guard. The breadcrumb marks the directory as the live
        // mirror the index describes. If the index lists files but the
        // breadcrumb is gone, the root itself was lost (rm -rf, an unmounted
        // volume, a fresh empty dir at the same path): every indexed file
        // would look locally deleted and the push phase would delete the
        // whole workspace server-side. A vanished mirror is never that
        // intent, so drop the index and re-mirror instead: identical files
        // re-adopt by hash, local strangers become conflicted copies, and
        // nothing is ever deleted on the server. Deleting individual files
        // inside an intact mirror still propagates normally.
        let fm = FileManager.default
        let breadcrumb = root.appendingPathComponent(breadcrumbRelativePath)
        var markerMirrorId = mirrorId(atBreadcrumb: breadcrumb)
        if !index.entries.isEmpty {
            if !fm.fileExists(atPath: breadcrumb.path) {
                activity("Sync folder looks new or was lost; re-mirroring from the server instead of treating its files as deleted")
                index = SyncIndex()
            } else if let indexId = index.mirrorId, markerMirrorId != indexId {
                // A marker with a different id (or an id-less marker while the
                // index expects one) means this root is a DIFFERENT mirror than
                // the one indexed: re-mirror, never delete.
                activity("Sync folder is a different mirror than the one indexed; re-mirroring from the server instead of treating differences as deletions")
                index = SyncIndex()
            }
        }
        if markerMirrorId == nil {
            let newId = UUID().uuidString
            writeBreadcrumb(at: breadcrumb, mirrorId: newId)
            markerMirrorId = newId
        }
        if index.mirrorId == nil {
            index.mirrorId = markerMirrorId
        }
        if indexContainsLegacyMirrorPaths(index) {
            index.folderETags.removeAll()
        }

        materializeFolders(workspace.folders, workspace: workspaceDescriptor, root: root, summary: &summary)
        let identityScan = reconcileIndexedMoves(
            root: root, client: client, workspace: workspaceDescriptor,
            index: &index, summary: &summary)

        if kind == .full {
            for folder in workspace.folders {
                pullFolder(folder, allFolders: workspace.folders, client: client,
                           root: root, workspace: workspaceDescriptor, index: &index, summary: &summary)
            }
        }
        let createdFolders = pushPass(workspace, client: client, root: root,
                                      index: &index, summary: &summary, identityScan: identityScan)

        saveIndex(index)

        if createdFolders { enqueue(.full) }

        if kind == .full, let advertised = client.advertisedAppVersion() {
            deliver { self.onServerAppVersion?(advertised) }
        }
        return summary
    }

    // MARK: Pull

    private func pullFolder(
        _ folder: WorkspaceFolder, allFolders: [WorkspaceFolder], client: SyncClient, root: URL,
        workspace: WorkspaceDescriptor, index: inout SyncIndex, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        let reply = client.manifest(folderId: folder.id, etag: index.folderETags[folder.id])
        switch reply {
        case .failure(let error):
            activity("Folder \(folder.path): \(error)")
            summary.errors += 1
        case .success(.notModified):
            break // nothing changed remotely; push still runs
        case .success(.manifest(let items, let etag)):
            let errorsBefore = summary.errors
            var remoteIds = Set<String>()
            for item in items {
                guard let id = item.id else { continue }
                remoteIds.insert(id)
                applyRemoteItem(item, id: id, folder: folder, client: client,
                                workspace: workspace, root: root, index: &index, summary: &summary)
            }
            // In the index, filed under this folder, gone from the manifest:
            // deleted on the server. The local file moves to the state trash.
            for (postId, entry) in index.entries
            where (entry.folderId == folder.id
                   || (entry.folderId == nil && folderPath(of: entry.relativePath, in: allFolders, workspace: workspace)?.id == folder.id))
                && !remoteIds.contains(postId) {
                let url = root.appendingPathComponent(entry.relativePath)
                if fm.fileExists(atPath: url.path) {
                    if let kept = store.moveToTrash(url, mover: { source, target in
                        try self.moveItem(at: source, to: target, root: root)
                    }) {
                        activity("Server deleted \(entry.relativePath); kept a copy in \(kept.deletingLastPathComponent().lastPathComponent)/")
                    } else {
                        summary.errors += 1
                        activity("Server deleted \(entry.relativePath), but Write could not move the local copy to trash")
                        continue
                    }
                } else {
                    activity("Server deleted \(entry.relativePath)")
                }
                index.entries.removeValue(forKey: postId)
                summary.pulled += 1
            }
            // Cache the ETag only after a clean folder: an error above must
            // re-pull next pass, not hide behind a 304.
            if summary.errors == errorsBefore, let etag {
                index.folderETags[folder.id] = etag
            }
        }
    }

    private func applyRemoteItem(
        _ item: ManifestItem, id: String, folder: WorkspaceFolder, client: SyncClient,
        workspace: WorkspaceDescriptor, root: URL, index: inout SyncIndex, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        let expectedRel = WorkspaceLayout.relativePath(
            for: descriptor(for: item),
            in: descriptor(for: folder),
            workspace: workspace
        )
        let expectedURL = root.appendingPathComponent(expectedRel)

        guard var entry = index.entries[id] else {
            // New remote item. A local file already at its path is either the
            // same bytes (adopt: a re-link over an existing mirror) or a
            // stranger (preserve it as a conflicted copy, then pull).
            if !fm.fileExists(atPath: expectedURL.path),
               let candidate = localCandidateForRemoteItem(
                item,
                folder: folder,
                expectedRel: expectedRel,
                workspace: workspace,
                root: root
               ) {
                do {
                    try moveItem(at: candidate, to: expectedURL, root: root)
                    activity("Adopted local \(candidate.lastPathComponent) for \(expectedRel)")
                } catch {
                    summary.errors += 1
                    activity("Could not adopt local file for \(expectedRel): \(error.localizedDescription)")
                }
            }
            switch localFileHash(expectedURL, root: root) {
            case .readable(let localHash):
                if localHash == item.hash {
                    index.entries[id] = IndexEntry(
                        hash: item.hash,
                        relativePath: expectedRel,
                        fileMtime: fileMtime(expectedURL),
                        folderId: folder.id,
                        kind: item.kind
                    )
                    return
                }
                if preserveAsConflictedCopy(expectedURL).blocksOverwrite {
                    summary.errors += 1
                    activity("Could not set aside your local \(expectedRel); leaving it untouched and retrying")
                    return // never download over an edit we failed to preserve
                }
                summary.conflicts += 1
            case .unreadable(let error):
                summary.errors += 1
                activity("\(expectedRel) exists but is not readable yet: \(error.localizedDescription); skipping pull")
                return
            case .missing:
                break
            }
            if let written = download(id, to: expectedURL, client: client, folderId: folder.id, kind: item.kind) {
                index.entries[id] = IndexEntry(
                    hash: written,
                    relativePath: expectedRel,
                    fileMtime: fileMtime(expectedURL),
                    folderId: folder.id,
                    kind: item.kind
                )
                summary.pulled += 1
                activity("Pulled \(expectedRel)")
            } else {
                summary.errors += 1
                activity("Could not pull \(expectedRel)")
            }
            return
        }

        var activeRel = expectedRel
        var activeURL = expectedURL

        // The server's slug is authoritative: follow renames first, carrying
        // any local edit along with the file.
        if entry.relativePath != expectedRel {
            let oldURL = root.appendingPathComponent(entry.relativePath)
            if fm.fileExists(atPath: oldURL.path) {
                if urlsReferToSameExistingFile(oldURL, expectedURL) {
                    entry.relativePath = expectedRel
                    activity("Retargeted \(oldURL.lastPathComponent) to \(expectedRel)")
                } else if shouldPreserveNonCanonicalLocalPath(
                    entry.relativePath,
                    expectedRel: expectedRel,
                    folder: folder,
                    workspace: workspace
                ) {
                    activeRel = entry.relativePath
                    activeURL = oldURL
                } else {
                    try? fm.createDirectory(at: expectedURL.deletingLastPathComponent(),
                                            withIntermediateDirectories: true)
                    if fm.fileExists(atPath: expectedURL.path),
                       preserveAsConflictedCopy(expectedURL).blocksOverwrite {
                        // Could not set the stranger aside: do not clobber it.
                        summary.errors += 1
                        activity("Could not set aside the file at \(expectedRel); not renaming \(entry.relativePath) over it")
                        return
                    }
                    do {
                        try moveItem(at: oldURL, to: expectedURL, root: root)
                        activity("Renamed \(entry.relativePath) to \(expectedRel)")
                        entry.relativePath = expectedRel
                    } catch {
                        summary.errors += 1
                        activity("Could not rename \(entry.relativePath): \(error.localizedDescription)")
                        return
                    }
                }
            } else if fm.fileExists(atPath: expectedURL.path) {
                entry.relativePath = expectedRel
            } else if let migratedURL = migratedLegacyCandidate(
                for: entry.relativePath,
                expectedRel: expectedRel,
                item: item,
                workspace: workspace,
                root: root
            ) {
                do {
                    try? fm.createDirectory(at: expectedURL.deletingLastPathComponent(),
                                            withIntermediateDirectories: true)
                    try moveItem(at: migratedURL, to: expectedURL, root: root)
                    activity("Retargeted migrated \(entry.relativePath) to \(expectedRel)")
                    entry.relativePath = expectedRel
                } catch {
                    summary.errors += 1
                    activity("Could not retarget migrated \(entry.relativePath): \(error.localizedDescription)")
                    return
                }
            } else if isLegacyMirrorRelativePath(entry.relativePath) {
                index.entries[id] = entry
                activity("Legacy indexed path \(entry.relativePath) has not appeared at \(expectedRel); skipping server delete")
                return
            } else {
                entry.relativePath = expectedRel
            }
            entry.folderId = folder.id
            entry.kind = item.kind
            index.entries[id] = entry
            activeRel = entry.relativePath
            activeURL = root.appendingPathComponent(entry.relativePath)
        }

        guard item.hash != entry.hash else { return } // remote unchanged; push owns local edits

        switch localFileHash(activeURL, root: root) {
        case .missing:
            // Missing (resurrect) or clean: take the server's copy.
            if let written = download(id, to: activeURL, client: client, folderId: folder.id, kind: item.kind) {
                entry.hash = written
                entry.fileMtime = fileMtime(activeURL)
                entry.folderId = folder.id
                entry.kind = item.kind
                index.entries[id] = entry
                summary.pulled += 1
                activity("Pulled \(activeRel)")
            } else {
                summary.errors += 1
                activity("Could not pull \(activeRel)")
            }
            return
        case .unreadable(let error):
            summary.errors += 1
            activity("\(activeRel) exists but is not readable yet: \(error.localizedDescription); skipping pull")
            return
        case .readable(let localHash) where localHash == entry.hash:
            if let written = download(id, to: activeURL, client: client, folderId: folder.id, kind: item.kind) {
                entry.hash = written
                entry.fileMtime = fileMtime(activeURL)
                entry.folderId = folder.id
                entry.kind = item.kind
                index.entries[id] = entry
                summary.pulled += 1
                activity("Pulled \(activeRel)")
            } else {
                summary.errors += 1
                activity("Could not pull \(activeRel)")
            }
            return
        case .readable:
            break
        }

        // Both sides changed: the server copy wins the canonical name, the
        // local edit survives as a conflicted copy that is never auto-pushed.
        // If it cannot be preserved, leave the canonical file untouched and
        // retry next pass rather than overwrite the unsynced local edit.
        switch preserveAsConflictedCopy(activeURL) {
        case .preserved(let kept):
            activity("Conflict on \(activeRel); your edit is \(kept.lastPathComponent)")
        case .nothingToPreserve:
            break
        case .failed:
            summary.errors += 1
            activity("Conflict on \(activeRel) but could not preserve your edit; leaving it and retrying")
            return
        }
        if let written = download(id, to: activeURL, client: client, folderId: folder.id, kind: item.kind) {
            entry.hash = written
            entry.fileMtime = fileMtime(activeURL)
            entry.folderId = folder.id
            entry.kind = item.kind
            index.entries[id] = entry
            summary.conflicts += 1
        } else {
            summary.errors += 1
            activity("Could not pull \(activeRel) after conflict")
        }
    }

    // MARK: Push

    private func pushPass(
        _ workspace: Workspace, client: SyncClient, root: URL,
        index: inout SyncIndex, summary: inout SyncSummary, identityScan incomingIdentityScan: IdentityScan?
    ) -> Bool {
        let fm = FileManager.default
        let workspaceDescriptor = descriptor(for: workspace)
        let folderById = Dictionary(uniqueKeysWithValues: workspace.folders.map { ($0.id, $0) })

        // 1. Local deletions: an index row whose file is gone. The pull phase
        // already resurrected files the server had changed, so what is left
        // is a safe delete.
        let breadcrumb = root.appendingPathComponent(breadcrumbRelativePath)
        guard fm.fileExists(atPath: breadcrumb.path),
              mirrorId(atBreadcrumb: breadcrumb) == index.mirrorId else {
            activity("Sync folder marker disappeared or changed during this pass; skipping server deletes")
            index = SyncIndex()
            return false
        }
        var identityScan = incomingIdentityScan
        if identityScan == nil && index.entries.values.contains(where: {
            !fm.fileExists(atPath: root.appendingPathComponent($0.relativePath).path)
        }) {
            identityScan = scanIdentityFiles(root: root, index: index)
        }
        // Deletion safety is two layers. Primary: a two-strike rule. A local
        // deletion only propagates on the SECOND consecutive completed scan that
        // finds the file gone, so a transient disappearance (eviction, a slow
        // coordinator read, a half-materialized mirror on one pass) never erases
        // the server on first sight of absence, at ANY workspace size (1/1 and
        // 2/3 included). A genuine delete still lands on the next scan. Backstop:
        // a high-fraction breaker for a catastrophic majority loss of a large
        // workspace. It pauses on the FIRST such scan but STILL advances the
        // two-strike memory, so a SUSTAINED large deletion (the same big set
        // still gone next scan) is allowed through on the second scan while a
        // transient half-materialized mirror that recovers clears the memory.
        let total = index.entries.count
        let previouslyMissing = index.previouslyMissing ?? []

        // Pass 1: classify every indexed file absent at its recorded path.
        // Reconcile moves in place (not deletions) and gather the set CONFIRMED
        // gone past the move/legacy/unreadable/parent-readable guards. Only this
        // set drives the two-strike deletes and the high-fraction backstop.
        var confirmedMissing = Set<String>()
        for (postId, entry) in Array(index.entries) {
            let url = root.appendingPathComponent(entry.relativePath)
            guard !fm.fileExists(atPath: url.path) else { continue }
            if identityScan?.failedMovePatchIds.contains(postId) == true {
                // Its move PATCH failed this pass: the file sits at a new path
                // but the server keeps the old folder. Leave the index at the old
                // path (do NOT adopt the move, do NOT read it as a deletion) so
                // the next scan retries the PATCH.
                activity("Move of \(entry.relativePath) is not on the server yet; will retry next sync")
                continue
            }
            if let found = identityScan?.index.entries[postId] {
                var moved = entry
                moved.relativePath = found.relativePath
                moved.fileMtime = found.fileMtime
                moved.folderId = found.folderId ?? moved.folderId
                moved.kind = found.kind ?? moved.kind
                index.entries[postId] = moved
                activity("Found moved local file for \(entry.relativePath) at \(found.relativePath); skipping server delete")
                continue
            }
            if isLegacyMirrorRelativePath(entry.relativePath) {
                activity("Skipping server delete for legacy indexed path \(entry.relativePath) until it is reconciled")
                continue
            }
            if let unreadable = identityScan?.unreadableRelativePaths, !unreadable.isEmpty {
                activity("Skipping server delete for \(entry.relativePath); \(unreadable.count) local markdown file(s) are not readable yet")
                continue
            }
            if !fileConfirmedMissing(at: url) {
                activity("Cannot confirm \(entry.relativePath) was deleted (unreadable parent?); skipping server delete")
                continue
            }
            confirmedMissing.insert(postId)
        }

        // High-fraction backstop. A large majority loss is suspect on first
        // sight, so pause, but only when the SAME set was not already confirmed
        // last scan: a sustained loss (identical set still gone) proceeds, a
        // transient one that recovers or shifts pauses again. Small workspaces
        // (1/1, 2/3) never trip this and stay on the plain two-strike rule.
        let massLossThreshold = 10
        let highFraction = confirmedMissing.count >= massLossThreshold
            && confirmedMissing.count * 2 >= total
        let sustainedLargeDelete = highFraction && confirmedMissing.isSubset(of: previouslyMissing)
        let deletesPaused = highFraction && !sustainedLargeDelete
        if deletesPaused {
            activity("Sync paused server deletes: \(confirmedMissing.count) of \(total) indexed files are missing locally. If this is intentional and they are still gone at the next sync, the deletion will go through; if not, restore the files and sync will recover.")
        }

        // Pass 2: the two-strike deletes. A post deletes only if it was ALSO
        // confirmed gone last completed scan.
        var missingThisScan = Set<String>()
        if !deletesPaused {
            for postId in confirmedMissing {
                guard let entry = index.entries[postId] else { continue }
                missingThisScan.insert(postId)
                guard previouslyMissing.contains(postId) else {
                    activity("Noticed \(entry.relativePath) is gone; will delete on the server if it is still gone next sync")
                    continue
                }
                switch client.deleteFile(postId: postId, ifMatch: entry.hash) {
                case .success:
                    index.entries.removeValue(forKey: postId)
                    missingThisScan.remove(postId) // gone for good; nothing to carry
                    summary.pushed += 1
                    activity("Deleted \(entry.relativePath) on the server")
                case .failure(let error):
                    summary.errors += 1
                    activity("Could not delete \(entry.relativePath): \(error)")
                }
            }
        }
        // Carry the confirmed-missing set forward. A paused high-fraction scan
        // records the FULL confirmed set (so a sustained loss is recognized and
        // allowed next scan); an unpaused scan carries what is still gone after
        // its deletes.
        index.previouslyMissing = deletesPaused
            ? (confirmedMissing.isEmpty ? nil : confirmedMissing)
            : (missingThisScan.isEmpty ? nil : missingThisScan)

        // 2. Local edits: file hash moved off the indexed hash.
        for (postId, entry) in index.entries {
            var entry = entry
            // A "needs pull" sentinel means a prior move could not converge the
            // local file with the server render. Skip it so no stale-If-Match
            // PUT (or rename-reverting old-slug PUT) is emitted before the pull
            // phase has re-downloaded and reconciled it.
            guard entry.hash != Self.needsPullHash else { continue }
            let url = root.appendingPathComponent(entry.relativePath)
            guard let data = try? readData(url, root: root) else { continue }
            let localHash = MarkdownIdentityCodec.syncHash(for: data)
            guard localHash != entry.hash else {
                if entry.fileMtime != fileMtime(url) {
                    entry.fileMtime = fileMtime(url)
                    index.entries[postId] = entry
                }
                continue
            }
            if rejectedContent[entry.relativePath] == localHash { continue }
            guard let bodyWithIdentity = String(data: data, encoding: .utf8) else {
                summary.errors += 1
                activity("\(entry.relativePath) is not UTF-8; not pushed")
                continue
            }
            let body = MarkdownIdentityCodec.strip(from: bodyWithIdentity)

            switch client.putFile(postId: postId, body: body, ifMatch: entry.hash) {
            case .success(.saved(let item)):
                rejectedContent.removeValue(forKey: entry.relativePath)
                let folder = entry.folderId.flatMap { folderById[$0] }
                    ?? WorkspaceLayout.classify(relativePath: entry.relativePath, workspace: workspaceDescriptor)
                        .flatMap { folderById[$0.folder.id] }
                    ?? workspace.folders.first { $0.mode == item.kind || $0.id == entry.folderId }
                    ?? workspace.folders.first
                let newRel = folder.map {
                    WorkspaceLayout.relativePath(
                        for: descriptor(for: item),
                        in: descriptor(for: $0),
                        workspace: workspaceDescriptor
                    )
                } ?? entry.relativePath
                var fileURL = url
                if newRel != entry.relativePath {
                    let target = root.appendingPathComponent(newRel)
                    if fm.fileExists(atPath: target.path),
                       preserveAsConflictedCopy(target).blocksOverwrite {
                        // Could not set the stranger aside: keep our file where it
                        // is (canonicalization below still converges on it).
                        summary.errors += 1
                        activity("Could not set aside the file at \(newRel); leaving \(entry.relativePath) in place")
                    } else {
                        do {
                            try moveItem(at: fileURL, to: target, root: root)
                            fileURL = target
                            entry.relativePath = newRel
                        } catch {
                            summary.errors += 1
                            activity("Could not move \(entry.relativePath) to \(newRel): \(error.localizedDescription)")
                        }
                    }
                }
                // Converge canonicalization: rewrite the local file only when
                // the server's render differs from what we just sent.
                if item.hash != localHash {
                    if let written = download(postId, to: fileURL, client: client, folderId: folder?.id ?? entry.folderId, kind: item.kind) {
                        entry.hash = written
                    } else {
                        entry.hash = item.hash // next pass re-pulls via the manifest
                    }
                } else {
                    entry.hash = item.hash
                }
                entry.fileMtime = fileMtime(fileURL)
                entry.folderId = folder?.id ?? entry.folderId
                entry.kind = item.kind
                index.entries[postId] = entry
                summary.pushed += 1
                activity("Pushed \(entry.relativePath)")
            case .success(.conflict):
                // 412: the post changed underneath us. Same resolution as the
                // pull-side conflict. If the local edit cannot be preserved,
                // leave the file and its old index hash so the next pass retries,
                // rather than overwrite the unsynced edit with the server copy.
                switch preserveAsConflictedCopy(url) {
                case .preserved(let kept):
                    activity("Conflict on \(entry.relativePath); your edit is \(kept.lastPathComponent)")
                case .nothingToPreserve:
                    break
                case .failed:
                    summary.errors += 1
                    activity("Conflict on \(entry.relativePath) but could not preserve your edit; leaving it and retrying")
                    continue
                }
                if let written = download(postId, to: url, client: client, folderId: entry.folderId, kind: entry.kind) {
                    entry.hash = written
                    entry.fileMtime = fileMtime(url)
                    index.entries[postId] = entry
                    summary.conflicts += 1
                } else {
                    summary.errors += 1
                    activity("Could not fetch the server copy of \(entry.relativePath)")
                }
            case .success(.rejected(let message)):
                rejectedContent[entry.relativePath] = localHash
                summary.errors += 1
                activity("Server rejected \(entry.relativePath): \(message)")
            case .failure(let error):
                summary.errors += 1
                activity("Could not push \(entry.relativePath): \(error)")
            }
        }

        // 3. New local directories: each immediate child becomes a server
        // folder unless it is already in the flat workspace list.
        var createdFolders = false
        var knownFolderPaths = Set(workspace.folders.map { $0.path })
        for folder in workspace.folders {
            let dir = root.appendingPathComponent(
                WorkspaceLayout.directoryRelativePath(for: descriptor(for: folder), workspace: workspaceDescriptor),
                isDirectory: true
            )
            let contents = directoryContents(dir)
            for child in contents {
                let name = child.lastPathComponent
                guard isDirectory(child) else { continue }
                guard !(folder.mode == "bookmarks" && name.range(of: #"^\d{4}$"#, options: .regularExpression) != nil) else {
                    continue
                }
                guard shouldScanDirectory(named: name) else { continue }
                let childPath = childFolderPath(parentPath: folder.path, name: name)
                guard !knownFolderPaths.contains(childPath) else { continue }
                if let created = createFolderForLocalDirectory(
                    child, parent: folder, workspace: workspaceDescriptor, client: client, root: root, summary: &summary
                ) {
                    knownFolderPaths.insert(created.path)
                    createdFolders = true
                }
            }
        }

        // 4. New local files: .md files in the visible workspace with no
        // index row.
        let indexedPaths = Set(index.entries.values.map { $0.relativePath })
        let indexedIds = Set(index.entries.keys)
        for fileURL in WorkspaceLayout.markdownFiles(at: root) {
            guard !isDirectory(fileURL) else { continue }
            let name = fileURL.lastPathComponent
            guard !name.hasPrefix(".") else { continue }
            guard !isConflictedCopy(fileURL) else { continue } // never auto-pushed
            guard let rel = WorkspaceLayout.relativePath(for: fileURL, under: root) else { continue }
            guard !indexedPaths.contains(rel) else { continue }
            // A file that already carries an injected item id present in the index
            // is a KNOWN post (a copy, or one whose move PATCH has not landed and
            // whose old path a pull may have restored), never a new file. POSTing
            // it would duplicate the post, so never treat it as new: leave it for
            // reconcileIndexedMoves to route as a move (or drop it if it is a
            // stray copy). Reading the candidate here is cheap; step 4 only
            // reaches files that are not already indexed by path.
            if let data = try? readData(fileURL, root: root),
               let text = String(data: data, encoding: .utf8),
               let identity = MarkdownIdentityCodec.extract(from: text),
               indexedIds.contains(identity.itemId) {
                activity("Skipping new-file publish for \(rel); it carries a known item id and will be reconciled as a move")
                continue
            }
            guard let classification = WorkspaceLayout.classify(relativePath: rel, workspace: workspaceDescriptor),
                  let folder = folderById[classification.folder.id] else { continue }
            pushNewFile(fileURL, rel: rel, folder: folder, workspace: workspaceDescriptor, client: client,
                        root: root, index: &index, summary: &summary)
        }
        return createdFolders
    }

    private func createFolderForLocalDirectory(
        _ dir: URL, parent: WorkspaceFolder, workspace: WorkspaceDescriptor, client: SyncClient, root: URL,
        summary: inout SyncSummary
    ) -> WorkspaceFolder? {
        let localName = dir.lastPathComponent
        let localPath = childFolderPath(parentPath: parent.path, name: localName)
        // The folder's workspace-relative path is stable across retries, so a
        // lost create response does not spawn a duplicate folder on retry.
        switch client.createFolder(parentPath: parent.path, name: localName, idempotencyKey: "folder:\(localPath)") {
        case .failure(let error):
            summary.errors += 1
            activity("Could not create folder \(localPath): \(error)")
            return nil
        case .success(let created):
            let serverSegment = lastSegment(of: created.path)
            if serverSegment != localName {
                let target = root.appendingPathComponent(
                    WorkspaceLayout.directoryRelativePath(for: descriptor(for: created), workspace: workspace),
                    isDirectory: true
                )
                if let message = renameDirectory(dir, to: target) {
                    summary.errors += 1
                    activity("Created folder \(created.path) but could not rename \(localPath): \(message)")
                } else {
                    activity("Created folder \(created.path)/ and renamed \(localPath)/")
                }
            } else {
                activity("Created folder \(created.path)/")
            }
            return created
        }
    }

    private func pushNewFile(
        _ fileURL: URL, rel: String, folder: WorkspaceFolder, workspace: WorkspaceDescriptor, client: SyncClient,
        root: URL, index: inout SyncIndex, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        let data: Data
        do {
            data = try readData(fileURL, root: root)
        } catch {
            summary.errors += 1
            activity("\(rel) is not readable: \(error.localizedDescription); not pushed")
            return
        }
        guard let textWithIdentity = String(data: data, encoding: .utf8) else {
            summary.errors += 1
            activity("\(rel) is not UTF-8; not pushed")
            return
        }
        let localHash = MarkdownIdentityCodec.syncHash(for: data)
        if rejectedContent[rel] == localHash { return }

        // Authoritative known-id guard, on THIS read (no TOCTOU with the outer
        // step-4 scan, whose read may have transiently failed or whose index
        // snapshot may be stale). A file already carrying an item id present in
        // the index is a KNOWN post (a copy, or one whose move has not landed),
        // never a new file: POSTing it would duplicate the post. Leave it for
        // move reconciliation.
        let injectedId = MarkdownIdentityCodec.extract(from: textWithIdentity)?.itemId
        if let injectedId, index.entries[injectedId] != nil {
            activity("Skipping new-file publish for \(rel); it carries a known item id and will be reconciled as a move")
            return
        }
        let text = MarkdownIdentityCodec.strip(from: textWithIdentity)

        // A file in notes/ without a kind is a note, and so on: the folder it
        // sits in wins when the frontmatter is silent. (Blog is the server's
        // default already, so blog-mode files go up as-is.)
        let body = bodyEnsuringKind(text, folderMode: folder.mode)

        // A stable key per logical create: an already-injected item id if the
        // file carries one, else its workspace-relative path. A lost POST
        // response then returns the original item on retry instead of
        // publishing the post twice.
        let idempotencyKey = injectedId ?? "post:\(rel)"

        switch client.postFile(body: body, folderId: folder.id, idempotencyKey: idempotencyKey) {
        case .success(.saved(let item)):
            rejectedContent.removeValue(forKey: rel)
            guard let id = item.id else {
                summary.errors += 1
                activity("Server created \(rel) without an id")
                return
            }
            // The server's slug names the file from here on.
            let newRel = WorkspaceLayout.relativePath(
                for: descriptor(for: item),
                in: descriptor(for: folder),
                workspace: workspace
            )
            var target = fileURL
            var indexedRel = rel
            if newRel != rel {
                let destination = root.appendingPathComponent(newRel)
                if fm.fileExists(atPath: destination.path),
                   preserveAsConflictedCopy(destination).blocksOverwrite {
                    // Could not set the stranger aside: keep our file at its
                    // current path (canonicalization below converges on it).
                    summary.errors += 1
                    activity("Could not set aside the file at \(newRel); leaving \(rel) in place")
                } else {
                    do {
                        try moveItem(at: fileURL, to: destination, root: root)
                        target = destination
                        indexedRel = newRel
                    } catch {
                        summary.errors += 1
                        activity("Could not move \(rel) to \(newRel): \(error.localizedDescription)")
                    }
                }
            }
            // Converge on the server's canonical render (it adds schema,
            // canonical URL, and normalized frontmatter).
            if let written = download(id, to: target, client: client, folderId: folder.id, kind: item.kind) {
                index.entries[id] = IndexEntry(
                    hash: written,
                    relativePath: indexedRel,
                    fileMtime: fileMtime(target),
                    folderId: folder.id,
                    kind: item.kind
                )
            } else {
                index.entries[id] = IndexEntry(
                    hash: item.hash,
                    relativePath: indexedRel,
                    fileMtime: fileMtime(target),
                    folderId: folder.id,
                    kind: item.kind
                )
            }
            summary.pushed += 1
            activity("Published \(indexedRel) as \(item.status)")
        case .success(.rejected(let message)):
            rejectedContent[rel] = localHash
            summary.errors += 1
            activity("Server rejected \(rel): \(message)")
        case .success(.conflict):
            summary.errors += 1 // POST never 412s; treat as an oddity
        case .failure(let error):
            summary.errors += 1
            activity("Could not push \(rel): \(error)")
        }
    }

    // MARK: Helpers

    private func materializeFolders(
        _ folders: [WorkspaceFolder], workspace: WorkspaceDescriptor, root: URL, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        for folder in folders {
            let dir = root.appendingPathComponent(
                WorkspaceLayout.directoryRelativePath(for: descriptor(for: folder), workspace: workspace),
                isDirectory: true
            )
            do {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                if folder.mode == "blog", folder.path.hasPrefix("blog/") {
                    let child = String(folder.path.dropFirst("blog/".count))
                    try fm.createDirectory(
                        at: root.appendingPathComponent("Drafts/\(child)", isDirectory: true),
                        withIntermediateDirectories: true
                    )
                }
            } catch {
                summary.errors += 1
                activity("Could not create local folder \(folder.path): \(error.localizedDescription)")
            }
        }
    }

    /// Insert `kind: <folder's kind>` when the frontmatter names neither kind
    /// nor type. Applied to the POST body only; the local file is later
    /// rewritten with the server's canonical render anyway.
    func bodyEnsuringKind(_ text: String, folderMode: String) -> String {
        let kind: String
        switch folderMode {
        case "notes": kind = "note"
        case "bookmarks": kind = "bookmark"
        default: return text // blog: the server defaults to article
        }
        if text.hasPrefix("---\n") || text.hasPrefix("---\r\n") {
            let lines = text.components(separatedBy: "\n")
            var closed = false
            for line in lines.dropFirst() {
                let trimmed = line.hasSuffix("\r") ? String(line.dropLast()) : line
                if trimmed.range(of: "^---\\s*$", options: .regularExpression) != nil {
                    closed = true
                    break
                }
                if trimmed.range(of: "^(kind|type):", options: .regularExpression) != nil {
                    return text // author already chose
                }
            }
            guard closed else { return text } // unterminated: the server treats it all as body
            guard let firstBreak = text.firstIndex(of: "\n") else { return text }
            let insertAt = text.index(after: firstBreak)
            return String(text[..<insertAt]) + "kind: \(kind)\n" + String(text[insertAt...])
        }
        return "---\nkind: \(kind)\n---\n\n" + text
    }

    /// The outcome of trying to move a local file aside before the server copy
    /// overwrites the canonical path. The caller MUST distinguish these: a `nil`
    /// that lumped "nothing was there" together with "the move failed" let a
    /// failed preservation fall through to a destructive download, losing the
    /// local edit. `.failed` blocks the overwrite; the other two allow it.
    enum ConflictPreservation {
        case preserved(URL)     // the local file is safe at this new path
        case nothingToPreserve  // no file at the path; writing over it is safe
        case failed             // a file was there but could not be moved: DO NOT overwrite

        /// True only when a real file could not be set aside, so replacing the
        /// canonical path now would destroy unsynced local content.
        var blocksOverwrite: Bool {
            if case .failed = self { return true }
            return false
        }
    }

    private func preserveAsConflictedCopy(_ url: URL) -> ConflictPreservation {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return .nothingToPreserve }
        let stem = url.deletingPathExtension().lastPathComponent
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd HHmm"
        let stamp = df.string(from: Date())
        var candidate = url.deletingLastPathComponent()
            .appendingPathComponent("\(stem) (conflicted copy \(stamp)).md")
        var n = 2
        while fm.fileExists(atPath: candidate.path) {
            candidate = url.deletingLastPathComponent()
                .appendingPathComponent("\(stem) (conflicted copy \(stamp) \(n)).md")
            n += 1
        }
        do {
            try moveItem(at: url, to: candidate, root: syncRootProvider())
            return .preserved(candidate)
        } catch {
            return .failed
        }
    }

    private func isConflictedCopy(_ url: URL) -> Bool {
        let name = url.lastPathComponent
        return name.contains(" (conflicted copy ") || name.contains(" (legacy copy")
    }

    /// Fetch the server's render of a post and write it (atomically) to url.
    /// Returns the sha256 of the bytes written, so the caller's index entry
    /// always matches the file that is actually on disk.
    private func download(
        _ postId: String,
        to url: URL,
        client: SyncClient,
        folderId: String? = nil,
        kind: String? = nil
    ) -> String? {
        switch client.fileText(postId: postId) {
        case .failure:
            return nil
        case .success(let (text, _)):
            let localText = MarkdownIdentityCodec.inject(into: text, itemId: postId, folderId: folderId, kind: kind)
            let data = Data(localText.utf8)
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                        withIntermediateDirectories: true)
                try writeData(data, to: url)
            } catch {
                activity("Could not write \(url.lastPathComponent): \(error.localizedDescription)")
                return nil
            }
            return MarkdownIdentityCodec.syncHash(for: data)
        }
    }

    private func loadIndex(root: URL) -> SyncIndex {
        store.loadIndex()
    }

    private func saveIndex(_ index: SyncIndex) {
        store.saveIndex(index)
    }

    private func reconcileIndexedMoves(
        root: URL, client: SyncClient, workspace: WorkspaceDescriptor,
        index: inout SyncIndex, summary: inout SyncSummary
    ) -> IdentityScan? {
        let fm = FileManager.default
        let missingIds = index.entries.compactMap { postId, entry -> String? in
            fm.fileExists(atPath: root.appendingPathComponent(entry.relativePath).path) ? nil : postId
        }
        guard !missingIds.isEmpty else { return nil }
        var scan = scanIdentityFiles(root: root, index: index)
        for postId in missingIds {
            guard let diskEntry = scan.index.entries[postId] else { continue }
            guard var entry = index.entries[postId],
                  entry.relativePath != diskEntry.relativePath else { continue }
            let previous = entry.relativePath
            let oldFolderId = WorkspaceLayout.classify(relativePath: previous, workspace: workspace)?.folder.id
                ?? entry.folderId
            let newFolderId = WorkspaceLayout.classify(relativePath: diskEntry.relativePath, workspace: workspace)?.folder.id
            entry.relativePath = diskEntry.relativePath
            entry.fileMtime = diskEntry.fileMtime
            entry.folderId = diskEntry.folderId ?? entry.folderId
            entry.kind = diskEntry.kind ?? entry.kind
            let url = root.appendingPathComponent(diskEntry.relativePath)
            if ensureFrontmatterReflectsPath(url: url, relativePath: diskEntry.relativePath) {
                entry.fileMtime = fileMtime(url)
            }
            // A move BETWEEN folders leaves the bytes (and their hash) unchanged,
            // so the push-side PUT never fires and the server keeps the file in
            // its old folder: the next pull would rename it straight back. Tell
            // the server the new folder now, guarded by the base hash as If-Match
            // so a stale move is rejected (412 -> conflict). ONLY commit the
            // local index change and count it as pushed when the PATCH succeeds:
            // adopting the new folder/path on a failed PATCH would block a clean
            // retry and let the file snap back while looking synced. On failure
            // the index is left as-is (the old folder/path), so the next scan
            // retries, or the pull reverts the local move.
            if let newFolderId, newFolderId != oldFolderId {
                let newSlug = url.deletingPathExtension().lastPathComponent
                switch client.patchFile(postId: postId, folderId: newFolderId, slug: newSlug, ifMatch: entry.hash) {
                case .success(.saved(let item)):
                    entry.folderId = newFolderId
                    entry.kind = item.kind
                    // A move+rename changes the server slug and thus its rendered
                    // hash, and the local slug frontmatter was rewritten above.
                    // We must converge on the server's post-rename render.
                    let localHash: String?
                    if convergenceReadShouldFail?(diskEntry.relativePath) == true {
                        localHash = nil
                    } else {
                        localHash = (try? readData(url, root: root))
                            .map { MarkdownIdentityCodec.syncHash(for: $0) }
                    }
                    if item.hash == localHash {
                        // The local file already byte-matches the server render.
                        entry.hash = item.hash
                    } else if let written = download(postId, to: url, client: client,
                                                     folderId: newFolderId, kind: item.kind) {
                        // Downloaded the server render onto the moved path.
                        entry.hash = written
                        entry.fileMtime = fileMtime(url)
                    } else {
                        // The convergence download FAILED (the GET failed, or the
                        // local file is unreadable so we cannot compare). Trusting
                        // EITHER hash is wrong: the local hash lets a later push
                        // carry a stale If-Match, and item.hash makes the next
                        // pull exit early (item.hash == entry.hash) so a push can
                        // revert the rename with pre-rename local bytes. Mark the
                        // entry "needs pull": the next full pass's pull (which runs
                        // before push) re-downloads the server render and converges
                        // authoritatively, and the push edits loop skips the entry
                        // until then. A genuine unsynced local edit is set aside as
                        // a conflicted copy by the pull before the render lands, so
                        // no edit is lost and the rename is never reverted.
                        entry.hash = Self.needsPullHash
                    }
                    index.entries[postId] = entry
                    summary.pushed += 1
                    activity("Moved \(previous) to \(diskEntry.relativePath) on the server")
                case .success(.conflict):
                    summary.conflicts += 1
                    scan.failedMovePatchIds.insert(postId)
                    activity("Could not move \(diskEntry.relativePath) on the server: it changed underneath us; will retry")
                case .success(.rejected(let message)):
                    summary.errors += 1
                    scan.failedMovePatchIds.insert(postId)
                    activity("Server rejected the move of \(diskEntry.relativePath): \(message)")
                case .failure(let error):
                    summary.errors += 1
                    scan.failedMovePatchIds.insert(postId)
                    activity("Could not move \(diskEntry.relativePath) on the server: \(error)")
                }
            } else {
                // Same-folder rename: no PATCH needed (the slug frontmatter
                // rewrite rides the PUT path). Commit the new local path.
                index.entries[postId] = entry
                summary.pushed += 1
                activity("Detected moved file \(previous) to \(diskEntry.relativePath)")
            }
        }
        return scan
    }

    private func scanIdentityFiles(root: URL, index: SyncIndex) -> IdentityScan {
        let preferred = Dictionary(uniqueKeysWithValues: index.entries.map { ($0.key, $0.value.relativePath) })
        var unreadable: [String] = []
        let rebuilt = WorkspaceIndexStore.rebuild(
            root: root,
            preferredPaths: preferred,
            includeSkippedDirectories: true,
            readData: { url in
                try self.readData(url, root: root)
            },
            onUnreadable: { url, _ in
                if let rel = WorkspaceLayout.relativePath(for: url, under: root) {
                    unreadable.append(rel)
                }
            }
        )
        return IdentityScan(index: rebuilt, unreadableRelativePaths: unreadable)
    }

    private func ensureFrontmatterReflectsPath(url: URL, relativePath: String) -> Bool {
        guard let data = try? readData(url, root: syncRootProvider()),
              var text = String(data: data, encoding: .utf8) else { return false }
        var changed = false
        let slug = url.deletingPathExtension().lastPathComponent
        if replaceFrontmatterValue(key: "slug", value: slug, text: &text) {
            changed = true
        }
        if relativePath == url.lastPathComponent || relativePath.hasPrefix("Drafts/") {
            if replaceFrontmatterValue(key: "status", value: "draft", text: &text) {
                changed = true
            }
        }
        guard changed else { return false }
        do {
            try writeData(Data(text.utf8), to: url)
            return true
        } catch {
            activity("Could not update front matter for \(relativePath): \(error.localizedDescription)")
            return false
        }
    }

    private func replaceFrontmatterValue(key: String, value: String, text: inout String) -> Bool {
        guard text.hasPrefix("---\n") || text.hasPrefix("---\r\n"),
              let firstBreak = text.firstIndex(of: "\n") else { return false }
        var cursor = text.index(after: firstBreak)
        while cursor < text.endIndex {
            let lineStart = cursor
            let nextBreak = text[cursor...].firstIndex(of: "\n") ?? text.endIndex
            let rawLine = text[lineStart..<nextBreak]
            let line = rawLine.last == "\r" ? rawLine.dropLast() : rawLine[...]
            if line.trimmingCharacters(in: .whitespaces) == "---" { break }
            if line.hasPrefix("\(key):") {
                let replacement = "\(key): \(jsonString(value))"
                if line == replacement { return false }
                text.replaceSubrange(lineStart..<nextBreak, with: replacement)
                return true
            }
            cursor = nextBreak == text.endIndex ? text.endIndex : text.index(after: nextBreak)
        }
        return false
    }

    /// The workspace folder a relative path lives in (longest path prefix).
    private func folderPath(
        of relativePath: String,
        in folders: [WorkspaceFolder],
        workspace: WorkspaceDescriptor
    ) -> WorkspaceFolder? {
        if let classification = WorkspaceLayout.classify(relativePath: relativePath, workspace: workspace) {
            return folders.first { $0.id == classification.folder.id }
        }
        var best: WorkspaceFolder?
        for folder in folders where relativePath.hasPrefix(folder.path + "/") {
            if best == nil || folder.path.count > (best?.path.count ?? 0) { best = folder }
        }
        return best
    }

    private func shouldPreserveNonCanonicalLocalPath(
        _ relativePath: String,
        expectedRel: String,
        folder: WorkspaceFolder,
        workspace: WorkspaceDescriptor
    ) -> Bool {
        guard (relativePath as NSString).lastPathComponent == (expectedRel as NSString).lastPathComponent else {
            return false
        }
        guard relativePath.hasPrefix("Drafts/") == expectedRel.hasPrefix("Drafts/") else { return false }
        guard !isLegacyMirrorRelativePath(relativePath) else { return false }
        guard relativePathContainsSkippedDirectory(relativePath) else { return false }
        guard let classification = WorkspaceLayout.classify(relativePath: relativePath, workspace: workspace) else {
            return false
        }
        return classification.folder.id == folder.id
    }

    private func migratedLegacyCandidate(
        for legacyRel: String,
        expectedRel: String,
        item: ManifestItem,
        workspace: WorkspaceDescriptor,
        root: URL
    ) -> URL? {
        guard isLegacyMirrorRelativePath(legacyRel) else { return nil }
        let parts = legacyRel.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let first = parts.first else { return nil }
        let remainder = Array(parts.dropFirst())
        var candidates: [String] = []

        switch first {
        case "blog":
            if item.status == "draft" {
                candidates.append(join(["Drafts"] + remainder))
            }
            let handle = workspace.blog.handle.isEmpty ? "default" : workspace.blog.handle
            candidates.append(join(["Blogs", safePathComponent(handle), "Posts"] + remainder))
        case "notes":
            candidates.append(join(["Notes"] + remainder))
        case "bookmarks":
            candidates.append(expectedRel)
            let bookmarksRoot = root.appendingPathComponent("Bookmarks", isDirectory: true)
            for child in directoryContents(bookmarksRoot) where isDirectory(child) {
                candidates.append(join(["Bookmarks", child.lastPathComponent] + remainder))
            }
        case "drafts":
            candidates.append(join(["Drafts"] + remainder))
        default:
            break
        }

        let existing = unique(candidates).map { root.appendingPathComponent($0) }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        return existing.count == 1 ? existing[0] : nil
    }

    private func localCandidateForRemoteItem(
        _ item: ManifestItem,
        folder: WorkspaceFolder,
        expectedRel: String,
        workspace: WorkspaceDescriptor,
        root: URL
    ) -> URL? {
        let expectedName = (expectedRel as NSString).lastPathComponent
        for url in WorkspaceLayout.markdownFiles(
            at: root,
            includeSkippedDirectories: true,
            includeHiddenFiles: true
        ) {
            guard url.lastPathComponent == expectedName,
                  let rel = WorkspaceLayout.relativePath(for: url, under: root),
                  rel != expectedRel,
                  !WorkspaceLayout.isInternal(relativePath: rel),
                  !isConflictedCopy(url),
                  candidate(rel, belongsTo: folder, workspace: workspace) else {
                continue
            }
            if let data = try? readData(url, root: root),
               MarkdownIdentityCodec.syncHash(for: data) == item.hash {
                return url
            }
        }
        return nil
    }

    private func urlsReferToSameExistingFile(_ lhs: URL, _ rhs: URL) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: lhs.path), fm.fileExists(atPath: rhs.path),
              let left = try? fm.attributesOfItem(atPath: lhs.path),
              let right = try? fm.attributesOfItem(atPath: rhs.path),
              let leftFile = left[.systemFileNumber] as? NSNumber,
              let rightFile = right[.systemFileNumber] as? NSNumber,
              let leftVolume = left[.systemNumber] as? NSNumber,
              let rightVolume = right[.systemNumber] as? NSNumber else {
            return false
        }
        return leftFile == rightFile && leftVolume == rightVolume
    }

    private func relativePathContainsSkippedDirectory(_ relativePath: String) -> Bool {
        let directories = relativePath.split(separator: "/", omittingEmptySubsequences: true).dropLast()
        return directories.contains { component in
            String(component).caseInsensitiveCompare("media") == .orderedSame || component.hasPrefix(".")
        }
    }

    private func isLegacyMirrorRelativePath(_ relativePath: String) -> Bool {
        relativePath.hasPrefix("blog/")
            || relativePath.hasPrefix("notes/")
            || relativePath.hasPrefix("bookmarks/")
            || relativePath.hasPrefix("drafts/")
    }

    private func indexContainsLegacyMirrorPaths(_ index: SyncIndex) -> Bool {
        index.entries.values.contains { isLegacyMirrorRelativePath($0.relativePath) }
    }

    private func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    private func candidate(
        _ relativePath: String,
        belongsTo folder: WorkspaceFolder,
        workspace: WorkspaceDescriptor
    ) -> Bool {
        if let classification = WorkspaceLayout.classify(relativePath: relativePath, workspace: workspace) {
            return classification.folder.id == folder.id
        }
        let lower = relativePath.lowercased()
        switch folder.mode.lowercased() {
        case "notes":
            return lower.hasPrefix("notes/")
        case "bookmarks":
            return lower.hasPrefix("bookmarks/")
        default:
            return lower.hasPrefix("blog/") || lower.hasPrefix("blogs/")
        }
    }

    private func directoryContents(_ dir: URL) -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
    }

    private func isDirectory(_ url: URL) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
    }

    private func shouldScanDirectory(named name: String) -> Bool {
        !name.hasPrefix(".") && !name.lowercased().hasSuffix(".assets")
    }

    private func childFolderPath(parentPath: String, name: String) -> String {
        parentPath.isEmpty ? name : "\(parentPath)/\(name)"
    }

    private func join(_ parts: [String]) -> String {
        parts.flatMap { $0.split(separator: "/", omittingEmptySubsequences: true).map(String.init) }
            .joined(separator: "/")
    }

    private func safePathComponent(_ value: String) -> String {
        value.replacingOccurrences(of: "/", with: "-")
    }

    private func lastSegment(of path: String) -> String {
        path.split(separator: "/").last.map(String.init) ?? path
    }

    private func renameDirectory(_ source: URL, to target: URL) -> String? {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: target.deletingLastPathComponent(),
                                   withIntermediateDirectories: true)
            if source.path == target.path { return nil }
            if fm.fileExists(atPath: target.path) {
                if source.path.compare(target.path, options: [.caseInsensitive, .literal]) == .orderedSame {
                    let tmp = source.deletingLastPathComponent()
                        .appendingPathComponent(".write-rename-\(UUID().uuidString)", isDirectory: true)
                    try fm.moveItem(at: source, to: tmp)
                    do {
                        try fm.moveItem(at: tmp, to: target)
                    } catch {
                        try? fm.moveItem(at: tmp, to: source)
                        throw error
                    }
                    return nil
                }
                return "\(target.lastPathComponent) already exists"
            }
            try moveItem(at: source, to: target, root: syncRootProvider())
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func moveItem(at source: URL, to target: URL, root: URL) throws {
        try coordinator(for: root).moveItem(at: source, to: target)
    }

    private func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func descriptor(for workspace: Workspace) -> WorkspaceDescriptor {
        WorkspaceDescriptor(
            blog: WorkspaceBlogDescriptor(handle: workspace.blog.handle, name: workspace.blog.name),
            folders: workspace.folders.map(descriptor(for:))
        )
    }

    private func descriptor(for folder: WorkspaceFolder) -> WorkspaceFolderDescriptor {
        WorkspaceFolderDescriptor(
            id: folder.id,
            name: folder.name,
            path: folder.path,
            mode: folder.mode,
            parentId: folder.parentId
        )
    }

    private func descriptor(for item: ManifestItem) -> WorkspaceItemDescriptor {
        WorkspaceItemDescriptor(
            id: item.id,
            kind: item.kind,
            slug: item.slug,
            status: item.status,
            date: item.date,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        )
    }

    private func coordinator(for root: URL) -> WorkspaceFileCoordinator {
        if let fileCoordinator, fileCoordinator.rootURL.standardizedFileURL.path == root.standardizedFileURL.path {
            return fileCoordinator
        }
        let next = WorkspaceFileCoordinator(rootURL: root)
        next.onPresentedItemChange = { [weak self] in
            self?.enqueue(.pushOnly)
        }
        fileCoordinator = next
        return next
    }

    private func readData(_ url: URL, root: URL) throws -> Data {
        try coordinator(for: root).readData(at: url)
    }

    private func writeData(_ data: Data, to url: URL) throws {
        let root = syncRootProvider()
        try coordinator(for: root).writeData(data, to: url)
    }

    private func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }

    private func localFileHash(_ url: URL, root: URL) -> LocalFileHash {
        let existedBeforeRead = FileManager.default.fileExists(atPath: url.path)
        do {
            let data = try readData(url, root: root)
            return .readable(MarkdownIdentityCodec.syncHash(for: data))
        } catch {
            if existedBeforeRead || FileManager.default.fileExists(atPath: url.path) {
                return .unreadable(error)
            }
            return .missing
        }
    }

    private func fileMtime(_ url: URL) -> Double? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970
    }

    private func activity(_ message: String) {
        deliver { self.onActivity?(message) }
    }

    private func notifyStateChange() {
        deliver { self.onStateChange?() }
    }

    private func deliver(_ block: @escaping () -> Void) {
        if let callbackQueue { callbackQueue.async(execute: block) } else { block() }
    }
}
