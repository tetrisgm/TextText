# Historical pending native upgrade

T17 bounded actual historical-source persistence fixture. No product files change.

## Existing evidence and missing boundary

`AccountStateAdoptionTests` already exercises current-generated unbound outboxes/shared checkpoints, every adoption callback phase, account mismatch, original-byte archives, separate-process restart and exact operation replay. `CheckpointAccountTests` covers unbound and foreign principal refusals. Those fixtures did not establish that pending state actually emitted by the reported installed Windows source is compatible.

`node sync/historical-pending-upgrade.mjs` now passes that boundary with exact historical Core commit `65417abddb0e7efba9206d04dd0adbbbaa15a2d9` extracted unchanged from git. Log: `/private/tmp/texttext-historical-pending-upgrade-20261018.log`. The log and retained scratch `current-source-hashes.json` identify the current copied Core inputs used by the consumer. Source checkpoint at execution was `16254f7e`; source hashes identify the actual tested inputs.

## What runs

1. A separate historical executable creates new disposable root/state. Its real `SyncEngine.SyncAsync` first uploads a baseline, then an actual failed controlled upload durably stages a pending operation. The original outbox has no `AccountId`. Its real `SharedEditingStore.OpenAsync/CheckpointAsync` persists a pending shared checkpoint with epoch3, seq7 and generation11. A valid Yjs update is generated for this fixture; this is native checkpoint API persistence, not old browser UI input. Full schema-v1 documents and opaque asset bytes are preserved.
2. A current executable refuses that unbound state through both account factory and sync constructor before any transport request; exact original sync/checkpoint bytes remain unchanged.
3. The fixture explicitly invokes production `AdoptAfterExplicitReview`, interrupts after applying the shared checkpoint, and leaves the durable adoption intent. Ordinary current reads remain fenced; independent raw fixture byte checks establish no pack/asset loss. No transport request occurs.
4. A fresh current process refuses a different principal's resume, then resumes the recorded principal's explicit adoption. Archived `before/sync.json` and original checkpoint bytes match exactly. Outbox operation ID and payload hash stay unchanged. The shared journal gains only the reviewed account binding; its update, pending array, epoch, seq and generation are preserved.
5. A controlled current transport receives the exact original operation ID/payload once. The real current shared store reopens the retained pending checkpoint. Another fresh process syncs without duplicating the acknowledged upload.

All fake accounts/origin identifiers are local fixture labels, not created accounts or credentials. Transport state is newly created local fixture data. No installed old binary, production server or user content is accessed. Old and current `TextText.Core` assemblies run in separate processes to avoid assembly identity substitution. The existing test-only Node host executes the real shared TypeScript policy for the current consumer.

## Source hashes

| Path | SHA-256 |
| --- | --- |
| `sync/historical-pending-upgrade.mjs` | `2b181055cf220c3352569d9ae905bc38f20d0558ca1a993618aae2a0800449f0` |
| `sync/fixtures/historical-pending-upgrade/Producer.cs` | `e64708fa01a6597a49a1fc81db96a3d7fe572203d4cae189e041bb16679e52e4` |
| `sync/fixtures/historical-pending-upgrade/Consumer.cs` | `cdea2a1b652d8fb7757d64602c8c7bc1872c7f24a4a5aaf83e158d133b686c4f` |

An initial fixture attempted ordinary store reads during interrupted adoption and correctly hit the production fence; the fixture was corrected to assert that refusal and separately inspect exact raw disposable bytes. No production guard was weakened.

## Limits and recovery

This executes Windows Core source on Darwin/.NET, not actual Windows or installed UI. It covers one real old-produced outbox/shared checkpoint and one durable interruption point with actual process reconstruction. Existing current-generated tests cover the wider callback interruption matrix; this does not convert them into a historical matrix. It does not acknowledge or replay the pending shared Yjs update to a real collaboration server, test old Mac pending state, establish sudden power-loss guarantees, or complete T17.

Recovery is forward through the explicit account review/adoption transaction. Preserve root, original metadata archives, pending bytes and transaction intent. Do not clear the intent, silently bind legacy state or roll back onto upgraded state; see [compatibility and rollback limits](2026-10-18-native-persisted-compatibility.md).
