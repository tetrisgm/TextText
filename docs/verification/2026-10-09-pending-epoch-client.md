# Automatic pending-edit epoch recovery: client caller

Continues `2026-10-08-epoch-recovery.md`. The shared client in
`src/sync/engine/client.ts` now invokes the authorized server recovery
operation instead of retiring a pending journal whenever its epoch no longer
matches the server. This covers restart, a live poll, a lost-ACK upload whose
follow-up read sees a new epoch, and an `epoch_changed` rejection.

## Durable intent

Before the first send the client persists `journal.recovery`
(`operationId`, old `epoch`, complete Yjs `update`) through the normal journal
and native checkpoint path. Retries and restarts reuse the exact bytes and
identifier, so the server returns its original receipt instead of applying the
edits twice. The intent is validated like every other journal field; a corrupt
intent keeps the journal unreadable and preserved. Nothing is dropped until a
fresh authoritative read proves a newer epoch and current edit access.

Definitive answers (`recovery_unavailable`, `recovery_conflict`,
`recovery_lifecycle`, 401/403/404, a `conflict` receipt, revoked edit access
before sending) retire the journal with every pending update intact and send
nothing further. Transient failures re-enter through the poll with the existing
upload backoff. Flush waits for an in-flight recovery.

## Adoption

Server recovery produces new Yjs identities, so the old document cannot stay
bound. The client builds a fresh Y.Doc from the authoritative read, re-expresses
edits typed during recovery through the shared three-way reconcile (remote
first, as the server does), queues them as new-epoch pending updates, swaps
`client.doc`, persists the replacement journal with the intent marked
`adopted`, and only after the native checkpoint of that journal succeeds clears
the intent and destroys the old document. A failed native checkpoint leaves the
adopted intent and the old state in the retained journal and reports an error.

`onDocumentReplaced(next, previous)` is the minimal live-adoption contract. It
runs synchronously after the swap. Without it the client freezes after the
durable recovery and reports `stale-session` (native) or `stale-file` (web) with
a clean journal so the existing reopen path reloads the note.

## Verification

`src/local-vault/epoch-recovery-client.test.ts` drives the real file-backed
store in a temp directory (no database): restart with pending edits, lost ACK
plus restart with the same operation id, typing during recovery, a live poll
meeting a replaced epoch with an unacknowledged batch, revocation, a failed
native checkpoint, deleted retained history, a deletion barrier, a corrupt
intent, and the no-callback fallback. Nine of the ten fail on the previous
client. The existing fixture in `collaboration-client.test.ts` retains no epoch
history and now refuses recovery with `recovery_unavailable`; three assertions
there expect one refused attempt instead of none. The two client suites pass
80 tests together, and web, Windows, bridge, store collaboration and route
suites pass 100 tests; `tsc --noEmit` is clean.

## Still needed

- `CollaborativeVaultEditor.tsx` must pass `onDocumentReplaced` and rebind
  `UnifiedDocumentEditor` and `Awareness` to the new `client.doc`, restoring the
  caret by text offset. Until then the client uses the freeze-and-reopen
  fallback, which loses the caret and undo history but no text.
- Edits typed after the fallback freeze still retire the journal, as with the
  existing stale-session path.
- Journals that an older client already retired remain manual; only live
  pending journals recover automatically.
- No Oracle deployment or Mac build was performed in this session.
