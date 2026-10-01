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

## Editor and transport integration

The folder editor now opens the authoritative shared Y.Doc for acknowledged
files. Shared editing disables the competing whole-snapshot autosave. Browser
and native transports support cancellation; native credentials stay in Swift,
and bounded response accumulation runs off the main actor. Native configuration
requires an acknowledged unchanged local file without pending sync work.

The client durably journals pending updates before upload, retries a lost
acknowledgement using the same operation ID, suspends change waits when hidden,
and preserves retired/oversized/unreadable journals. Recovery download includes
unreadable original bytes; an undecodable journal cannot be cleared by reopening
or copying only its visible snapshot. Template changes use the fresh file's
content and revision so a newer collaborator edit is preserved.

Ordinary file reads and mutations now honor named-workspace grants. Writes,
moves and deletes recheck actor and permissions under the storage lock and
honor cancellation. Commits: `a9e4725d`, `827725bc` (native bridge).

- 59 client, bridge, web transport, route and filesystem checks pass:
  `/tmp/texttext-file-integration-current-tests.log`.
- Four native bridge/readiness tests pass:
  `/tmp/native-collaboration-stream-tests.log`.
- Production build including TypeScript passes:
  `/tmp/texttext-vault-collaboration-current-build.log`.
- The two-account browser verifier is `scripts/verify-file-collaboration.ts`.
  It uses existing local Ada/Grace accounts and removes its disposable workspace.
  Strict acceptance passed: concurrent visible edits, exact independent Undo
  and Redo, offline/online convergence without relocated text, no idle mutation
  uploads, actual pack matching visible text, denied downgraded writes, open
  editor noticing permission loss, and zero browser runtime errors.
  Log: `/tmp/texttext-file-collaboration-browser.log`. Light/dark screenshots:
  `/tmp/texttext-file-collaboration-{light,dark}.png`.
  This caught and fixed missing browser Undo/Redo and a deferred caret request
  that relocated the next typed space. It does not prove native gestures.

## Remaining integration and limits

Build 1134 remains installed. The current local server uses
`.texttext/vault-collaboration-current-build`; no public deployment occurred.
Native shared editing still needs installed acceptance and local TextPack
materialization of offline shared edits. The browser journal alone does not
satisfy the requirement that another agent can read current edits from files.
Do not enable the new native editor in an installed build until that path is
integrated and verified.

Next: local materialization/outbox integration, scoped item/folder grants and
sharing UI, presence/comments, installed concurrent-edit/recovery acceptance.

Native materialization must persist a replayable journal/pack intent, track the
exact projected file hash separately from the acknowledged remote revision,
exclude only that exact projection from ordinary sync uploads, and protect
pending shared edits from ordinary downloads. A different file hash is an
external edit and must fence the session while preserving both versions.
Acknowledging one relay batch must not clear later local updates. Verify crash
replay, in-flight sync races, direct agent edits, rename/delete, revocation and
complete-pack preservation before enabling this path in the installed app.

Every accepted batch currently materializes a complete pack. Before enabling
interactive traffic, measure/reduce write amplification for large assets and
use change-driven waiting rather than idle polling. State is capped at 4 MiB;
checkpoint compaction/epoch retirement with pending-edit recovery remains to be
integrated. The filesystem mutex coordinates store writers; arbitrary processes
that ignore it can race a write. Observed external changes fence sessions, but
an unobserved external edit-and-revert cannot be inferred from identical bytes.
