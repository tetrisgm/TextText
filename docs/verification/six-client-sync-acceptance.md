# Six-client synchronization acceptance

Owner requirement, October 8: exercise Mac CLI, Windows CLI, Mac desktop,
Windows desktop, Mac browser and Windows browser simultaneously. A subset or
six sequential checks does not pass this requirement.

## Required run

Use dedicated disposable test files and record each client's version, machine,
account, workspace, item identity and starting revision. Keep all six connected
to the same workspace during each round. Include a separate two-account round;
six sessions belonging to one account do not establish permission correctness.

Exercise:

- Small text insertions from each editor while both CLIs make direct file edits.
  Verify the expected merged text in every open editor and both saved TextPacks.
- Whole TextPack creation and replacement, original attachment bytes, folder
  creation, rename and move. Verify stable identities and no duplicate items.
- Overlapping edits, sustained typing, and edits to different fields. An explicit
  unresolved conflict is a failure to reconcile, not successful convergence.
- Disconnect one participant, continue edits elsewhere, reconnect automatically.
  Restart with pending edits and prove durable recovery without manual export.
- Delete and restore, stale uploads, access revocation and re-grant. Preserve
  permitted pending edits while preventing unauthorized writes or resurrection.
- Atomic CLI replacement and rapid successive file changes, including invalid
  intermediate files repaired by the next write. Never import partial bytes.
- Idle periods: no repeated mutation uploads, bounded reads, stable resource use.

Record input-to-visible-edit latency separately from complete file/asset
replication latency. Report distributions, not a single best result. Record
recovery time and exact final hashes/content. Repeat deterministic seeds and
retain failing seeds as regression tests in the independently gated sync system.
A file snapshot over SSH proves stored content, not a visible Windows editor.

## Current evidence and gaps

Mac 1232 and Windows `2e0e10c1` are installed; Oracle serves `texttext-oracle-20261009T023037Z-9189ee96` after complete
verification and thirteen live checks. Mac CLI changes reached the open native reader; native
live typing reached Safari before Finish; independent PC ZIP inspection confirmed
identity and both markers. This is a partial path, not the six-client run.

The current CUA inventory exposes the Mac desktop and Safari, but no Windows
computer/browser surface. Existing Windows WPF/WebView smoke runs on the physical
PC, but its isolated test transport is not a six-client cloud test. Native and
browser test orchestration must exercise real adapters and the same workspace;
mocked transports cannot satisfy this acceptance.

`scripts/verify-file-collaboration.ts` now measures twelve alternating small edits
between existing local Ada/Grace accounts, restores baseline text each time,
and retains its concurrent edits, offline/reload, idle-upload and permissions
checks. Results establish a local baseline only. The physical six-client run,
repeated fault schedule, file/attachment latency and iCloud eviction remain open.

The real Windows production-window runner now exercises native authentication,
files and Oracle without substituting its transport. A focused PC editor/CLI
round preserved all edits but exposed a 1,195 ms editing-surface interruption;
the earlier five-participant attempt was interrupted and did not pass. See
[live collision receipt](2026-10-08-live-windows-file-collision.md). Windows
browser orchestration and the complete six-participant run remain outstanding.

## Local two-account baseline receipt

October 8, compiled production source `9189ee96`, loopback server on the Mac,
local Postgres and existing Ada/Grace accounts. Twelve alternating single-character
edits measured input dispatch to remote visible text, including browser overhead:
452, 429, 447, 448, 457, 505, 432, 490, 448, 522, 448, 415 ms.
Median 448 ms, p95/max 522 ms. The regression limits local p95 to 1 second and
maximum to 2 seconds; these are regression ceilings, not an internet promise.

The entire existing collaboration scenario passed after timing: presence/comments,
concurrent edit convergence, writer-scoped undo/redo, offline reconnect, separate
tab journals, reload recovery, no idle repeat mutation uploads, canonical file
persistence, folder/file visibility and access downgrade. Zero browser runtime
errors. Test fixtures were cleaned by the verifier and the temporary server
stopped. Logs `/tmp/texttext-six-preflight-latency.log` and
`/tmp/texttext-latency-server.log`; TypeScript `/tmp/texttext-latency-types.log`.
