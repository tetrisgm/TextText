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

## Native durable file checkpoints, build 1135

Commits `2d1834b3` and `23758ecb` persist shared edits into complete native
TextPacks through the existing sync actor. Replayable intents retain the prior
pack, projected pack and journal. Generation and file-hash checks reject stale
writers; an external file change retires shared editing while retaining recovery.
Pending shared projections are excluded from ordinary snapshot upload/download.
Clean checkpoints retain the native baseline for offline reopening.

The client serializes immutable checkpoints, coalesces bursts for 200 ms and
requires the local disk checkpoint before relay upload. After acknowledgement it
reads the authoritative state before marking the native checkpoint clean. Recovery
archives complete packs and refreshes the primary without uploading abandoned
pending content. Canonical archive selection now leaves an asset named `text.md`
untouched.

- 20 shared/sync tests: `/tmp/shared-foundation-final-tests.log`.
- 47 existing document-store tests: `/tmp/shared-foundation-document-store-tests.log`.
- 32 client/bridge/web tests: `/tmp/texttext-native-shared-js-tests.log`.
- Production web build: `/tmp/texttext-vault-native-checkpoint-build.log`.
- Repeated strict two-account browser acceptance:
  `/tmp/texttext-file-collaboration-checkpoint-browser.log`.
- Signed arm64 build and local install: `/tmp/texttext-build-1135.log` and
  `/tmp/texttext-install-1135.log`. Installed plist confirms 1135. The development
  install uses the script's documented sandbox-private health exception; native
  UI was checked from `/Applications/TextText.app` afterward.

Real native keyboard acceptance used a disposable `Untitled.textpack` with title
`Shared file verification 1135`. Baseline, online shared and offline shared
sentences appeared in the actual file. Offline checkpoint was pending with its
projected hash matching the file. After quitting and reopening, all three
sentences appeared in the editor. Reconnection automatically converged those
sentences to the server; epoch stayed 1, sequence became 4, and pending cleared.
The local server was restored using the same built output. This proves restart
retention and reconnection; fully offline cold-open timing, external-file-edit
recovery and two native concurrent writers remain separate checks.

## Remaining integration and limits

### Follow-up: separate browser journals and clean reopening

`74c6e69b` gives simultaneous browser tabs separate recovery records with
exclusive Web Locks. Reload resumes a retained record; unowned pending records
are discoverable and adopted individually. Records are removed only while owned.
Native generation selection remains unchanged. Web Locks are required; quota,
unreadable history and excessive recovery records fail visibly without deletion.

The extended actual-browser verifier passed two tabs in one context with cloned
sessionStorage: distinct ownership locks, independent offline edits, reload of
one disconnected tab, exact convergence across three editors, idle mutation
silence, canonical file equality, permission downgrade and zero runtime errors.
Log: `/tmp/texttext-file-collaboration-tab-journal-browser.log`.
Production build: `/tmp/texttext-vault-tab-journal-build.log`.

Installed 1135 direct-file testing preserved an agent's added sentence locally
and on the server but found a closed-session/clean-checkpoint reopen trap.
`3a2b29b5` makes repeated close idempotent without allowing expired writes; five
bridge tests pass (`/tmp/texttext-native-session-close-tests.log`). The editor
also reads the current file before reopening and permits a clean retired journal
to be discarded while preserving genuine unsent or unreadable history. Native
1136 acceptance is pending; do not count the UI fix as installed proof yet.

Build 1135 is installed. The current local server uses
`.texttext/vault-native-checkpoint-build`; no public deployment occurred.

Next: scoped item/folder grants and sharing UI, presence/comments, installed
concurrent-edit/direct-file recovery acceptance.

Extend installed acceptance across in-flight sync races, direct agent edits,
rename/delete, revocation and complete-pack preservation. Unit coverage alone
does not establish the complete native user journeys.

Every accepted batch currently materializes a complete pack. Before enabling
interactive traffic, measure/reduce write amplification for large assets and
use change-driven waiting rather than idle polling. State is capped at 4 MiB;
checkpoint compaction/epoch retirement with pending-edit recovery remains to be
integrated. The filesystem mutex coordinates store writers; arbitrary processes
that ignore it can race a write. Observed external changes fence sessions, but
an unobserved external edit-and-revert cannot be inferred from identical bytes.
