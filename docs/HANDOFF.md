# TextText handoff

## Current work (October 11)

Source `80bcd4e2` restores the Mac collaboration engine synchronously from a
previously verified folder binding before network discovery. Source `725281fa`
retries a same-item local file change between reader read and editor open;
`ce6f5cba` fences the restored engine to the requested workspace. All are on
`origin/main`. Targeted Mac connection/session tests, TypeScript, and the
focused shared-open test passed. A private signed Mac stress actor was rebuilt
from this source and bundled local-vault UI; the installed Mac app is still
build 1250, and neither Oracle web nor a public Mac release was deployed.

Six real clients passed a Mac-app offline edit plus forced crash/restart on
fixture `Notes/Six-client acceptance Mac crash 1281.textpack`, followed by a
fresh-process six-client reopen with identical hash
`c5ad0bbc167d6d21a9039ca07ed4cd5819ba7f88420fc0e94053e1cc76c7890b`.
Receipts: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-08-47-106Z-81`
and `stress-2026-10-11T15-09-21-179Z-81` alongside it. Earlier Mac and
Windows transport-loss/reconnect plus reopen receipts are listed in
[the acceptance contract](verification/six-client-sync-acceptance.md).

The reciprocal PC-app pending-edit crash is **not yet verified**. Fixture
`Notes/Six-client acceptance PC crash 1283.textpack` reached all six clients
and the offline edit, then the Windows private relay failed at process restart.
Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T15-17-00-645Z-83`.
A bounded private relay diagnostic was added on the PC at
`C:/Users/Shokunin/dev/texttext-stress-20261010/scripts/stress-native-relay.mjs`;
inspect `C:/Users/Shokunin/dev/texttext-windows-d1a50853/pc-app-session-pccrash1283b/task-error-crash.txt`
when `ssh pc` recovers. SSH currently resets after authentication. Preserve
that fixture and all recovery journals; do not count this as a passing crash
case. New fixtures also sometimes need a second readiness attempt while the
file first propagates; measure and fix that delay separately.

Next: diagnose the PC crash relay and repeat on a fresh fixture, then its
six-client durable reopen. Continue whole TextPack/assets, folder operations,
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
