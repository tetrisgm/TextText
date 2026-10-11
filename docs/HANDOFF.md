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
process object. Initial Mac native activation can still open the previous file
before the new fixture; investigate that startup race independently.

Next: continue overlap and whole TextPack/assets, folder operations,
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
