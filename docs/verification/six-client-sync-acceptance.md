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

October 11 paired-asset follow-up: the coordinator now drives two different
attachment replacements in the same round, one from each direct-file actor.
On fresh fixture `Notes/Six-client acceptance paired assets 1254.textpack`, all
six real clients passed two rounds with zero rejected edits and final text hash
`db3ee9dd3fb9e9dc02b7be70e4f46f8402410cfeff4c32b90de111b816f7dcd7`.
The Mac and PC file actors both attested the exact new hashes of
`assets/mac.bin` and `assets/pc.bin`; a separate fresh-process reopen passed
all six. Receipts:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T20-01-04-011Z-111`
and `stress-2026-10-11T20-02-33-181Z-112` alongside it. This covers
different-entry merge, not same-entry conflict preservation. Whole-item moves,
delete/restore, two-account permissions, and latency distributions remain open.

October 10 physical runner receipts: seed 42 passed one concurrent six-client
append round; seed 43 passed five rounds; seed 44 passed ten rounds and a
six-client restart with the exact final body hash. Seed 46 passed a Mac browser
offline edit and reconnect while the other five clients edited; seed 47 did
the same for the PC browser and passed a subsequent six-client restart. See
`docs/HANDOFF.md` for receipt paths and `sync/stress/README.md` for the runner.
These prove stage 1 append and browser transport-loss slices of stage 3.
Seed 49 passed two rounds with a temporary invalid Mac CLI TextPack repaired
while all editors stayed open. Seed 50, the corresponding PC CLI case, failed
when the Windows native editor lost the selected document; see
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T05-29-50-412Z-50`.
Source `b8ce3147` retains the last valid Windows inventory entry through a
temporary invalid ZIP and has a local regression. A private Windows build
passed the fresh physical six-client replay, seed 52, for two rounds with exact
convergence; receipt:
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T05-44-56-930Z-52`.
A second fresh fixture passed five rounds:
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T05-47-13-104Z-53`.
Seed 51 stopped before edits because Mac file activation retained the previous
note; it is a separate startup/setup failure, not a passed replay.
Same-position insertion by the four real editors while the Mac and PC CLI
actors appended passed on two fresh fixtures: seed 56, one round, receipt
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-00-38-369Z-56`;
seed 57, five rounds, receipt
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-02-00-583Z-57`.
Seed 55 stopped before edits because the disposable Mac test bundle lacked its
Sparkle rpath; it was rebuilt and verified before seed 56.
Unicode content (accented Latin, Japanese, and emoji) passed five concurrent
rounds on all six clients, seed 58:
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-06-34-459Z-58`.
A six-client restart reopened its exact final Unicode body hash, seed 59:
`/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-08-11-490Z-59`.
An independent EOF replacement/CLI append round passed on a fresh six-client
fixture with Mac 1244 and the matching Windows candidate, seed 63:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T11-07-11-624Z-63`.
A six-client durable reopen passed its exact final hash:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T11-08-07-908Z-63`.
Exact same-span replacement with the Mac CLI changing the file passed on
a fresh fixture with Mac 1245 and the matching Windows candidate, seed 65:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T11-28-30-763Z-65`.
All six reopened its final hash:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T11-29-05-836Z-65`.
The reciprocal seed 66 (Windows CLI changing that span) failed after edits:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T11-36-04-727Z-66`.
The PC native editor became uneditable with `collaborationState=error`;
the PC CLI file retained only its own marker, while the other four clients
converged separately. Seed 68 reproduced the failure after a Windows
checkpoint classification fix:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T11-54-27-633Z-68`.
The remaining cause was the terminal newline: live editors replaced the final
paragraph without it, while direct file writers retained it. `7e780c26`
reconciles this precise overlap without dropping either edit and adds shared
client regression coverage; `9a5873f2` covers the Windows checkpoint retry.
Fresh seed 70 passed the PC CLI replacement with Mac build 1246 and the
matching installed Windows candidate:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T12-16-35-247Z-70`.
All six reopened its exact final hash in
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T12-17-14-110Z-70`.
Fresh seed 71 passed the Mac CLI replacement and six-client durable reopen:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T12-18-42-489Z-71`
and
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T12-19-16-963Z-71`.
Both edit rounds kept the four real editors mounted, rejected no events, and
converged to one exact semantic hash across all six clients.
The first two seed-66 attempts failed during setup and do not count.
The earlier failed seeds 62 and 63 remain preserved as regression evidence;
the passing run used a new fixture and builds carrying `052c0ab7`.
Partial overlap previously failed on PC file-edits with four live editors:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-04-19-431Z-72`,
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-14-11-581Z-72`,
and `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-29-19-230Z-72`.
The common ancestor had to come from the TextPack projection stamp; then an
incidental one-character match inside the editor replacement still caused the
bounded overlap guard to reject it. `c2ba73e7` and `d1a50853` have regressions
for both paths. With Mac 0.204 build 1250 and the matching installed Windows
candidate, fresh seed 72 passed PC CLI partial replacement and six-client
durable reopen:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-50-09-345Z-72`
and `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-51-13-975Z-72`.
Fresh seed 73 passed the reciprocal Mac CLI partial replacement and reopen:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-53-22-965Z-73`
and `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T13-54-06-927Z-73`.
Both edit rounds kept the four live editors mounted and rejected no events.

Fresh seed 87 passed a six-client partial-overlap round: all four real editors
replaced the same sentence while the Mac CLI replaced only its trailing span
and the PC CLI appended. No edit was rejected; all six converged to hash
`d8b0cea3833a8258c95e4ee3f629e144d67b359292884d4825e4c3ff3a92924e`.
The first process run and separate all-client reopen are
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-49-54-501Z-87`
and `stress-2026-10-11T15-51-15-372Z-87` alongside it. This covers one
partial-overlap shape; it does not establish every deletion/undo interleaving.

Seed 88 passed three concurrent append rounds with a bundled asset, and a
separate all-client reopen. The Mac and PC file actors attested the identical
decompressed `assets/photo.png` SHA-256
`b0e8a8eb92c36f8866407013c607f13127ae9f48b7f6750f236851d23426664d`
throughout; all six editors converged to final text hash
`b64e7d86a774cef215e889e6a7154084738831ca15e5901d2d763018b9fad33f`.
Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-58-24-974Z-88`
and `stress-2026-10-11T16-00-14-261Z-88` alongside it. This proves asset
preservation during text edits, not an asset replacement while editors are open.

The next fresh fixture, `Notes/Six-client acceptance asset change 1289.textpack`,
failed the asset-replacement gate on seed 89. Text converged across all six
clients, but `assets/data.txt` in the PC TextPack changed to SHA-256
`895692fe69b1996a44038642c0ebc53f814382d12caef20c5d720ac74d4b55d3`
while the Mac TextPack kept
`774fad1cfcea3a4d01cfe03035eeb72d315cb748eda21e25d32b0994b20b1d03`.
Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T16-11-05-790Z-89`.
This is a product failure: open native sessions suppress ordinary pack sync,
and document collaboration does not transport changed asset bytes. A later
asset fix must pass on a new fixture, including an all-client reopen.

Native app transport loss now has two physical six-client append rounds with
zero rejected edits, followed by separate all-client reopen checks with the
expected content hashes. Mac app offline/reconnect: seed 74 receipts
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T14-14-48-939Z-74`
and `stress-2026-10-11T14-15-44-433Z-74`. Windows app offline/reconnect:
seed 78 receipts `stress-2026-10-11T14-33-19-649Z-78` and
`stress-2026-10-11T14-34-00-345Z-78`. The private Windows actor initially
rejected the correct offline UI state; `d29ad182` fixes that test assertion.
Both private native actors now retry an Edit click once during reader rerender
(`da744796`), while still requiring a joined editable document before attesting.
These receipts do not cover process termination or a long offline interval.

Mac-app pending-edit crash/restart and separate six-client reopen passed on
seed 81 (`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-08-47-106Z-81`
and `stress-2026-10-11T15-09-21-179Z-81`). Reciprocal Windows-app crash/restart
and reopen passed on seed 85 (`stress-2026-10-11T15-34-34-103Z-85` and
`stress-2026-10-11T15-36-19-395Z-85`). Both edit rounds had zero rejected
events. The earlier failed seed 83 and first seed-85 readiness attempt remain
recorded as failures. Whole-file/attachment and folder operations, separate
account permissions, and latency distributions still need physical campaigns.
The historical notes below predate this runner.

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
