# TextText handoff

## Current work (October 11)

Goal: reliable local TextPack and cloud collaboration across Mac app/browser/CLI and Windows app/browser/CLI. Full six-client acceptance remains open; see [acceptance matrix](verification/six-client-sync-acceptance.md).

Commit `e417ed28` makes native navigation/close wait for the durable local TextPack checkpoint while keeping cloud upload queued. Windows checkpoint acknowledgment no longer blocks on a cloud sync gate; its durable receipt replays on the next sync. Mac Core tests, 85 focused browser/client tests, TypeScript typecheck, local bundle build, Windows Core and smoke tests passed. This commit is local and **not pushed** pending physical acceptance.

Six-client seeds 127-133 converged all six text edits in about 12-14 seconds each, but the normal-close probe timed out. Commit `16665c74` fixes the test actor's asynchronous reply after UI shutdown and the product's late WebView2 reply after disposal. Windows smoke passed its post-disposal reply regression at `windows/build/smoke-receipts-1da0a92551af4ee98300150c55660655`. After rebuilding the private PC actor, offline edit + normal close passed with a pending journal and no dialog (`stress-offline-close-143`); a separate process reopened with that marker (`stress-offline-reopen-143`). Six live clients then converged one append round and the Windows close probe passed without the dialog, followed by all six reopening on the saved hash. Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T23-17-16-382Z-144` and `stress-2026-10-11T23-18-33-746Z-145`. These runs reused an existing dedicated fixture; fresh-fixture and installed-client verification remain open.

Seed 125 on a repeatedly used attachment fixture entered Mac editor recovery after a local revision changed while pending edits existed; it did not maintain an active editor. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T21-59-14-222Z-125`. Reproduce on a fresh attachment fixture and fix if reproducible. Preserve its recovery journal.
Commit `73bcf43c` adds a passing Mac native regression for an incoming asset update with pending text followed by another local checkpoint. This proves the ordinary asset-update path but does not explain or pass the simultaneous same-entry asset replacement race from seed 125.
The seed 125 Mac actor saw all six text markers, then its editor changed to recovery during the 30-second stability observation. The old failure receipt captured only the end of the page and omitted the recovery banner. The stress actor now captures alerts and the page start so a fresh reproduction can name the actual error.
Mac sync also treated a retained same-item binary conflict as a full text checkpoint fence. The local fix permits text checkpoints only when the binary conflict remains on the same path and lifecycle, while full-pack/move/restore conflicts still block. `LocalVaultSyncTests` passes with a regression that retains the asset and checks the editor can save text. Fresh physical reproduction of seed 125 is still required.
The documented PC build workflow passed and sealed candidate `C:/Users/Shokunin/dev/texttext-release-136bc176/windows/build/candidate-2c7caa1c78ca4c16b91a24c1cbe069c4` with desktop smoke receipt `windows/build/smoke-receipts-903fb94d6e2c43868c6fcf2a8ea51ed1`. Install did not start because PC SSH reset again during authentication. A new fixture `Notes/Six-client acceptance fresh close 146.textpack` (item `8425e5f1-b0a4-48c8-804a-cbbcec3687da`) and role configs under `/private/tmp/texttext-six-20261011/fresh146/` are prepared; copy PC configs and wait for that file to sync before running.

Other acceptance gaps: whole TextPack and folder operations, delete/restore, two-account permissions, sustained typing/latency/resource measurements, offline/restart. Keep unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` untouched. Installed Mac app is build 1255; no website or public release was deployed.

## References

- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Previous receipts and context](archive/texttext-handoff-pre-e417ed28.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
