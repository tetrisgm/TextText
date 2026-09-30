# File-vault collaboration checkpoint

## Implemented

A pure full-document Yjs engine seeds one deterministic baseline from the actual
TextPack and merges bounded updates while retaining embedded templates, binary
assets, authoring source and opaque archive entries. It rejects unsupported Yjs
roots/types, unresolved dependencies, invalid snapshots and absent template
references. Temporary Y.Docs are destroyed. Duplicate changes preserve exact
pack bytes.

The filesystem store persists a collaboration checkpoint beneath
`.texttext/collaboration`, using stable item identity rather than path. Pushes
share the existing workspace lock, durable intent, history, operation receipts
and required audit sink. Pack and checkpoint are durable before acknowledgement.
Replay repairs an interrupted materialization. Ordinary file writes invalidate
old sessions; reads detect changed actual bytes and advance the epoch. Rename
keeps the session; deleted files reject new updates. Store wrappers retain the
single application content boundary.

## Verification

- 33 tests across engine, collaboration persistence and existing server-store
  suites passed: `/tmp/texttext-file-collaboration-tests.log`.
- Tests cover two concurrent Yjs clients, metadata/presentation convergence,
  complete-pack preservation, duplicate operations, rename, direct file edits,
  normal-write/restore and observed raw edit/revert generation fencing, corrupt
  checkpoint rejection, deletion, audit outage and recovery
  before/after the materialized file write.
- TypeScript and scoped ESLint checks: `/tmp/texttext-file-collaboration-tsc.log`
  and `/tmp/texttext-file-collaboration-eslint.log`.

## Remaining integration and limits

This is backend groundwork, not user-visible multiplayer. No endpoint or editor
has been switched on, no installed build changed, and no live two-person
acceptance is claimed. Build 1134 and the recovery web server remain in use.

Next: named-workspace permissions and scoped grants, authenticated relay routes,
provider transport/outbox namespace injection, native credential-safe bridge,
authoritative editor baseline and disabling competing snapshot autosaves,
presence/comments, independent undo and reconnect/revocation acceptance.

Every accepted batch currently materializes a complete pack. Before enabling
interactive traffic, measure/reduce write amplification for large assets and
use change-driven waiting rather than idle polling. State is capped at 4 MiB;
checkpoint compaction/epoch retirement with pending-edit recovery remains to be
integrated. The filesystem mutex coordinates store writers; arbitrary processes
that ignore it can race a write. Observed external changes fence sessions, but
an unobserved external edit-and-revert cannot be inferred from identical bytes.
