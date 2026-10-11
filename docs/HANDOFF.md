# TextText handoff

## Current work (October 11)

Goal: reliable local TextPack and cloud collaboration across Mac app/browser/CLI and Windows app/browser/CLI. Full six-client acceptance remains open; see [acceptance matrix](verification/six-client-sync-acceptance.md).

Commit `e417ed28` makes native navigation/close wait for the durable local TextPack checkpoint while keeping cloud upload queued. Windows checkpoint acknowledgment no longer blocks on a cloud sync gate; its durable receipt replays on the next sync. Mac Core tests, 85 focused browser/client tests, TypeScript typecheck, local bundle build, Windows Core and smoke tests passed. This commit is local and **not pushed** pending physical acceptance.

Six-client seeds 127-133 converged all six text edits in about 12-14 seconds each, but the normal-close probe timed out. PC native events proved the tested window closed cleanly after a local checkpoint. Commit `16665c74` fixes two discovered close defects: the test actor now writes its asynchronous reply and result after UI shutdown, and the product ignores a late WebView2 reply after the control has been disposed. An isolated offline PC edit closed without the dialog with one durable pending journal update (`stress-offline-close-141`); the earlier actor result was false because of the now-fixed late-reply exception. The Windows smoke suite passed the new post-disposal reply regression at `windows/build/smoke-receipts-1da0a92551af4ee98300150c55660655`. Rebuild the private LiveAcceptance actor with `16665c74`, rerun offline close plus fresh-process reopen, then a fresh six-client close and reopen. The full seed 138 stopped before editing because PC SSH reset during authentication. Receipts: `/private/tmp/texttext-six-20261011/results/` and `C:/Users/Shokunin/dev/texttext-release-136bc176/stress-offline-close-141/`. Do not ship until this passes.

Seed 125 on a repeatedly used attachment fixture entered Mac editor recovery after a local revision changed while pending edits existed; it did not maintain an active editor. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T21-59-14-222Z-125`. Reproduce on a fresh attachment fixture and fix if reproducible. Preserve its recovery journal.
Commit `73bcf43c` adds a passing Mac native regression for an incoming asset update with pending text followed by another local checkpoint. This proves the ordinary asset-update path but does not explain or pass the simultaneous same-entry asset replacement race from seed 125.
The seed 125 Mac actor saw all six text markers, then its editor changed to recovery during the 30-second stability observation. The old failure receipt captured only the end of the page and omitted the recovery banner. The stress actor now captures alerts and the page start so a fresh reproduction can name the actual error. PC SSH currently resets after accepting `ssh-userauth`, before key authentication; Windows rebuild, install, and physical acceptance await access.

Other acceptance gaps: whole TextPack and folder operations, delete/restore, two-account permissions, sustained typing/latency/resource measurements, offline/restart. Keep unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` untouched. Installed Mac app is build 1255; no website or public release was deployed.

## References

- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Previous receipts and context](archive/texttext-handoff-pre-e417ed28.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
