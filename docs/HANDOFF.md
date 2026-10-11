# TextText handoff

## Current work (October 11)

Goal: reliable local TextPack and cloud collaboration across Mac app/browser/CLI and Windows app/browser/CLI. Full six-client acceptance remains open; see [acceptance matrix](verification/six-client-sync-acceptance.md).

Commit `e417ed28` makes native navigation/close wait for the durable local TextPack checkpoint while keeping cloud upload queued. Windows checkpoint acknowledgment no longer blocks on a cloud sync gate; its durable receipt replays on the next sync. The Windows close probe now uses the UI-thread dialog observer proven by smoke tests. Mac Core tests, 85 focused browser/client tests, TypeScript typecheck, local bundle build, Windows Core and smoke tests passed. This commit is local and **not pushed** because physical close acceptance failed before the UI change was built on Windows.

Fresh six-client seed 127 converged all six text edits in 12.2 seconds. The Windows normal-close probe then received no native reply within 120 seconds. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T22-08-14-715Z-127`. PC SSH currently resets before authentication, so its native close events have not yet been retrieved. Ask the owner to restart the PC `sshd` service, then read `C:/Users/Shokunin/dev/texttext-release-136bc176/stress-session-127-closeprobe-fresh2/generation-001/events.jsonl`, copy the new source/build to the private PC actor, and rerun fresh close plus six-client reopen. Do not ship until this passes.

Seed 125 on a repeatedly used attachment fixture entered Mac editor recovery after a local revision changed while pending edits existed; it did not maintain an active editor. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T21-59-14-222Z-125`. Reproduce on a fresh attachment fixture and fix if reproducible. Preserve its recovery journal.

Other acceptance gaps: whole TextPack and folder operations, delete/restore, two-account permissions, sustained typing/latency/resource measurements, offline/restart. Keep unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` untouched. Installed Mac app is build 1255; no website or public release was deployed.

## References

- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Previous receipts and context](archive/texttext-handoff-pre-e417ed28.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
