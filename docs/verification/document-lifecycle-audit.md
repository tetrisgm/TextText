# Document lifecycle audit

Status: active. October 11, 2026. This records confirmed behavior and the remaining diagnostic gap for [the execution plan](../plans/shared-app-durability-execution.md).

## Owners and sequence

| Step | Current owner | Durable boundary and risk |
| --- | --- | --- |
| UI edit | `CollaborativeVaultEditor` and `FileCollaborationClient` | Yjs changes call `persist`; current state and pending operations are serialized to the browser/WebView journal before checkpoint scheduling. A synchronous storage failure throws. |
| Native local checkpoint | `FileCollaborationClient` → `vaultRequest(collaborationCheckpoint)` → Mac `LocalVaultCollaboration` / Windows `WindowsBridge` and `SharedEditingStore` | The native bridge materializes TextPack and durable journal. `checkpointSavedGeneration` advances only after the checkpoint promise resolves. A rejected checkpoint latches `checkpointError` and makes subsequent `flushLocal` false. |
| Browser local state | `FileCollaborationClient` storage adapter | `flushLocal` checks unreadable journal when no native checkpoint exists. Current storage guarantees and eviction behavior still require P1 audit. |
| Server collaboration | `FileCollaborationClient` → hosted vault routes and `src/sync/engine/store.ts` | CRDT updates, epoch, sequence, idempotency and permission checks. Network completion is separate from native local checkpoint. |
| Native background file sync | Mac `LocalVaultSync.swift` / Windows `SyncEngine.cs` | Separate platform policies manage file baselines and upload/download queues. Collaboration fences protect files under active editing. Policy parity remains to be audited. |
| External file change | Native file watcher → bridge event → `CollaborativeVaultEditor` → `FileCollaborationClient.notifyExternalFileChange` | Existing reconciliation may retry `local_changed`; a failing checkpoint can freeze the editor and show recovery. Stable-write and duplicate-arrival behavior needs P4 coverage. |
| Native file activation | Windows `MainWindow.Activation.cs` queue → native flush guard → renderer `texttextOpenFile` → React `operate` | Two activation requests for one path could be queued. The second could flush or navigate an already-open editor while collaboration was active. This is now deduplicated while queued/in progress and covered by native smoke. |
| Native close | Windows `MainWindow.Closing` → `RequestClose` → `RendererFlushGuard` → renderer `texttextFlushForSignOut` → `flushNativeForNavigation` / `flushLocal` | Closing needs an acknowledged native local checkpoint. Failed flush keeps the window open. Close during activation is now retained and retried after successful activation flush; a controlled native smoke test covers this ordering. |
| Browser navigation | `flushForNavigation` | Uses server `flush` for pending changes. Native navigation uses local `flushLocal`; this inconsistency requires P1/P2 resolution. |

The renderer installs `texttextFlushForSignOut` in a `VaultApp` effect and changes its target via `registerFlush`. The editor's React lifetime currently controls which flush function the native shell calls. P2 will audit remount and stale callback ordering before extracting ownership.

## Windows close incident

The stress actor previously called `ActivateFiles` in its constructor and again after the WebView was ready. The production queue accepted duplicate paths. Runs 171–174 converged all six edits but showed the native `Keep editing` dialog. Run 174's guard already reported `rejected` before the close request; the test's close-hook wrapper recorded no invocation during the attempted close. This is consistent with a queued activation rejecting its flush, then `RequestClose` returning while the activation transition is active. It does not prove every user-facing dialog has this cause.

Run 175 passed but still had an earlier `saved` activation flush. The actor now makes one activation request and production Windows deduplicates a path while it is queued or being opened. A real WebView smoke regression requested the same file again during the first flush and proved the queue retained one request. The complete Windows build passed native regressions, 400 shared-client tests, TypeScript, UI bundle and desktop smoke. Run 176 passed six concurrent edits and normal Windows close on a new fixture; its pre-close guard outcome was `saved`, hook was present, journal had no pending batch, and no dialog appeared. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-12T03-06-06-569Z-176`. These results support the duplicate-activation hypothesis but do not close the intermittent defect without a failing-order reproduction and an independently installed candidate check.

A separate native WebView regression now confirms that a close requested during an unresolved file activation waits and completes after the activation flush succeeds. Previously that close request was silently dropped. This ordering fix passed native desktop smoke; a new sealed build and installed-app verification remain pending.

The native guard still returns a Boolean. Diagnostics currently report `saved`, `rejected`, `busy`, `timeout`, or dispatch failure; renderer diagnostics distinguish a missing hook, rejected hook, and exception. No document text, token, or journal body is logged. A future typed result should identify the requested and persisted lifecycle/generation without exposing content.

## Remaining P0 work

1. The isolated native test now forces close during unresolved activation; the window waits and closes after the flush succeeds. Continue instrumenting activation/close origin and checkpoint identity in a physical failure.
2. Verify a second activation after the first completed and after the user navigated away. The queue's in-progress dedupe does not cover all repeated Finder opens.
3. Identify the exact checkpoint refusal on a genuine failure, including native storage result. A clean local journal in the renderer does not by itself prove the native checkpoint advanced.
4. Compare installed Mac/Windows binaries and browser bundle identities with the acceptance actors. Test the candidate in an installed Windows app before a normal-use claim.
5. Finish the full ownership map for multiple windows/tabs, Mac close, browser storage, server ACK and external-file materialization. Distinguish confirmed behavior from hypotheses in follow-up revisions.

Do not count the one-round pass as a fix for general sync durability. The remaining acceptance categories are tracked in the plan and [six-client matrix](six-client-sync-acceptance.md).
