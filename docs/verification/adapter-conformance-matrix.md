# Durability adapter conformance

October 17, T06 inventory. This maps existing production-path tests and missing cases; code presence is not a fresh physical receipt. Current build results are in [completion progress](2026-10-17-completion-progress.md). Ordering is defined in [the durability contract](collaboration-durability-ordering.md).

Test entry points:

- Browser/client: `src/local-vault/collaboration-client.test.ts`, production `src/sync/engine/client.ts` with transactional IndexedDB test adapter.
- Mac: `mac/Tests/TextTextFileProviderKitTests/LocalVaultSharedEditingTests.swift` and `LocalVaultSyncTests.swift`; actual native checkpoint/store implementation.
- Windows: `windows/TextText.Core.Tests/Program.cs`, `ExternalCheckpointRaceTests.cs`, `EpochAdoptionTests.cs`; actual native store and sync implementation. Renderer boundary tests are in `windows/TextText.Windows.Tests` and `TextText.Smoke`.

| Case | Browser/client coverage | Mac coverage | Windows coverage | Remaining evidence |
| --- | --- | --- | --- | --- |
| Empty/uninitialized and restored state | Uninitialized typed result; offline canonical baseline; newer native journal selection | Pending/external reopen and clean checkpoint retention | Shared store open, retained journal replay | Same serialized conformance inputs across adapters |
| Commit before acknowledgement | IDB commit/abort/quota and synchronous request exception; browser failure accepted only after native checkpoint | Materialize intent then projection/checkpoint | Atomic write, replayable intent, typed native reply | Process termination at every boundary (T16) |
| Migration failure and unknown schema | Blocked open, unsupported row, fallback preserved, abort, recovery | Checkpoint schema/epoch validation | Future checkpoint and mutation receipt retained | Full supported-version matrix (T17) |
| Failed storage then recovery | Synchronous quota failure leaves committed row unchanged; pending edit survives retry | Interrupted intent/write recovery | Interrupted intent/write recovery | Mac real permission denial, retry and fresh-store reopen now pass; Windows replacement-lock recovery passes; ENOSPC remains open |
| Stale identity/generation | Distinct client lifecycle result; epoch replacement and permission loss | Generation regression, changed same-generation journal; live session required for epoch adoption | Stale generation refused, same-generation idempotence | Windows pre-cancelled checkpoint preserves prior state; late-result release race remains (T07/T09) |
| External bytes change during checkpoint | Reconciliation retry bound; overlapping replacement preserved; pending edits retained | External write collision retains lease; interrupted intent retires without overwriting | External checkpoint races; unexpected file change retained | Deterministic identical adapter fixture for every ordering |
| Native succeeds/browser fails | Explicit client test checks native generation before durable outcome | Native boundary exercised separately | Native boundary exercised separately | Physical storage-failure injection on disposable fixture |
| Browser succeeds/native rejects | Uninitialized and rejected-native-checkpoint result tests | Session and file hash checks reject | Renderer rejects incomplete/malformed receipts; store checks session/hash | Physical refusal reason tied to request/lifecycle metadata |
| Offline close/reopen | Native flush does not wait for remote ACK; browser navigation uses local journal | Pending primary fenced across restart | Busy cloud gate does not block local checkpoint; pending journal replay | Installed new-note offline close/reopen (T04) |
| Lease/cancellation/takeover | Separate-tab journals, reload waits for old lock, timed-out lock preserves pending work | Collaboration lease fences background writer | Collaboration lease fences background writer | Killed-owner takeover and stale callbacks across real windows/tabs |
| Unavailable/provider bytes | Unreadable journal retained; unknown envelope refused | Device state outside content; file-provider paths | Device state outside content; file lookup constraints | Real iCloud eviction/download evidence (T15) |
| Server result and lost ACK | Lost acknowledgement replays exact operation ID; later edits remain separate | Native durable queues and ACK replay | Native durable queues and ACK replay | Local database outage around receipt/audit and full restart matrix |

T06 remains open. The table identifies concrete missing tests rather than requiring the existing storage design to be replaced. Do not treat synchronous fake-storage failure as real power-loss evidence. Required assertions for new fixtures: returned outcome; captured and persisted generation; durable bytes; pending/recovery bytes; upload permission; state after a new process reads disk. Capture all six before marking a cell complete.
