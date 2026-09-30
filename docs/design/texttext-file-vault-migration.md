# TextText file vault migration

Status: implementation design, 2026-09-29. No storage authority has changed.
This describes how to realize the file-first intent in [SPEC.md](../SPEC.md)
while retaining web access and shared editing.

## Target

On the Mac, each workspace is a normal, user-chosen folder tree of `.textpack`
files. A person can inspect, back up, move, and edit those files outside
TextText. A document's pack contains a stable item ID, its validated
`DocumentSnapshot`, Markdown projection, exact look, optional editable look
source, and asset bytes. Stable IDs and versions travel inside the pack, so a
filename or folder rename does not change identity. Folder metadata and
immutable template history live in files in the
same vault; personal templates become ordinary exemplar TextPacks in a
Templates folder.

The Mac vault accepts local edits first, including while offline. TextText
syncs it with a durable server vault of the same file tree for browser users and
collaborators. The server vault holds the accepted shared revision; an offline
Mac edit remains a local revision until the server accepts it. The database
remains useful for authentication, permissions, audit, presence, search, list
indexes, and synchronization receipts. Its content and template projections
must be rebuildable from the vault. The server still enforces access and
publication; a local file edit cannot grant access or
publish a private note.

Do not designate the current File Provider mount as the vault. It is a
server-backed projection and already has a sync owner. Choose a separate
user-visible local folder; do not put it under another live sync engine while
TextText sync owns it. The existing File Provider location can remain during
migration, then be retired after the direct vault path is proved.

## Write and reconciliation rules

1. The app, Finder, local CLI, and agents use one validated workspace mutation
   path behind `src/lib/store.ts`. The Mac app must read/write the local vault
   directly, rather than merely waiting for a server response to appear in
   Finder. Browser and remote-agent writes enter the matching server vault path.
2. Compare each write with its base revision and pack hash. Write a complete
   pack to a temporary file on the same volume, verify and sync it, retain the
   previous version, then atomically rename it into place and sync its parent
   directory. Record an operation ID, actor, and outcome in a replayable journal.
   Acknowledgment follows durable file and index/audit commits; a crash between
   them is reconciled from the journal. Index updates never become a second
   content authority.
3. Watch changed paths, not the entire vault on a timer. Parse and upload only
   changed pack hashes. An unchanged read or idle app sends no full content.
4. Keep the existing Yjs path for simultaneous in-app edits. Materialization
   follows the same revision check and epoch fence as other writes. An
   out-of-app file change is compared with its base hash and current document.
   Merge when safe; otherwise retain both copies and present a conflict. Never
   silently replace a person's file or live edit.
5. Keep folder identity, item identity, exact template pins, Trash, privacy,
   asset references, and action audit stable across moves and renames. Reject
   path traversal, symlinks escaping the vault, malformed packs, and invalid
   render specs before changing visible state.

## Migration sequence

1. **Inventory and reversible export.** Read existing Postgres rows and the
   current Finder sync state. Take verified backups. Export every item, folder,
   custom template version, feed item, and asset into a staging vault. Add a
   manifest of stable IDs, paths, revisions, pack hashes, and asset hashes.
   Round-trip parse every pack and compare its `DocumentSnapshot`, look, source,
   and binaries to the current store. Do not switch reads or remove the
   database copy.
2. **File-backed store behind the existing API.** Implement a vault adapter at
   the `src/lib/store.ts` boundary, with a derived index and replayable journal.
   Keep the existing web routes and workspace commands; change where their
   content operations land. Use local test vaults and focused fault injection
   for crashes between pack, index, and audit writes.
3. **Shadow and compare.** On each existing write, also materialize the pack in
   a staging mirror. Continuously compare file and database projections by
   stable ID and hash. Shadow mode cannot serve reads or publish content.
   Resolve mismatches and exercise restore before any cutover.
4. **Cut over one test workspace.** Briefly fence new writes, drain and
   materialize live Yjs sessions, verify parity, then enable file-backed reads
   and writes behind a per-workspace switch. Make the Mac editor and CLI use
   its local vault, then exercise Finder edits, offline edits, browser edits,
   two live collaborators, agent edits, template changes, folder moves, Trash,
   publishing boundaries, and large media. Keep the old database snapshot for
   rollback. Never delete
   files or database rows as part of the switch.
5. **Roll out and simplify.** Add a coordinated encrypted vault and database
   backup with a restore drill. After repeated parity and recovery checks, move
   other workspaces. Point Finder directly at the vault and retire the duplicate
   File Provider view only after its pending uploads are empty and the owner can
   inspect the resulting folder tree. Remove redundant database content
   storage only after restore drills prove the vault alone can rebuild it.

## Gates before calling it complete

- The same item can be opened and edited in TextText and as a `.textpack` in a
  normal folder; both routes produce one history and preserve concurrent edits.
- A copied vault plus account/permission data restores every document,
  template, folder, and asset without relying on `posts.document` or
  `document_templates.definition` as the only complete copy.
- A local offline edit, a remote collaborator edit, and an agent edit converge
  without losing either person's work. Privacy and publication still fail
  closed.
- Folder listing and search use an incremental index. Idle sync does not
  upload unchanged packs or show repeated Syncing/Synced states.

The current implementation has not passed these gates. In particular,
`posts.document` and `document_templates.definition` are authoritative today;
the File Provider tree is a projection, and the server backup packer does not
include asset bytes. These are migration work, not labels to change in the UI.

The first implementation slice is a read-only, asset-complete vault exporter and
round-trip verifier with a stable-ID/hash manifest. It changes no read or write
authority and gives the later shadow migration a measurable parity baseline.
