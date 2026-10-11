# TextText handoff

## Current work (October 11)

Source `80bcd4e2`, `725281fa`, and `ce6f5cba` repair Mac collaboration
restoration and same-item open races. `fe103e26` preserves an unfocused editor
during local-to-shared promotion. The focused and unfocused browser regressions,
TypeScript, and the client and core sync gates passed. A private signed Mac
stress actor was rebuilt from current source; the installed Mac app remains
build 1250, and neither Oracle web nor a public Mac release was deployed.

Six real clients passed a Mac-app offline edit plus forced crash/restart on
fixture `Notes/Six-client acceptance Mac crash 1281.textpack`, followed by a
fresh-process six-client reopen with identical hash
`c5ad0bbc167d6d21a9039ca07ed4cd5819ba7f88420fc0e94053e1cc76c7890b`.
Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-08-47-106Z-81`
and `stress-2026-10-11T15-09-21-179Z-81` alongside it. Earlier Mac and
Windows transport-loss/reconnect plus reopen receipts are listed in
[the acceptance contract](verification/six-client-sync-acceptance.md).

The reciprocal PC-app pending-edit crash passed on fresh fixture
`Notes/Six-client acceptance PC crash 1285.textpack` with zero rejected edits,
followed by a six-client fresh-process reopen at exact hash
`f627b9e3a2490d1186d2a13682b3fbf3a50977cdfe44a2abd406844628440408`.
Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-34-34-103Z-85`
and `stress-2026-10-11T15-36-19-395Z-85` alongside it. The prior seed 83
failure and seed 85 first readiness failure remain recorded, not counted as
passes. The Windows process-stop relay was corrected to wait on its validated
process object. Initial Mac native activation sometimes reopened the previous
file. The frontend now gives an explicit native open priority over saved-location
restoration; early/queued browser regressions and a fresh physical six-client
reopen passed at `stress-2026-10-11T15-42-38-187Z-85`. Repeat on a new fixture
before considering the startup race closed.

Fresh seed 87 passed a real six-client partial-overlap round with zero
rejected edits, then a separate all-client reopen at exact hash
`d8b0cea3833a8258c95e4ee3f629e144d67b359292884d4825e4c3ff3a92924e`.
Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-49-54-501Z-87`
and `stress-2026-10-11T15-51-15-372Z-87` alongside it.

Seed 88 passed three six-client text rounds and fresh reopen while both Mac
and PC TextPacks retained exact attachment hash
`b0e8a8eb92c36f8866407013c607f13127ae9f48b7f6750f236851d23426664d`.
Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-58-24-974Z-88`
and `stress-2026-10-11T16-00-14-261Z-88`. The harness now requires both file
actors to attest exact asset bytes. In-flight replacement on fresh fixture
`Notes/Six-client acceptance asset change 1289.textpack` **failed** seed 89:
all six clients converged on text, but `assets/data.txt` changed only in the
PC pack. The Mac pack retained the old hash. Receipt:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T16-11-05-790Z-89`.
The active native shared session excludes the item from normal pack sync; Yjs
updates carry text/document data, not changed binary entry bytes. The server
can project a live asset-only pack edit without resetting its Yjs epoch
(`src/lib/vault/collaboration.test.ts`), but native upload and remote materialization
while open need a durable, fenced path. Do not replay seed 89 as a pass.
The required protocol and regression matrix are in
[live binary sync](verification/live-binary-sync.md).
Commit `60ef2040` adds an authenticated binary-entry GET/PATCH surface and an
atomic per-entry hash/lifecycle compare-and-swap writer that advances the live
Yjs sequence without replacing text. Store and route tests passed, including
receipt replay, same-entry conflict, lifecycle fencing, and text edits before
and after a binary change. A follow-up adds scoped binary transport on web,
Windows, and Mac, with focused web and Mac relay tests. Native Swift and .NET
sync transports also now expose the scoped calls; the .NET transport contract
test passes. Windows now durably stages and sends direct asset changes in an
open editor. Its native tests cover lost acknowledgment, same-entry conflict,
and temporary provider-file absence. Windows now keeps queued asset bytes in
an atomic sidecar file so a large attachment does not inflate the sync-state
JSON. Mac now durably stages direct asset
edits in an open editor and replays the same operation after a lost reply and
process restart; its 35 focused sync tests pass. Both native inbound paths
and browser asset refresh remain open; seed 89 is still a failure.

Next: repair live binary-entry propagation while native editors stay mounted,
verify with a fresh six-client fixture and separate reopen; then whole TextPack and folder operations,
separate-account permissions, and sustained latency/resource tests. Do not
call sync certified or ship a public release until the matrix passes. The
unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs
tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` belong to
other work; preserve them.

## Earlier records

[Archived October 9–11 handoffs](archive/texttext-handoff-through-2026-10-11.md).

## References

- [Sync design](file-vault-collaboration-2026-09-30.md) and [agent interoperability](agent-interoperability.md)
- [Oracle operations](../release/oracle/README.md)
- [Archived earlier handoff](archive/HANDOFF-2026-10-09-pre-final19.md)
