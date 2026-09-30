# TextText file vault architecture

Owner clarification, 2026-09-29: build the file-based architecture already
required by [SPEC.md](../SPEC.md). Replace the database-centered content path.
Legacy export, shadow migration, and backward compatibility are not prerequisites.
This document replaces the earlier migration proposal. The installed app still
uses the old storage path; the replacement is not implemented yet.

## The contract

- A workspace is a normal folder. Its subfolders contain `.textpack` documents.
- A TextPack carries the content, metadata, assets, pinned template, and editable
  template source needed to use it. Templates use these same file primitives.
- The Mac opens and saves those files directly, including offline. Local agents
  can edit the files with ordinary filesystem tools. A special agent API or a
  running server is not required for a local edit.
- The web edits the same document model through a synchronized server vault.
  The Mac can be offline while web users or collaborators continue working.
- Sync exchanges changes and reconciles revisions. Reading a file or leaving
  the app idle does not upload it again. Saved locally and synchronized are
  distinct states; the interface only needs attention when action is required.
- Content indexes are rebuildable from the files. Accounts, permissions,
  publication grants, and audit remain service metadata. Editing a file cannot
  grant access or publish private content.

## One document across files and live editing

Keep the validated schema-v1 `DocumentSnapshot`, TextPack format, shared renderer,
and Yjs collaboration machinery. Replace where they load and save content.
Yjs handles live editing; TextPacks are the durable, portable file form.

An external edit may update `text.md`, structured fields, template source, or
assets. Compare it with the last observed pack to identify what changed and
reconcile the snapshot and Markdown projection. Never ignore edited Markdown
because an older `document.json` is still present. Malformed or incomplete
packs stay on disk with a recoverable error; sync must not overwrite them.

Each document has an ID assigned locally at creation. Renaming or moving a file
preserves that ID. Copying a file into another document must produce an independent
identity. Files carry their exact template version and required assets so a
copied vault remains usable without hidden content rows in Postgres.

## Conflict handling

Every replica keeps its last shared version. When a file changes, compute its
changes against that version and reconcile them with changes from other replicas.

- Different fields and non-overlapping text edits merge automatically.
- Concurrent live edits use the existing full-document Yjs protocol.
- Overlapping external edits preserve both versions and offer a visible
  resolution. A conflict must never silently discard either person's work.
- Deletion concurrent with an edit preserves the edited version for recovery.
- Retries reuse operation IDs. Restarting after a crash replays pending changes
  without duplicating documents or losing an acknowledged save.

Write complete packs beside their destination and atomically replace them.
Persist pending sync operations and their base revisions locally. The server
checks permissions and revision history before accepting a shared version,
then durably writes the pack and audit receipt. An offline local revision
remains valid local work while synchronization is pending.

## Build order

1. **Working local vault.** Open a fresh ordinary folder, create/read/edit/move
   TextPacks, and render them in the Mac app with the network unavailable.
   Verify raw agent file edits appear in the editor and editor saves appear on disk.
2. **Shared file sync.** Use a server vault with the same format and connect
   the web editor. Prove two replicas, offline edits, reconnect, concurrent
   changes, deletion conflicts, duplicate delivery, and crash recovery.
3. **Complete the existing product on those files.** Wire templates, assets,
   capture, reading, sharing, and agents through the same file-backed content
   boundary. Keep the existing UI and renderer where they already work.
4. **Remove the superseded content path.** Retire the database document store,
   duplicate template store, and Finder projection when their callers use the
   working vault. An exporter is not a gate. Do not delete unrelated user files
   or shared infrastructure as part of removing obsolete implementation.

The acceptance test is the user's workflow: edit a TextPack locally with an
agent while another person edits it on the web, reconnect, and retain both
people's work. Repeat after a crash. A test passing only against an in-memory
model or an HTTP document store does not establish that this architecture works.
