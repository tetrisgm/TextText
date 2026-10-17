# Native workspace writer ownership

T09 background cooperation, October 17. This extends [document leases](2026-10-17-native-document-leases.md); installed binaries are unchanged.

## Reproduction and decision

Both new background regressions failed: another native actor could run a mirror pass while an editor owned the workspace's document. Logs: `/private/tmp/texttext-t09-workspace-before-{mac,windows}.log`. Per-document exclusion alone did not protect the shared workspace sync cursor.

One native actor now holds workspace writer ownership throughout a sync pass or active editing. Its own editor sessions and mirror reuse that ownership, so existing asset/path updates continue. Another actor/process must wait. Windows extends its existing `sync.lock`; Mac uses a device-private `workspace-writer.lock`. No timestamp expiry or lock-file deletion is involved. The lock is an OS primitive, not a new background service or a replacement sync policy.

Mac reloads persisted state whenever an idle actor newly acquires ownership. This prevents an old in-memory cursor from overwriting baselines written by another actor. Readiness inspection no longer replays checkpoint intents; recovery belongs to the writer. Explicit rebinding also takes workspace ownership.

## Verified behavior

The full `bash scripts/test-sync.sh --native-only` gate passed: 42 Mac app, 121 Kit (four helper/manual skips), 40 agent tests and the full portable Windows Core suite. Log `/private/tmp/texttext-t09-workspace-native-gate-final.log`.

Added/extended cases prove:

- Another actor's background pass is refused while editing remains active; the owning actor's pass still works.
- Ownership survives a held network await and prevents another actor opening an editor mid-pass.
- Normal release permits the next writer; actual killed-child takeover also fences a foreign background mirror and releases both workspace/document ownership on death.
- An idle Mac actor with a one-item sync budget preserves a newer second-item baseline outside that budget.
- Pending document projection and acknowledged baseline remain distinct.

The first full gate exposed two incorrect test assumptions. A pending projection does not advance the acknowledged baseline. An old simulated restart also left the previous editor actor alive; it now deallocates that actor and checks the weak reference before starting the replacement. Exact lost-ack operation and payload assertions remain. The actual process-kill cases are separate.

## Physical PC verification dependency

The preceding document-only lease version passed the full core suite on the PC. Transfer of this newer workspace-writer version failed before copying the first file. Direct SSH completed key exchange and then reset at `SSH2_MSG_SERVICE_ACCEPT`, before key authentication. The existing tunnel attempt timed out. The qualified local username, fleet identity and route are unchanged; the PC is reachable. Private client diagnostic: `/private/tmp/texttext-t09-ssh-diagnostic.log`.

Current Windows event logs were requested while local work continued. Do not label this recurrence as an established account lockout without those logs, or count the older PC receipt as verification of this newer source. No SSH/service/policy change was made. Next physical command after access returns: copy the three changed Windows core/test files and run the full Release core suite, with receipt `C:\Users\Shokunin\dev\texttext-t09-workspace-writer-core.log`.
