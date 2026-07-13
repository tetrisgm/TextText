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

    private let queue = DispatchQueue(label: "net.writeapp.write.mountbridge", qos: .utility)
    private var watcher: WorkspaceFolderWatcher?
    private var debounce: DispatchWorkItem?
    private var mountRoot: URL?
    private var manager: NSFileProviderManager?
    private var inFlight = false
    private var pending = false
    /// postId -> the (server hash, filename) the mount and server last agreed on.
    /// In-memory: on launch the first pass just seeds it (acts on the next change).
    private var baseline: [String: Baseline] = [:]
    /// Content the server rejected (400): don't hot-loop re-pushing it.
    private var rejected: [String: String] = [:]

    private struct Baseline { var hash: String; var name: String }

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
            let mountHash = Self.sha256(text)
            let serverName = WriteFilename.filename(title: post.title, slug: slug)
            let base = baseline[post.postId]

            // Steady state: agreed. (Re)seed the baseline and move on.
            if mountHash == post.hash, name == serverName {
                baseline[post.postId] = Baseline(hash: post.hash, name: name)
                continue
            }
            // First sight of a divergence with no baseline: cannot tell direction
            // safely, so seed and let the next change act (the FP is the backstop).
            guard let base else {
                baseline[post.postId] = Baseline(hash: post.hash, name: name)
                continue
            }

            let localEdit = mountHash != base.hash || name != base.name
            let serverEdit = post.hash != base.hash || serverName != base.name

            if localEdit && !serverEdit {
                await push(file: file, text: text, name: name, post: post, slug: slug, api: api, mountHash: mountHash)
            } else if serverEdit && !localEdit {
                await pull(post: post, slug: slug, handle: ctx.handle, manager: manager)
            } else if localEdit && serverEdit {
                // Conflict: prefer the server (the FP keeps a conflict copy of the
                // local edit); losing a server edit would be worse.
                await pull(post: post, slug: slug, handle: ctx.handle, manager: manager)
            }
        }
    }

    /// Push a local mount edit to the server.
    private func push(
        file: URL, text: String, name: String, post: ServerPost, slug: String,
        api: WriteSyncAPI, mountHash: String
    ) async {
        let filenameTitle = WriteFilename.titleFromFilename(name)
        let needTitle = !filenameTitle.isEmpty
            && filenameTitle != WriteFilename.displayLeaf(title: post.title, slug: slug)

        // Content: only a real BODY difference (title-stripped) is a content edit;
        // a title-only difference is the filename axis above.
        var needContent = false
        if mountHash != post.hash, case .success(let server) = await api.fileText(postId: post.postId) {
            needContent = Self.sha256(MountFrontmatter.stripTitle(text))
                != Self.sha256(MountFrontmatter.stripTitle(server.text))
        }

        if needContent {
            if rejected[post.postId] == mountHash { return }
            let title = needTitle ? filenameTitle : post.title
            let body = MountFrontmatter.setTitle(text, title)
            switch await api.putFile(postId: post.postId, body: body, ifMatch: post.hash) {
            case .success(let saved):
                onActivity?("Synced edits to \(title)")
                baseline[post.postId] = Baseline(hash: saved.hash, name: name)
            case .failure(.rejected):
                rejected[post.postId] = mountHash
            case .failure:
                break // transient/conflict: next pass reconciles against fresh truth
            }
        } else if needTitle {
            if case .success(let saved) = await api.patchFile(
                postId: post.postId, folderId: nil, slug: nil, title: filenameTitle, ifMatch: post.hash) {
                onActivity?("Renamed to \(filenameTitle)")
                baseline[post.postId] = Baseline(hash: saved.hash, name: name)
            }
        }
    }

    /// Pull a server edit into the mount: evict the stale local copy so the File
    /// Provider re-downloads it fresh (updated content + the title-derived name).
    /// Eviction is safe here because this path only runs when the mount is clean
    /// relative to the baseline (no un-pushed local edit to lose).
    private func pull(post: ServerPost, slug: String, handle: String, manager: NSFileProviderManager) async {
        let identifier = NSFileProviderItemIdentifier(
            rawValue: WriteItemIdentifier.file(handle: handle, id: post.postId).rawValue)
        await withCheckedContinuation { continuation in
            manager.evictItem(identifier: identifier) { _ in continuation.resume() }
        }
        // A dataless file re-materializes on read; signal the enumerator so the
        // system re-fetches (and applies the new title-derived name) promptly.
        manager.signalEnumerator(for: .workingSet) { _ in }
        onActivity?("Updated \(WriteFilename.filename(title: post.title, slug: slug)) from the app")
        baseline[post.postId] = Baseline(
            hash: post.hash, name: WriteFilename.filename(title: post.title, slug: slug))
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
