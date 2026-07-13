import CryptoKit
import FileProvider
import Foundation
import WriteFileProviderKit
import WriteWorkspaceCore

/// Keeps the File Provider mount and the server in sync FAST in BOTH directions,
/// because macOS does it on its own slow, deprioritized schedule. It watches the
/// mount and, on any local or remote change, reconciles each post:
///  - a local Finder edit (rename / body edit / move) is PUSHED to the server
///    (PATCH title, PUT content, PATCH folder);
///  - a server edit (made in the app) is PULLED into the mount by evicting the
///    stale local copy so the File Provider re-downloads it fresh.
///
/// Direction is decided by a per-post BASELINE: the (hash, filename) both sides
/// last agreed on. If only the mount moved off the baseline it is a local edit
/// (push); if only the server moved it is a remote edit (pull); if both moved it
/// is a conflict, resolved by pulling the server (the File Provider keeps a
/// conflict copy of the local version). This is what makes it safe: it never
/// pushes a stale mount over an app edit, and never evicts an un-pushed local
/// edit. It never deletes and never creates (the File Provider still owns those).
final class MountBridge {
    struct Context { let api: WriteSyncAPI; let handle: String; let workspaceName: String }
    /// Rebuilt per pass, so a sign in/out needs no plumbing here.
    var makeContext: () -> Context? = { nil }
    var onActivity: ((String) -> Void)?
    /// Called after a pull evicts a stale local file, to re-download it promptly.
    var onRefresh: (() -> Void)?

    private let queue = DispatchQueue(label: "net.writeapp.write.mountbridge", qos: .utility)
    private var watcher: WorkspaceFolderWatcher?
    private var debounce: DispatchWorkItem?
    private var mountRoot: URL?
    private var manager: NSFileProviderManager?
    private var inFlight = false
    private var pending = false
    /// postId -> the title and (title-stripped) body signature the mount and
    /// server last agreed on. Title and body are SEPARATE axes so a title rename
    /// and a body edit never interfere. In-memory: the first pass seeds it.
    private var baseline: [String: Baseline] = [:]
    /// Content the server rejected (400): don't hot-loop re-pushing it.
    private var rejected: [String: String] = [:]

    private struct Baseline { var title: String; var body: String }

    func start(mountRoot root: URL, manager: NSFileProviderManager) {
        queue.async { [weak self] in
            guard let self else { return }
            if self.mountRoot == root, self.watcher != nil { return }
            self.mountRoot = root
            self.manager = manager
            self.watcher?.stop()
            self.watcher = WorkspaceFolderWatcher(
                path: root.path, queue: self.queue,
                includeUbiquitousItems: false, latency: 0.3
            ) { [weak self] in self?.scheduleOnQueue() }
            self.scheduleOnQueue()
        }
    }

    func stop() {
        queue.async { [weak self] in
            self?.debounce?.cancel()
            self?.watcher?.stop()
            self?.watcher = nil
            self?.mountRoot = nil
        }
    }

    /// Poke a pass. Wired to the app's remote-change signal so a server edit is
    /// pulled into the mount promptly (the mount itself does not fire FSEvents
    /// when only the server changed).
    func nudge() { queue.async { [weak self] in self?.scheduleOnQueue() } }

    private func scheduleOnQueue() {
        debounce?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.run() }
        debounce = work
        queue.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func run() {
        if inFlight { pending = true; return }
        guard let root = mountRoot, let manager, let ctx = makeContext() else { return }
        inFlight = true
        Task { [weak self] in
            await self?.reconcile(root: root, manager: manager, ctx: ctx)
            self?.queue.async {
                guard let self else { return }
                self.inFlight = false
                if self.pending { self.pending = false; self.run() }
            }
        }
    }

    // MARK: The pass

    private struct ServerPost { let postId: String; let folderId: String; let title: String; let hash: String }

    private func reconcile(root: URL, manager: NSFileProviderManager, ctx: Context) async {
        let api = ctx.api
        guard case .success(let ws) = await api.workspace() else { return }
        var bySlug: [String: ServerPost] = [:]
        var folderName: [String: String] = [:]
        for folder in ws.folders {
            folderName[folder.id] = folder.name
            if case .success(let items) = await api.manifest(folderId: folder.id) {
                for item in items where (item.id ?? "").isEmpty == false {
                    bySlug[item.slug] = ServerPost(
                        postId: item.id!, folderId: folder.id, title: item.title, hash: item.hash)
                }
            }
        }

        let fm = FileManager.default
        var dirs: [URL] = []
        var files: [URL] = []
        if let walker = fm.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey]) {
            for case let url as URL in walker {
                let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
                if isDir { dirs.append(url) }
                else if url.pathExtension == "md" { files.append(url) }
            }
        }

        // FOLDER RENAME (push only; the FP handles a server-side folder rename by
        // re-enumeration). A folder keeps its posts across a rename, so a
        // majority vote of the contained posts resolves its id.
        for dir in dirs {
            guard let fid = folderId(for: dir, bySlug: bySlug) else { continue }
            let name = dir.lastPathComponent
            if let serverName = folderName[fid], !name.isEmpty, serverName != name {
                if case .success = await api.renameFolder(folderId: fid, name: name) {
                    onActivity?("Renamed folder to \(name)")
                }
            }
        }

        for file in files {
            if Self.isDataless(file) { continue }
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            guard let slug = MountFrontmatter.value(text, "slug"), !slug.isEmpty,
                  let post = bySlug[slug] else { continue }

            let name = file.lastPathComponent
            let filenameTitle = WriteFilename.titleFromFilename(name)
            let serverName = WriteFilename.filename(title: post.title, slug: slug)
            let mountBody = Self.sha256(MountFrontmatter.stripTitle(text))
            let mountFull = Self.sha256(text)

            // First sight: seed from the current mount and act on the next change
            // (the File Provider reconciles any pre-existing divergence).
            guard let base = baseline[post.postId] else {
                baseline[post.postId] = Baseline(title: filenameTitle, body: mountBody)
                continue
            }

            var didPull = false
            var newTitle = base.title
            var newBody = base.body

            // ---- TITLE / NAME axis ----
            if name == serverName {
                newTitle = post.title // agreed
            } else {
                let filenameMoved = filenameTitle != base.title // user renamed the file
                let serverMoved = post.title != base.title       // app retitled the post
                if filenameMoved && !serverMoved {
                    if case .success = await api.patchFile(
                        postId: post.postId, folderId: nil, slug: nil,
                        title: filenameTitle, ifMatch: post.hash) {
                        onActivity?("Renamed to \(filenameTitle)")
                        newTitle = filenameTitle
                    }
                } else if serverMoved {
                    // App retitled -> pull: the FP renames the mount file + refreshes
                    // its frontmatter. Anchor the baseline to the CURRENT filename
                    // title (not the server's), so the rename lag is seen as
                    // still-catching-up, never as a fresh local rename to push back.
                    didPull = true
                    newTitle = filenameTitle
                }
            }

            // ---- CONTENT axis (title-stripped, so it can't fight the title axis) ----
            if mountFull != post.hash, case .success(let server) = await api.fileText(postId: post.postId) {
                let serverBody = Self.sha256(MountFrontmatter.stripTitle(server.text))
                if mountBody == serverBody {
                    newBody = serverBody // only the title line differs; body agrees
                } else {
                    let localMoved = mountBody != base.body
                    let serverBodyMoved = serverBody != base.body
                    if localMoved && !serverBodyMoved {
                        if rejected[post.postId] != mountFull {
                            let pushTitle = (name != serverName && filenameTitle != base.title)
                                ? filenameTitle : post.title
                            switch await api.putFile(
                                postId: post.postId,
                                body: MountFrontmatter.setTitle(text, pushTitle),
                                ifMatch: post.hash) {
                            case .success: onActivity?("Synced edits"); newBody = mountBody
                            case .failure(.rejected): rejected[post.postId] = mountFull
                            case .failure: break
                            }
                        }
                    } else if serverBodyMoved {
                        didPull = true // app edited the body -> pull
                    }
                }
            } else if mountFull == post.hash {
                newBody = mountBody // fully in sync
            }

            if didPull {
                await pull(post: post, manager: manager)
            }
            baseline[post.postId] = Baseline(title: newTitle, body: newBody)
        }
    }

    /// Pull a server edit into the mount. The `downloadLazilyAndEvictOnRemoteUpdate`
    /// content policy makes the SYSTEM evict a remotely-updated file itself, so we
    /// do not evict manually (a manual evict fought the old keep-downloaded policy
    /// and left files stale). We just nudge: re-enumerate so the system notices the
    /// new version (and applies the new title-derived name), and re-materialize so
    /// the freshly-evicted file re-downloads instead of lingering dataless. Safe:
    /// this only runs when the axis found the mount unchanged vs the baseline.
    private func pull(post: ServerPost, manager: NSFileProviderManager) async {
        manager.signalEnumerator(for: .workingSet) { _ in }
        onRefresh?()
        onActivity?("Updated \(post.title) from the app")
    }

    private func folderId(for dir: URL, bySlug: [String: ServerPost], excluding: String? = nil) -> String? {
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

    /// The file with the frontmatter `title:` line removed, for a content
    /// signature that ignores a title-only difference.
    static func stripTitle(_ text: String) -> String {
        guard text.hasPrefix("---\n") else { return text }
        var out: [String] = []
        var inFrontmatter = false
        for (index, line) in lines(text).enumerated() {
            if index == 0, line == "---" { inFrontmatter = true; out.append(line); continue }
            if inFrontmatter, line == "---" { inFrontmatter = false; out.append(line); continue }
            if inFrontmatter, line.hasPrefix("title:") { continue }
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
