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

## Authenticated relay checkpoint

The named-workspace collaboration endpoint now supports an initial baseline,
bounded change waits and audited update batches. It resolves existing workspace
grants, allowing viewers/commenters to read and owners/editors to write. Token
access requires workspace sync scope; invalid tokens never fall back to cookies.
Cookie mutations require the same origin. Existing owner-only sync/recovery
routes retain their guards. Item/folder grants do not imply workspace access.

Permissions are checked again after each wait and inside the workspace lock
before committing an upload. Held-lock tests reject revocation and cancellation
while a writer is queued.
Fresh database reads bypass request-scoped caches for grants and ownership.
Unchanged responses omit the document state. Waiting uses a request-scoped
filesystem watcher and bounded timer, cleaned up on completion or cancellation;
it installs no persistent worker. Store access remains through store.ts.

- 38 checks across original/new authorization, route and persistence suites:
  `/tmp/texttext-vault-collaboration-api-tests.log`.
- Three local Postgres tests passed for named workspace lookup, role downgrade,
  revocation, scope isolation, ownership changes and deleted workspaces:
  `/tmp/texttext-vault-collaboration-permissions-db.log`. Temporary fixture rows
  were removed; existing account/workspace rows were untouched.
- TypeScript and scoped ESLint: `/tmp/texttext-vault-collaboration-api-tsc.log`
  and `/tmp/texttext-vault-collaboration-api-eslint.log` (two pre-existing store
  unused-symbol warnings).

## Remaining integration and limits

This is backend groundwork, not user-visible multiplayer. The new endpoint is
implemented but not yet built into the running server or connected to an editor.
No installed build changed and no live two-person acceptance is claimed. Build
1134 and the recovery web server remain in use.

Next: scoped item/folder grants and sharing UI, provider transport/outbox
namespace injection, native credential-safe bridge,
authoritative editor baseline and disabling competing snapshot autosaves,
presence/comments, independent undo and reconnect/revocation acceptance.

Every accepted batch currently materializes a complete pack. Before enabling
interactive traffic, measure/reduce write amplification for large assets and
use change-driven waiting rather than idle polling. State is capped at 4 MiB;
checkpoint compaction/epoch retirement with pending-edit recovery remains to be
integrated. The filesystem mutex coordinates store writers; arbitrary processes
that ignore it can race a write. Observed external changes fence sessions, but
an unobserved external edit-and-revert cannot be inferred from identical bytes.
