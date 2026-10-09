# Live epoch adoption in the editor

When automatic pending-edit recovery adopts a replacement epoch, the shared
client swaps its Y.Doc. The mounted editor now follows that swap in place:
no remount, the body element keeps focus, the caret is carried into the
merged text by character diff, awareness and presence are recreated for the
new document identity, and undo continues across the adoption.

## What changed

- `UnifiedDocumentEditor` takes `registerLocalRebind`. The owner receives a
  handle `(next, awareness) => Promise<void>` that rebinds the document and
  awareness state, recreates the undo manager, and resolves once the editor
  has committed the new document. The promise is also resolved on unmount.
- `CollaborativeVaultEditor` keeps the bound document and awareness in state,
  awaits the rebind from `onDocumentReplaced`, and recreates
  `FilePresenceClient` for the new awareness. `generation` is untouched, so
  ordinary file changes and adoption never remount the editor. It passes
  `supportsEpochRecovery` from the native `collaborationOpen`
  `capabilities` (`epoch-adoption`); web sessions default to true.
- `src/lib/collab/epoch-adoption.ts`: caret mapping, captured undo history
  and its replay. Yjs stack items are never transplanted: the old manager is
  walked on the retiring document and each step recorded as a text state.
  Body-only steps replay as character edits mapped onto the live body, so an
  undo removes exactly the pending text next to the merged remote text and a
  redo reinserts it behind it. A removal whose text no longer exists ends the
  captured history rather than guessing. Non-body steps use the shared
  three-way reconcile and end on conflict. A fresh edit discards every redo
  path, matching Yjs.
- Caret restore waits for the surface to render the merged text; placing it
  earlier clamped to the old length (the only flake seen, fixed).

## Verification (2026-10-09, Mac)

- `npm run test:epoch-adoption:browser`: real `FileCollaborationClient` and
  the real file-backed relay store in a temp directory, native bridge
  emulated with the Mac/Windows checkpoint guard and `epoch-adoption`.
  Pending edit, outside replacement, late edit during the held recovery push,
  dropped recovery push replayed with the same operation ID, rebind without
  remount, focus and caret 11 -> 18 past the merged remote text, presence
  rejoined with the new awareness client ID, undo live step then captured
  step keeping the remote text, redo both, new edit ends redo, server and
  native journal converge in the adopted epoch. Second replacement with a
  failing native adoption checkpoint fails closed: the unadopted intent the
  server already committed stays in the native journal for the reopen path.
  Passed 12 consecutive runs after the caret fix.
- `npm run test:note-template:browser`, `npm run test:long-note-reader:browser`:
  passed (editor continuity, undo through rename, recovery dialogs).
- `vitest run src/local-vault src/lib/collab src/sync/engine src/components`:
  156 files passed, 1 skipped.
- `tsc --noEmit`: clean.

## Not covered here

- Reopen after the fail-closed adoption checkpoint (the native
  `nativeAwaitsAdoption` restart path) is covered by the client and native
  tests, not by this browser run.
- Installed app verification on the physical Mac and Windows machines is the
  parent's; no build, install or deploy was done for this change.
