import AppKit
import CryptoKit
import Foundation

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

    /// Dot-prefixed so the new-file scan never sees it; its absence next to a
    /// non-empty index is the vanished-mirror signal (see performPass).
    private let breadcrumbName = ".write-sync"
    private let breadcrumbBody =
        "Write keeps this folder in sync. This marker tells the app the folder is the same mirror it indexed; if the folder is deleted or replaced, Write re-mirrors from the server instead of propagating the loss as deletions.\n"

    private let queue = DispatchQueue(label: "com.example.write.mac.sync", qos: .utility)
    private let store: StateStore

    /// nil when not linked; rebuilt each pass so sign in/out needs no plumbing.
    var makeClient: () -> ServerClient? = { nil }
    var syncRootProvider: () -> URL = {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Write", isDirectory: true)
    }

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

        var index = store.loadIndex()

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
        let breadcrumb = root.appendingPathComponent(breadcrumbName)
        if !index.entries.isEmpty && !fm.fileExists(atPath: breadcrumb.path) {
            activity("Sync folder looks new or was lost; re-mirroring from the server instead of treating its files as deleted")
            index = SyncIndex()
        }
        if !fm.fileExists(atPath: breadcrumb.path) {
            try? Data(breadcrumbBody.utf8).write(to: breadcrumb, options: .atomic)
        }

        materializeFolders(workspace.folders, root: root, summary: &summary)

        if kind == .full {
            for folder in workspace.folders {
                pullFolder(folder, allFolders: workspace.folders, client: client,
                           root: root, index: &index, summary: &summary)
            }
        }
        let createdFolders = pushPass(workspace, client: client, root: root,
                                      index: &index, summary: &summary)

        store.saveIndex(index)

        if createdFolders { enqueue(.full) }

        if kind == .full, let advertised = client.advertisedAppVersion() {
            deliver { self.onServerAppVersion?(advertised) }
        }
        return summary
    }

    // MARK: Pull

    private func pullFolder(
        _ folder: WorkspaceFolder, allFolders: [WorkspaceFolder], client: ServerClient, root: URL,
        index: inout SyncIndex, summary: inout SyncSummary
    ) {
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
                                root: root, index: &index, summary: &summary)
            }
            // In the index, filed under this folder, gone from the manifest:
            // deleted on the server. The local file moves to the state trash.
            for (postId, entry) in index.entries
            where folderPath(of: entry.relativePath, in: allFolders)?.id == folder.id
                && !remoteIds.contains(postId) {
                let url = root.appendingPathComponent(entry.relativePath)
                if let kept = store.moveToTrash(url) {
                    activity("Server deleted \(entry.relativePath); kept a copy in \(kept.deletingLastPathComponent().lastPathComponent)/")
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
        _ item: ManifestItem, id: String, folder: WorkspaceFolder, client: ServerClient,
        root: URL, index: inout SyncIndex, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        let expectedRel = "\(folder.path)/\(item.slug).md"
        let expectedURL = root.appendingPathComponent(expectedRel)

        guard var entry = index.entries[id] else {
            // New remote item. A local file already at its path is either the
            // same bytes (adopt: a re-link over an existing mirror) or a
            // stranger (preserve it as a conflicted copy, then pull).
            if let localHash = fileHash(expectedURL) {
                if localHash == item.hash {
                    index.entries[id] = IndexEntry(hash: item.hash, relativePath: expectedRel,
                                                   fileMtime: fileMtime(expectedURL))
                    return
                }
                preserveAsConflictedCopy(expectedURL)
                summary.conflicts += 1
            }
            if let written = download(id, to: expectedURL, client: client) {
                index.entries[id] = IndexEntry(hash: written, relativePath: expectedRel,
                                               fileMtime: fileMtime(expectedURL))
                summary.pulled += 1
                activity("Pulled \(expectedRel)")
            } else {
                summary.errors += 1
                activity("Could not pull \(expectedRel)")
            }
            return
        }

        // The server's slug is authoritative: follow renames first, carrying
        // any local edit along with the file.
        if entry.relativePath != expectedRel {
            let oldURL = root.appendingPathComponent(entry.relativePath)
            if fm.fileExists(atPath: oldURL.path) {
                try? fm.createDirectory(at: expectedURL.deletingLastPathComponent(),
                                        withIntermediateDirectories: true)
                if fm.fileExists(atPath: expectedURL.path) {
                    preserveAsConflictedCopy(expectedURL) // never overwrite a stranger
                }
                do {
                    try fm.moveItem(at: oldURL, to: expectedURL)
                    activity("Renamed \(entry.relativePath) to \(expectedRel)")
                } catch {
                    summary.errors += 1
                    activity("Could not rename \(entry.relativePath): \(error.localizedDescription)")
                    return
                }
            }
            entry.relativePath = expectedRel
            index.entries[id] = entry
        }

        guard item.hash != entry.hash else { return } // remote unchanged; push owns local edits

        let localHash = fileHash(expectedURL)
        if localHash == nil || localHash == entry.hash {
            // Missing (resurrect) or clean: take the server's copy.
            if let written = download(id, to: expectedURL, client: client) {
                entry.hash = written
                entry.fileMtime = fileMtime(expectedURL)
                index.entries[id] = entry
                summary.pulled += 1
                activity("Pulled \(expectedRel)")
            } else {
                summary.errors += 1
                activity("Could not pull \(expectedRel)")
            }
            return
        }

        // Both sides changed: the server copy wins the canonical name, the
        // local edit survives as a conflicted copy that is never auto-pushed.
        if let kept = preserveAsConflictedCopy(expectedURL) {
            activity("Conflict on \(expectedRel); your edit is \(kept.lastPathComponent)")
        }
        if let written = download(id, to: expectedURL, client: client) {
            entry.hash = written
            entry.fileMtime = fileMtime(expectedURL)
            index.entries[id] = entry
            summary.conflicts += 1
        } else {
            summary.errors += 1
            activity("Could not pull \(expectedRel) after conflict")
        }
    }

    // MARK: Push

    private func pushPass(
        _ workspace: Workspace, client: ServerClient, root: URL,
        index: inout SyncIndex, summary: inout SyncSummary
    ) -> Bool {
        let fm = FileManager.default

        // 1. Local deletions: an index row whose file is gone. The pull phase
        // already resurrected files the server had changed, so what is left
        // is a safe delete.
        for (postId, entry) in index.entries {
            let url = root.appendingPathComponent(entry.relativePath)
            guard !fm.fileExists(atPath: url.path) else { continue }
            switch client.deleteFile(postId: postId) {
            case .success:
                index.entries.removeValue(forKey: postId)
                summary.pushed += 1
                activity("Deleted \(entry.relativePath) on the server")
            case .failure(let error):
                summary.errors += 1
                activity("Could not delete \(entry.relativePath): \(error)")
            }
        }

        // 2. Local edits: file hash moved off the indexed hash.
        for (postId, entry) in index.entries {
            var entry = entry
            let url = root.appendingPathComponent(entry.relativePath)
            guard let data = try? Data(contentsOf: url) else { continue }
            let localHash = sha256Hex(data)
            guard localHash != entry.hash else {
                if entry.fileMtime != fileMtime(url) {
                    entry.fileMtime = fileMtime(url)
                    index.entries[postId] = entry
                }
                continue
            }
            if rejectedContent[entry.relativePath] == localHash { continue }
            guard let body = String(data: data, encoding: .utf8) else {
                summary.errors += 1
                activity("\(entry.relativePath) is not UTF-8; not pushed")
                continue
            }

            switch client.putFile(postId: postId, body: body, ifMatch: entry.hash) {
            case .success(.saved(let item)):
                rejectedContent.removeValue(forKey: entry.relativePath)
                let dirPart = (entry.relativePath as NSString).deletingLastPathComponent
                let newRel = dirPart.isEmpty ? "\(item.slug).md" : "\(dirPart)/\(item.slug).md"
                var fileURL = url
                if newRel != entry.relativePath {
                    let target = root.appendingPathComponent(newRel)
                    if fm.fileExists(atPath: target.path) { preserveAsConflictedCopy(target) }
                    try? fm.moveItem(at: fileURL, to: target)
                    fileURL = target
                    entry.relativePath = newRel
                }
                // Converge canonicalization: rewrite the local file only when
                // the server's render differs from what we just sent.
                if item.hash != localHash {
                    if let written = download(postId, to: fileURL, client: client) {
                        entry.hash = written
                    } else {
                        entry.hash = item.hash // next pass re-pulls via the manifest
                    }
                } else {
                    entry.hash = item.hash
                }
                entry.fileMtime = fileMtime(fileURL)
                index.entries[postId] = entry
                summary.pushed += 1
                activity("Pushed \(entry.relativePath)")
            case .success(.conflict):
                // 412: the post changed underneath us. Same resolution as the
                // pull-side conflict.
                if let kept = preserveAsConflictedCopy(url) {
                    activity("Conflict on \(entry.relativePath); your edit is \(kept.lastPathComponent)")
                }
                if let written = download(postId, to: url, client: client) {
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
            let dir = root.appendingPathComponent(folder.path, isDirectory: true)
            let contents = directoryContents(dir)
            for child in contents {
                let name = child.lastPathComponent
                guard isDirectory(child) else { continue }
                guard shouldScanDirectory(named: name) else { continue }
                let childPath = childFolderPath(parentPath: folder.path, name: name)
                guard !knownFolderPaths.contains(childPath) else { continue }
                if let created = createFolderForLocalDirectory(
                    child, parent: folder, client: client, root: root, summary: &summary
                ) {
                    knownFolderPaths.insert(created.path)
                    createdFolders = true
                }
            }
        }

        // 4. New local files: .md files in a folder dir with no index row.
        let indexedPaths = Set(index.entries.values.map { $0.relativePath })
        for folder in workspace.folders {
            let dir = root.appendingPathComponent(folder.path, isDirectory: true)
            let contents = directoryContents(dir)
            for fileURL in contents {
                guard !isDirectory(fileURL) else { continue }
                guard fileURL.pathExtension.lowercased() == "md" else { continue }
                let name = fileURL.lastPathComponent
                guard !name.hasPrefix(".") else { continue }
                guard !isConflictedCopy(fileURL) else { continue } // never auto-pushed
                let rel = "\(folder.path)/\(name)"
                guard !indexedPaths.contains(rel) else { continue }
                pushNewFile(fileURL, rel: rel, folder: folder, client: client,
                            root: root, index: &index, summary: &summary)
            }
        }
        return createdFolders
    }

    private func createFolderForLocalDirectory(
        _ dir: URL, parent: WorkspaceFolder, client: ServerClient, root: URL,
        summary: inout SyncSummary
    ) -> WorkspaceFolder? {
        let localName = dir.lastPathComponent
        let localPath = childFolderPath(parentPath: parent.path, name: localName)
        switch client.createFolder(parentPath: parent.path, name: localName) {
        case .failure(let error):
            summary.errors += 1
            activity("Could not create folder \(localPath): \(error)")
            return nil
        case .success(let created):
            let serverSegment = lastSegment(of: created.path)
            if serverSegment != localName {
                let target = root.appendingPathComponent(created.path, isDirectory: true)
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
        _ fileURL: URL, rel: String, folder: WorkspaceFolder, client: ServerClient,
        root: URL, index: inout SyncIndex, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        guard let data = try? Data(contentsOf: fileURL),
              let text = String(data: data, encoding: .utf8) else {
            summary.errors += 1
            activity("\(rel) is not readable UTF-8; not pushed")
            return
        }
        let localHash = sha256Hex(data)
        if rejectedContent[rel] == localHash { return }

        // A file in notes/ without a kind is a note, and so on: the folder it
        // sits in wins when the frontmatter is silent. (Blog is the server's
        // default already, so blog-mode files go up as-is.)
        let body = bodyEnsuringKind(text, folderMode: folder.mode)

        switch client.postFile(body: body) {
        case .success(.saved(let item)):
            rejectedContent.removeValue(forKey: rel)
            guard let id = item.id else {
                summary.errors += 1
                activity("Server created \(rel) without an id")
                return
            }
            // The server's slug names the file from here on.
            let newRel = "\(folder.path)/\(item.slug).md"
            var target = fileURL
            if newRel != rel {
                target = root.appendingPathComponent(newRel)
                if fm.fileExists(atPath: target.path) { preserveAsConflictedCopy(target) }
                try? fm.moveItem(at: fileURL, to: target)
            }
            // Converge on the server's canonical render (it adds schema,
            // canonical URL, and normalized frontmatter).
            if let written = download(id, to: target, client: client) {
                index.entries[id] = IndexEntry(hash: written, relativePath: newRel,
                                               fileMtime: fileMtime(target))
            } else {
                index.entries[id] = IndexEntry(hash: item.hash, relativePath: newRel,
                                               fileMtime: fileMtime(target))
            }
            summary.pushed += 1
            activity("Published \(newRel) as \(item.status)")
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
        _ folders: [WorkspaceFolder], root: URL, summary: inout SyncSummary
    ) {
        let fm = FileManager.default
        for folder in folders {
            let dir = root.appendingPathComponent(folder.path, isDirectory: true)
            do {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
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

    /// "<slug> (conflicted copy 2026-07-06 1423).md" next to the original.
    @discardableResult
    private func preserveAsConflictedCopy(_ url: URL) -> URL? {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return nil }
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
            try fm.moveItem(at: url, to: candidate)
            return candidate
        } catch {
            return nil
        }
    }

    private func isConflictedCopy(_ url: URL) -> Bool {
        url.lastPathComponent.contains(" (conflicted copy ")
    }

    /// Fetch the server's render of a post and write it (atomically) to url.
    /// Returns the sha256 of the bytes written, so the caller's index entry
    /// always matches the file that is actually on disk.
    private func download(_ postId: String, to url: URL, client: ServerClient) -> String? {
        switch client.fileText(postId: postId) {
        case .failure:
            return nil
        case .success(let (text, _)):
            let data = Data(text.utf8)
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                        withIntermediateDirectories: true)
                try data.write(to: url, options: .atomic)
            } catch {
                return nil
            }
            return sha256Hex(data)
        }
    }

    /// The workspace folder a relative path lives in (longest path prefix).
    private func folderPath(of relativePath: String, in folders: [WorkspaceFolder]) -> WorkspaceFolder? {
        var best: WorkspaceFolder?
        for folder in folders where relativePath.hasPrefix(folder.path + "/") {
            if best == nil || folder.path.count > (best?.path.count ?? 0) { best = folder }
        }
        return best
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
            try fm.moveItem(at: source, to: target)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func fileHash(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return sha256Hex(data)
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
