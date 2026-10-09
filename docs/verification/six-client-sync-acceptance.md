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

## Automatic campaign requirement

The six participants must be driven by a bounded, explicitly started coordinator,
not by an agent manually typing each edit. The coordinator generates and records
a seed, fixture identity, source/build identities, and the complete action plan.
All six report readiness before a round starts. A missing or disconnected actor
fails readiness; reducing the participant count cannot produce a passing receipt.
The Mac and Windows app/browser actors must use their real editing input path,
not mutate Y.Doc, call save APIs, or replace production transports. CLI actors
write the actual TextPack through ordinary filesystem APIs, without TextText CLI
or MCP. Both native apps stay running so those file changes are observed.

The live dashboard shows each role, current action, last observation, convergence
latency, pending work, editor continuity, and resource measurements. Retain a
machine-readable event stream plus a final receipt. Compare semantic document
content and attachment hashes; ZIP byte equality is not required. A client that
only reports its own successful input has not proved convergence.

Campaign stages, implemented and attested separately:

1. Repeated concurrent insert bursts, exact marker multiplicity and document
   equality, idle settling, and continuous editor observation.
2. Same-position inserts, overlapping replacements/deletions, multiple fields,
   Unicode, undo/redo, and sustained typing while both file actors save.
3. Per-participant transport loss, reconnect, dropped acknowledgements, reload,
   process termination with pending edits, and restart. Keep the other five
   active during the fault. Faults target only disposable test participants,
   never the machine's global network or unrelated services.
4. TextPack/attachment replacement, invalid intermediate bytes followed by
   repair, atomic rename, folder moves, deletion/restoration, and stale saves.
5. Separate-account permission changes and compatibility with retained older
   journals. Authentication failure is reported, never bypassed.

Each scenario defines its expected semantic result or allowed deterministic
outcomes before execution. Convergence alone cannot detect six clients agreeing
on lost edits. Require every accepted operation to be represented in the final
document or retained version history according to that scenario's policy.
Observe stable convergence across multiple samples and separately prove durable
reopen. An intentionally restarted actor may replace its editor only during the
declared fault window; the other editors must remain mounted throughout.

Default runs must have finite duration/round, output-size, process, memory, and
request budgets. Stop issuing mutations at the first failure, preserve evidence,
collect final observations, and shut down only runner-owned processes without
deleting journals. A hung actor gets a bounded shutdown timeout. Never retry a
failed seed into a passing result; replay is a new linked receipt. No automatic
source edits, installs, deployments, or permanent scheduled job are part of this
runner. An explicit soak invocation may repeat a bounded set of seeds.

Harness simulations test orchestration only. They must be labeled simulated and
cannot satisfy physical acceptance or substitute for a missing native adapter.

## Current evidence and gaps

The October 9 [physical six-client live-edit round](2026-10-09-six-client-live-edit.md)
passed simultaneous small-text convergence and saved-file equality. The
October 9 [invalid intermediate TextPack round](2026-10-09-invalid-intermediate-textpack.md)
passed open-editor recovery and saved-file equality after repair. The
two-account and other fault rounds below remain open. Earlier evidence in this
section is historical.

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

The in-place merge candidate `3082bb49` passes two real Windows app/CLI collision
runs, including continuous observation that the original editor was never removed,
and browser/unit undo tests. [In-place merge receipt](2026-10-08-inplace-file-merge.md).
This fixes the reproduced interruption for those cases, not the full matrix.

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
