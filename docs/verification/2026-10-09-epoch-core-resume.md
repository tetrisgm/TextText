# Epoch recovery core: crash window, document lifetime, late conflicts, revival

Continues `2026-10-09-pending-epoch-client.md` and answers
`/tmp/texttext-epoch-core-review.md`. Only `src/sync/engine/client.ts` and
`src/local-vault/epoch-recovery-client.test.ts` changed.

## Interface

- `supportsEpochRecovery?: boolean`. Default `true` without a native
  `checkpoint` (web), `false` with one. The editor sets it `true` only when
  `collaborationOpen.capabilities` includes `epoch-adoption`. When false a
  replaced epoch retires pending edits for manual recovery as before.
- `onDocumentReplaced(next, previous)` may return a promise. It is awaited
  after the swap and before the previous document is destroyed and before the
  adoption is proven natively. Edits typed on `client.doc` during the await
  are journaled as new-epoch pending updates. A rejected callback keeps the
  durable adoption and reports `stale-session`/`stale-file` to reopen.

## Fixes

- Crash after `adoptEpoch` persisted the replacement but before its native
  checkpoint: the restart no longer reports a changed local file. The stale
  revision is accepted only when the native journal still holds the exact
  unadopted intent (operation id, old epoch, update bytes, path, lower
  generation), mirroring the native authorization check. A journal with an
  adopted intent is never treated as a clean baseline; the intent is dropped
  only after `flushLocal` proves the native store adopted the epoch, on
  restart, in `recoverEpoch` before a newer intent, and when the adopted epoch
  was replaced again (then reopen instead of merging two Yjs identities).
- Previous Y.Doc destroyed on every exit after the swap: checkpoint failure,
  destroy during the callback, callback failure, onChange failure.
- Late-edit conflict or size limit after the server committed the intent:
  pending and batch are cleared (already in the replacement epoch),
  `unqueuedDirty` keeps the document with the late edits for manual recovery,
  the intent stays unadopted so the native store keeps fencing the old epoch,
  and a restart does not resend.
- Revival of journals retired by the known older fatal message "This note
  needs to be reopened. Your edits are saved for recovery." when the journal
  is valid, has pending/batch or an unproven adoption, has no unqueued edits
  and the native session is not retired. The fresh read decides access, the
  server validates history and lifecycle, and refusal restores the original
  retirement. Unknown retirements, native `initialRetirement` and
  `unqueuedDirty` journals stay manual.

## Verification

`epoch-recovery-client.test.ts` adds a guarded native checkpoint store that
mirrors `LocalVaultSharedEditing.swift` adoption, generation and retirement
rules, driven against the real file-backed vault store in a temp directory.
14 new tests: late-edit and clean crash windows, failed post-restart
checkpoint, truly changed file with and without a forged adopted intent, no
capability, awaited rebind with meanwhile edits, destroy during rebind, failed
rebind, checkpoint failure lifetime, post-commit late conflict, same-epoch
revival, replaced-epoch revival, revoked revival, and non-revivable cases.
Both client suites pass 94 tests; `tsc --noEmit` is clean apart from another
worker's in-progress `UnifiedDocumentEditor.tsx`.

## Not done

- No build, install, deploy or journal change. The Mac 1239 fixture
  `adb80788-ce35-4a18-8162-e6c7482cc736` was not touched; whether its journal
  meets the revival conditions (browser journal valid, native checkpoint not
  retired) is unknown until the parent reads it. A native `retiredReason`
  keeps it manual and needs separate work.
- The Mac "Download recovery" click producing no file is a separate product
  bug, not addressed.
- Live integration (editor capability gate, rebind, physical six-client run)
  pending.
