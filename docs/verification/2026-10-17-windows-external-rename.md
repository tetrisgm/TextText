# Windows external rename and shared checkpoints

Date: 2026-10-17. Scope: portable production Windows Core on the Mac. Actual Windows candidate verification is pending; this is not installed-app acceptance or complete T13 coverage.

## Observed failure

A production `SharedEditingStore` session checkpointed pending writing, then an external `File.Move` relocated the pack. The next checkpoint read the obsolete session path and threw `FileNotFoundException`. Reproduction: `/private/tmp/texttext-t13-local-rename-before.log`, exit 134.

## Implemented behavior

- Resolve a missing projection only when the inventory proves one current item identity. Preserve the journal's baseline hash, epoch, generation and pending batch while recording its new path through the existing durable move intent.
- Reject ambiguous duplicate IDs, occupied old paths and incomplete inventories. Genuine unavailability still refuses without publishing a newer checkpoint or recreating the missing pack.
- Retain the reconciliation baseline when external content changes during relocation. The client must supply the current file hash before saving its merged writing.
- Persist path announcements separately from the blocking content outbox. Lost replies and process restart reuse the same operation ID; local checkpointing stays available.
- Confirm the remote path and lifecycle after the RPC, then recheck durable baseline/operation and current shared projection before updating the remote baseline. Another local move remains intact.
- Fence announcements from a deleted/restored lifecycle and retain their metadata without scheduling repeated local work. Stored announcements are limited to 1,000 and their shapes are validated.

`SyncEngine.State.SharedRenames` is an optional field containing existing `Operation` records. The prior state reader has `JsonExtensionData`, so an older executable preserves this unknown metadata when rewriting state. It does not execute these new announcements. Downgrade behavioral acceptance remains T17 work; no state version bump is claimed to provide it.

## Verification

Command:

```sh
dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj --configuration Release
```

The complete portable Core suite passed with 29 new rename assertions, including active pending/restart, sync-first and closed relocation, changed external bytes, duplicate/collision refusal, lost reply, clean editor closure followed by restart without reopening, local move/restore during a reply, and a deferred clean acknowledgement followed by a second move during that reply. Log: `/private/tmp/texttext-t13-local-rename-final.log`; exit 0; terminal marker `All native file and durable sync regression tests passed.`

The existing unavailable-projection test previously moved its held pack to another visible workspace `.textpack` path, which now correctly represents a rename. Its fixture now holds the pack outside the managed root in device state. Its no-new-generation, no-file-recreation, no-intent, no-remote-mutation and successful retry assertions remain intact and passed.

## Deferred acknowledgement regression

The additional combined scenario failed before its fix with `FileNotFoundException` at `ReconcileAcknowledgements`: `/private/tmp/texttext-t13-deferred-ack-before.log`, exit 134. A clean acknowledgement had been saved against the first relocated path while sync owned its gate; the second move retargeted the checkpoint but left that acknowledgement pending.

Acknowledgement replay now follows the current retained projection only when every other checkpoint field and journal value match. Content acknowledgements preserve the existing remote baseline path until a path operation is confirmed. The final full Core run above passed all 29 rename assertions, including replay, second path announcement and reopening the clean generation after restart.

## Remaining acceptance

Actual Windows execution remains pending. Case-only file rename policy and other T13 matrix gaps are separate work. This slice does not claim a filesystem-wide atomic compare-and-swap against an uncooperative external writer.
