# T1: nested folder sync in the Mac app

You are extending Texttext's sync engine (Swift, SwiftPM, in `mac/`) to
support NESTED folders. The server already ships them: folders now carry a
FULL slash path (`blog`, `blog/ideas`, `notes/work/clients`), and
`GET /api/sync/v1/workspace` returns every folder (subfolders included) as
a flat list of `{id, name, path, mode}`. A subfolder IS a folder with a
deeper path. Mode is inherited server-side; you never compute it.

## File ownership (STRICT)

- You may edit ONLY: `mac/Sources/Write/SyncEngine.swift`,
  `mac/Sources/Write/ServerClient.swift`.
- NEVER touch: AppDelegate.swift, ChangeListener.swift, CaptureAgent.swift,
  OpenFileHandler.swift, Info.plist, anything under `src/`, anything else.
- Commit nothing. Run no servers. Do not `npm run dev`.

## What to build

1. **Directory materialization**: for every folder in the workspace list,
   ensure the local directory `<syncRoot>/<folder.path>` exists
   (create intermediate directories). Deeper paths simply work because the
   server sends each subfolder as its own folder entry.
2. **Per-folder scanning stays ONE level**: when scanning folder F for
   local .md files, list only F's immediate directory entries; a
   subdirectory of F is either (a) a known folder path from the workspace
   list (skip it here, it scans as its own folder) or (b) an UNKNOWN new
   directory the user just created in Finder.
3. **New local directories become server folders**: for case (b), call the
   new endpoint `POST /api/sync/v1/folders` with JSON
   `{"parent_path": "<F.path>", "name": "<dirname>"}` (bearer token, same
   auth as other calls). 201 returns `{folder: {id, name, path, mode,
   parentId}}`. Add `createFolder(parentPath:name:)` to ServerClient.
   After creating, treat it like any workspace folder (files inside it
   sync on the next pass; triggering an immediate follow-up pass is fine
   if the engine already has a mechanism).
   - The server slugifies names (may differ from the local dirname, e.g.
     "My Ideas" -> my-ideas). After the POST, if the returned path's last
     segment differs from the local dirname, RENAME the local directory to
     the returned segment so disk and server agree.
   - Depth cap is 4 segments; the server 400s beyond that. Surface the
     error through the engine's existing activity reporting if easy,
     otherwise skip the directory silently this pass.
4. **Deletes**: unchanged semantics. Folder deletion is OUT OF SCOPE
   (server has no folder-delete endpoint yet); never delete local
   directories.
5. **Ignore rules**: keep ignoring dotfiles/dot-directories and the trash/
   breadcrumb machinery exactly as today. Also ignore directories named
   `*.assets` (reserved for bookmark capture artifacts, another track).

## Conventions

- Read `mac/Sources/Write/` first and match its style exactly (comment
  density, guard style, queue usage). Read SyncEngine fully before editing.
- The mass-deletion breadcrumb guard must keep working; if your change
  affects what "the root vanished" looks like, reason about it in a
  comment.
- No em dashes anywhere, including comments.

## Verify (must pass before you finish)

- `swift build --package-path mac` clean.
- Reason through and state (in your final summary) the exact pass behavior
  for: (a) server has blog/ideas with 2 files, fresh local root; (b) user
  mkdirs ~/Texttext/blog/research and drops a .md inside; (c) user creates
  ~/Texttext/blog/too/deep/nested/beyond/cap.
- `WRITE_HEADLESS=1` mode must still compile and run (do not test against
  a live server; no network in your sandbox).
