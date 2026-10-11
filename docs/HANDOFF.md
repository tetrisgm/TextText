# TextText handoff

## Current work (October 11)

Goal: reliable local TextPack and cloud collaboration across Mac app/browser/CLI and Windows app/browser/CLI. Full six-client acceptance remains open; see [acceptance matrix](verification/six-client-sync-acceptance.md).

Commit `e417ed28` makes native navigation/close wait for the durable local TextPack checkpoint while keeping cloud upload queued. Windows checkpoint acknowledgment no longer blocks on a cloud sync gate; its durable receipt replays on the next sync. Mac Core tests, 85 focused browser/client tests, TypeScript typecheck, local bundle build, Windows Core and smoke tests passed. This commit is local and **not pushed** pending physical acceptance.

Six-client seeds 127-133 converged all six text edits in about 12-14 seconds each, but the normal-close probe timed out. PC native events prove the tested window closed cleanly after a local checkpoint; the acceptance actor lost its asynchronous reply when the WPF dispatcher shut down. An uncommitted `Stress.cs` change keeps the actor alive and completes the probe on a thread-pool context. Isolated PC close probe 137 returned `closed:true, flushed:true`. The full six-client seed 138 stopped before editing because PC SSH reset during authentication. When SSH recovers, rerun a fresh six-client fixture with normal close and fresh-process reopen, then verify local TextPack and all six clients. Receipts: `/private/tmp/texttext-six-20261011/results/` and `C:/Users/Shokunin/dev/texttext-release-136bc176/stress-single-close-137/`. Do not ship until this passes.

Seed 125 on a repeatedly used attachment fixture entered Mac editor recovery after a local revision changed while pending edits existed; it did not maintain an active editor. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T21-59-14-222Z-125`. Reproduce on a fresh attachment fixture and fix if reproducible. Preserve its recovery journal.

Other acceptance gaps: whole TextPack and folder operations, delete/restore, two-account permissions, sustained typing/latency/resource measurements, offline/restart. Keep unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` untouched. Installed Mac app is build 1255; no website or public release was deployed.

## References

- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Previous receipts and context](archive/texttext-handoff-pre-e417ed28.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
