# Collaboration durability ordering

Status: implemented ordering and current evidence; full crash-boundary matrix remains in Packet F. October 11, 2026.

## Acknowledgement meanings

The client distinguishes an applied Yjs edit, a locally durable collaboration journal, a materialized TextPack projection, and a server-committed operation. `flushLocalResult()` reports the local journal/checkpoint outcome with workspace, item, lifecycle and generation. A native `durable` result requires the native checkpoint through that generation. Server acknowledgement is separate and is accepted only after the server returns its committed result. No caller may infer durability from an empty pending list alone.

## Browser journal

1. A complete validated journal is serialized with its incremented generation. The localStorage compatibility copy is written best-effort and never grants a durable result.
2. The complete row is written in one IndexedDB read-write transaction. Strict transaction durability is requested where supported. The client waits for transaction completion and validates the stored generation before returning `durable` or allowing a push that requires local persistence.
3. If the process exits before transaction completion, the IDB transaction either commits its row or aborts; the client has not acknowledged that generation. On restart, both valid IDB and compatibility copies are compared by generation. Divergent copies at the same generation are preserved and reported for recovery.
4. Migration validates both old copies, writes the chosen generation transactionally, reads it back, and only then uses it. An aborted or blocked open keeps the original compatibility bytes. Unsupported IDB schema rows are left in place and fail closed.
5. Explicit site-data deletion or browser eviction may remove browser-owned journals. Persistent-storage denial does not invalidate an already committed transaction, but it does not remove that browser limitation.

The blocked-write, abort/migration, quota, reopen, push-gating, and real Chromium epoch-adoption tests cover these orderings. They simulate process/storage failure; they are not a physical power-loss test.

## Native TextPack and checkpoint

Both native stores use a replayable intent so the materialized TextPack and shared checkpoint can recover across separate atomic-file writes:

1. Validate the session token, file hash, journal generation and complete projection.
2. Persist an intent containing the expected pre-write hash, target TextPack payload and target checkpoint. Windows uses `TextPackStore.AtomicWrite` with a temporary file, `WriteThrough`, `Flush(true)` and rename. Mac writes the intent atomically and synchronizes the resulting file.
3. Materialize the TextPack through the platform document store using compare-and-swap against the expected hash. On Windows the atomic writer flushes the temporary file before rename. On Mac the document store writes through its coordinated package path.
4. Persist the checkpoint containing the journal generation, projection hash and pending state. Remove the intent only after the checkpoint write succeeds. On restart, an outstanding intent is replayed if the before-hash still matches; an unrelated external change retires the checkpoint and preserves the pending payload for recovery.
5. Only after the native checkpoint call returns may the client report native local durability. The renderer's typed result then reaches the native close guard; close succeeds only for `ok: true` and `outcome: durable`.

These files are individually atomic and the intent is replayable; the TextPack and checkpoint are not one filesystem transaction. Exact interruption at every intent/materialization/checkpoint boundary, directory-entry durability under sudden power loss, and provider-specific semantics remain in Packet F/P4. Existing native restart tests cover interrupted intent replay and retained-journal recovery.

## Server commit and replay

For file collaboration, the server stores the new TextPack, collaboration checkpoint and an operation receipt through its replayable pending intent before returning. The receipt includes a request hash; reuse of the same operation ID with different bytes is rejected. Audit receipt delivery is awaited before success is returned. If the request fails after the filesystem commit but before the caller receives success, replay of the same operation ID returns the committed receipt and does not advance the document again. Tests cover lost acknowledgement in the client, durable receipt replay after a failing audit callback, and operation-ID mismatch rejection.

The file receipt and action-audit database write are separate durable systems coordinated by replay. Database outage and restart failpoints still need the local-database regression campaign; production Neon is not used for those tests.

## Remaining verification

- Add adapter conformance fixtures for read, replacement, cancellation, stale lease, unavailable file, quota/disk failure and restart replay.
- Inventory every crash/failpoint in the existing server and native tests, then add only missing boundaries.
- Run crash/restart and sustained multi-client acceptance on the exact installed candidates. Preserve site-data deletion, filesystem provider eviction and physical power-loss limits in the final claim.

See [Packet B progress](2026-10-11-packet-a-b-progress.md), [the lifecycle audit](document-lifecycle-audit.md), and [the execution plan](../plans/finish-texttext.md).
