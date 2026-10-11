# Live binary entries in an open TextPack

## Reproduced failure

The six-client seed 89 receipt at
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T16-11-05-790Z-89`
shows all six clients converging on document text while a PC CLI replacement
of `assets/data.txt` remains only in the PC archive. The Mac archive retains
the old bytes. This is a product failure, not a flaky assertion. Both native
sync actors exclude open shared-editing items from ordinary whole-pack sync;
the Yjs document stream has no transport for binary entry bytes. Server
`projectVaultFileEdit` already preserves an asset replacement in the same
collaboration epoch and subsequent Yjs edits (regression in
`src/lib/vault/collaboration.test.ts`). The missing transport and native
materialization must be fixed together.

## Required protocol

Server foundation: `src/sync/engine/store.ts` and the item `binary` route now
provide bounded entry GET/PATCH and atomic hash/lifecycle compare-and-swap with
durable receipts. The web, Windows, and Mac relays and both native sync transports
expose these scoped calls.
Windows and Mac outbound asset staging are implemented and unit tested,
including durable replay after a lost response. Both native editors now apply
remote asset entries through recoverable file intents while retaining pending
text. Browser editors refresh asset URLs without replacing the mounted Yjs
document and retry transient read failures. The full physical matrix has not
passed, so these paths remain unverified together on installed clients.

1. Treat each TextPack binary entry as an atomic value with its own SHA-256.
   Keep the package identity, lifecycle, path, and Yjs epoch as fences. An
   asset operation carries the entry path, expected prior hash (or absence),
   new bytes (or deletion), an operation ID, and the item's lifecycle. Bound
   expanded size and entry count exactly as the TextPack reader does.
2. After observing a direct file edit, each native actor compares the changed
   entry with its durable last-observed entry state. Persist the intended
   operation and bytes before sending. Do not infer deletion from an evicted
   or temporarily absent iCloud/OneDrive file. A content edit to `text.md` or
   `document.json` continues through the existing Yjs reconciliation path.
3. Under the server's workspace lock, authorize the current item and compare
   the entry's prior hash. Patch only that entry in the current archive,
   preserving current document text, other assets, template sidecars, and
   opaque metadata. Persist the archive, collaboration revision, audit, and
   idempotent receipt in one replayable intent. Advance the same Yjs epoch's
   sequence so every open client learns that the archive revision changed.
   A same-entry competing replacement returns a conflict; never silently
   choose a winner or overwrite the source file.
4. On a changed collaboration revision, an open native editor fetches the
   changed entries. Under its shared-editing file fence, preserve the prior
   local archive, verify the expected entry hash, patch only those entries,
   and atomically advance the local checkpoint's projected hash. Keep pending
   Yjs updates, caret, editor binding, and unrelated local entries intact.
   The web editor refreshes object URLs for changed assets. If a local asset
   changed concurrently, retain both byte versions for explicit resolution.
5. Receipt replay must be safe after a lost response; restart must replay a
   durable outbound patch or complete an interrupted inbound patch. Permission
   loss, item move, deletion/restore, and lifecycle changes must fence stale
   operations without discarding local bytes. No idle polling or repeated
   whole-pack upload is needed: existing collaboration change notification
   can wake receivers.

## Acceptance

- Unit tests: entry CAS, same-entry conflict, opaque-entry preservation,
  document/Yjs interleaving, receipt replay, crash before/after each durable
  boundary, lifecycle and permission fencing, and bounded malformed archives.
- Native tests on both platforms: direct entry change while editor remains
  mounted, remote entry patch with unsent local text, concurrent same-entry
  conflict, iCloud/OneDrive temporary absence, and restart replay.
- Physical test: a **new** six-client fixture with PC and Mac CLI binary edits
  in separate rounds; both native apps and browsers remain open. Assert exact
  entry hashes and document text on both machines, then close and reopen all
  six clients and repeat the assertions. Keep seed 89 recorded as a failure.
