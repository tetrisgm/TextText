# Retained folder command review and cancellation

T13 server recovery slice, October 18. This is source verification; native review integration and installed acceptance remain separate.

A failed folder RPC, including HTTP 409, cannot prove that publication did not happen. Clients retain and retry the exact original operation. The new owner-only `POST /api/vault/:workspace/folder-case-moves/recovery` supplies an authoritative recovery path:

- Inspect: `{action:"inspect",command:<exact original command>}`.
- Cancel: `{action:"cancel",command:<exact original command>,inspection:<fresh SHA256>,consent:true}`.
- Completed: `{state:"completed",requestHash,result:<original moved receipt>}`. This wins over cancellation when publication already completed.
- Review: `{state:"review",operationId,requestHash,source,destination,inspection,manifestRevision,folders,items}`. The complete current remote catalog participates in consent.
- Cancelled: `{state:"cancelled",operationId,requestHash,source,destination,inspection,manifestRevision}`.

The engine workspace lock serializes inspection/cancellation with original requests and retries. It first recovers retained intents. A missing receipt never suffices: SQL owner/operation checks also refuse reserved or applied metadata. Aborted metadata must match the exact actor/request. Unavailable recovery refuses rather than guessing. A changed manifest invalidates consent.

Cancellation writes a separate durable request-bound tombstone before its idempotent audit. Every future original request checks the tombstone before recovery/publication. An audit outage leaves the tombstone retained; a later recovery call replays the audit. Cancellation does not rename, overwrite or delete workspace files, pending drafts, or old receipts. Native clients must retain the authoritative cancellation receipt before clearing their local command, revalidate account/root and local inspection across awaits, and explain any remaining original-spelling restoration. HTTP status or a local flag never authorizes clearing a command.

## Verification

- 52 unit/API/engine checks in 7 selected files pass, including original complete-subtree/replay fixtures; `/private/tmp/texttext-folder-case-recovery-final-unit-20261018.log`.
- Local PostgreSQL recovery test passes with real owner checks, one audit over replay, unchanged filesystem manifest, late-original refusal, and reserved/applied/foreign-request metadata refusal; `/private/tmp/texttext-folder-case-recovery-db-20261018.log`.
- TypeScript passes; `/private/tmp/texttext-folder-case-recovery-tsc-20261018.log`.
- Explicit fixtures cover stale consent, revoked owner, committed response loss returning the original receipt, audit outage after cancellation publication, and staged metadata recovery remaining unavailable. Failed recovery never invents cancellation.

No production data, user files, deployment or installed app was changed. Private cancellation records must be preserved; deleting them could permit a late request to publish. Recovery remains forward-only for supported state; this receipt does not assert arbitrary external filesystem race atomicity or power-loss durability.
