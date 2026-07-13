import CryptoKit
import FileProvider
import Foundation
import WriteFileProviderKit
import WriteWorkspaceCore

/// Pushes local Finder edits on the File Provider mount to the server the moment
/// they happen, instead of waiting on macOS's own (slow, deprioritized) File
/// Provider upload scheduler. Strictly ONE-WAY (mount -> server): it watches the
/// mount and, on any change, re-derives the diff against FRESHLY fetched server
/// truth and pushes it (title rename, folder rename, content edit, move). It
/// NEVER writes the mount (the File Provider owns server -> mount) and NEVER
/// deletes. Because every pass diffs against live server state, it cannot fight
/// the File Provider's own writes or loop: once mount == server there is no diff,
/// so a change the File Provider itself materialized is never re-pushed.
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
    /// Content hashes the server rejected (400): don't hot-loop re-pushing a bad
    /// file until its bytes change.
    private var rejected: [String: String] = [:]

    /// Begin watching the mount root. Idempotent: re-starting on the same root is
    /// a no-op, so it is safe to call from every materialize pass.
    func start(mountRoot root: URL, manager: NSFileProviderManager) {
        queue.async { [weak self] in
            guard let self else { return }
            if self.mountRoot == root, self.watcher != nil { return }
            self.mountRoot = root
            self.manager = manager
            self.watcher?.stop()
            // 0.3s FSEvents latency + a 0.4s debounce ~= sub-second push, vs the
            // OS's seconds-to-minutes. includeUbiquitousItems: false because the
            // NSMetadataQuery is for iCloud items and is noise over CloudStorage.
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

    /// External poke (e.g. after a materialize). Harmless: a remote-driven
    /// materialize yields mount == server, so it pushes nothing.
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
        // Fresh server truth: slug -> post, and folder id -> name.
        guard case .success(let ws) = await api.workspace() else { return }
        var bySlug: [String: ServerPost] = [:]
        var folderName: [String: String] = [:]
        for folder in ws.folders {
            folderName[folder.id] = folder.name
            if case .success(let items) = await api.manifest(folderId: folder.id) {
                for item in items {
                    if let id = item.id, !id.isEmpty {
                        bySlug[item.slug] = ServerPost(
                            postId: id, folderId: folder.id, title: item.title, hash: item.hash)
                    }
                }
            }
        }

        // Walk the mount.
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

        // FOLDER RENAME: a mount folder whose name no longer matches the server.
        for dir in dirs {
            guard let fid = folderId(for: dir, bySlug: bySlug) else { continue }
            let name = dir.lastPathComponent
            if let serverName = folderName[fid], !name.isEmpty, serverName != name {
                if case .success = await api.renameFolder(folderId: fid, name: name) {
                    onActivity?("Renamed folder to \(name)")
                }
            }
        }

        // FILE axes: title rename, move, content edit.
        for file in files {
            if Self.isDataless(file) { continue } // no local edit; don't force a fetch
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            guard let slug = MountFrontmatter.value(text, "slug"), !slug.isEmpty,
                  let post = bySlug[slug] else { continue } // new/foreign file -> the FP owns creates

            let filenameTitle = WriteFilename.titleFromFilename(file.lastPathComponent)
            // Compare against the server title's DISPLAY leaf so a sanitized or
            // disambiguated filename ("Foo (2).md") is not seen as a rename.
            let needTitle = !filenameTitle.isEmpty
                && filenameTitle != WriteFilename.displayLeaf(title: post.title, slug: slug)

            var newFolderId: String?
            if let parentId = folderId(
                for: file.deletingLastPathComponent(),
                bySlug: bySlug, excluding: post.postId), parentId != post.folderId {
                newFolderId = parentId
            }
            let needMove = newFolderId != nil

            // Content: cheap whole-file check first (matches the manifest hash when
            // in sync); only on a difference fetch the server file and compare with
            // the TITLE line stripped, so the frontmatter-title lag window (server
            // retitled, mount not yet re-materialized) is not mistaken for a body
            // edit that would revert the title. This is the loop-critical bit.
            var needContent = false
            let mountHash = Self.sha256(text)
            if mountHash != post.hash, case .success(let server) = await api.fileText(postId: post.postId) {
                needContent = Self.sha256(MountFrontmatter.stripTitle(text))
                    != Self.sha256(MountFrontmatter.stripTitle(server.text))
            }

            if needContent {
                if rejected[post.postId] == mountHash { continue }
                // A content PUT carries the title too: the intended title is the
                // filename's when renamed, else the server's (a body edit must not
                // change the title).
                let title = needTitle ? filenameTitle : post.title
                let body = MountFrontmatter.setTitle(text, title)
                switch await api.putFile(postId: post.postId, body: body, ifMatch: post.hash) {
                case .success(let saved):
                    onActivity?("Synced edits to \(title)")
                    if let nf = newFolderId {
                        _ = await api.patchFile(
                            postId: post.postId, folderId: nf, slug: nil, title: nil, ifMatch: saved.hash)
                    }
                case .failure(.rejected):
                    rejected[post.postId] = mountHash // don't re-push until it changes
                case .failure:
                    break // conflict/transient: the next pass reconciles against fresh truth
                }
            } else if needTitle || needMove {
                if case .success = await api.patchFile(
                    postId: post.postId,
                    folderId: needMove ? newFolderId : nil,
                    slug: nil,
                    title: needTitle ? filenameTitle : nil,
                    ifMatch: post.hash) {
                    if needTitle { onActivity?("Renamed to \(filenameTitle)") }
                }
            }
        }
    }

    /// The server folder id for a mount directory, by a majority vote of the
    /// server folder ids of the `.md` files directly inside it. A folder keeps
    /// the same posts across a rename, so the vote survives a rename. Returns nil
    /// for a folder with no resolvable posts (e.g. an empty folder) -> that pass
    /// skips it and the File Provider's own scheduler handles it eventually.
    private func folderId(
        for dir: URL, bySlug: [String: ServerPost], excluding: String? = nil
    ) -> String? {
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
