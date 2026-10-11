# TextText handoff

## Current work (October 10)

The seeded [six-client stress runner](../sync/stress/README.md) now uses the
real Mac and Windows app editors, browsers, and direct TextPack files. The
private Mac actor and isolated Windows acceptance project compiled and were
smoke-tested; neither was installed. All 44 harness tests and 377 sync client
tests pass on the Mac. Windows isolated build passed on the PC with two existing
NU1510 package warnings and no errors.

Real run `stress-2026-10-11T05-00-43-801Z-42` passed one simultaneous-edit
round across all six clients. Reusing that fixture for seed 43 exposed a
three-way temporary divergence. The coordinator stopped the live clients as
soon as each replica contained all six role IDs, before their different
suffixes converged. It now re-observes within a bounded window while keeping
all clients open. A simulated regression verifies this behavior. Fresh-fixture
run `stress-2026-10-11T05-06-08-679Z-43` passed five of five rounds; run
`stress-2026-10-11T05-09-06-457Z-44` passed ten of ten. All four app/browser
editors retained their sessions throughout, all direct file actors participated,
and exact body hashes matched at each round. The subsequent zero-edit restart
`stress-2026-10-11T05-14-28-800Z-45` reopened all six clients and matched the
ten-round final hash `546d880493cbb710ee8c0d375683bb26d2d5e37a84915ad7e1bf1aa6db25bff7`.
Per-role state, timings, and
dashboard receipts are in `/private/tmp/texttext-six-20261010/results/`.

Browser transport fault runs `stress-2026-10-11T05-19-28-353Z-46` (Mac browser)
and `stress-2026-10-11T05-21-50-430Z-47` (PC browser) each passed two rounds
with the selected browser offline during the first concurrent edit, then
reconnected. `stress-2026-10-11T05-22-23-938Z-48` passed the six-client durable
reopen against the PC browser fault run's final hash. The harness has 45 tests.

This is real six-client append acceptance, not full sync certification. The
remaining acceptance contract includes native offline/reconnect, conflicting
replacement and deletion, crash/restart, file moves, and sustained latency
checks. The current runners exercise concurrent app/browser/CLI appends only.
Keep these receipts and disposable fixture files; do not alter user notes or
journals. No public Mac release was made.

## Current delivery (October 9)

Windows TextText is installed from source `06c3ad60`. Its self-contained
candidate passed native, shared-client (375 tests), and interactive desktop
smoke checks; the build log is `/private/tmp/texttext-win-06c3-build.log`.
The prior app is retained at
`C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261009T122646-7fb9dc95`
and preinstall sync state at
`C:\Users\Shokunin\dev\texttext-preinstall-sync-06c3ad60` (274 files).
The installed app opened signed in, with its window physically checked on the
PC. Its old `Six-client acceptance 1232a` recovery warning was resolved by
`Save a copy and reopen`; the separate recovered TextPack retains the PC-only
`pc-cli:preflight1232c:00` marker, while the shared note reopened without the
warning. The earlier conflict evidence is `/tmp/texttext-win-final19-delivery.md`.
Oracle serves source `06c3ad60`
from release `20261009T191004Z-tt-1242-06c3ad60-6ac93a64-97399e`.
`/private/tmp/texttext-promote-06c3.log` records the exact-source web gate,
database migration preflight, deployment, and 13 authenticated smoke checks.
TextText and Algorave remained active after deployment.

Mac 0.204 build 1242 is installed from source `06c3ad60`. The local
Apple Development Store-shaped build preserved native Apple sign-in and all
three extensions. Its build and installer receipts are
`/private/tmp/texttext-mac1242-store.log` and
`/private/tmp/texttext-mac1242-store-install.log`. The installed app reopened
the signed-in account, selected iCloud workspace, and existing note. The
standalone build passed 18 isolated health checks in the promotion receipt;
the Store-shaped build's sandbox prevents that runner from returning its
private report, so runtime health on the installed build needs UI checks.
The production browser is signed in on the same note. Its saved late markers
are also present in the local TextPack's `text.md` and `document.json`; the
Mac reader showed them after scrolling. The accessibility tree shortened the
long body but the visible reader did not. Installed build 1242 found the note
through Search, saved a new `Mac build 1242 save check` note, reopened it,
and the signed-in production browser found that note with the saved body.

## Open work

- The real six-client stress runner passed seeds 42 (one round), 43 (five), 44
  (ten), a six-client restart of 44, Mac-browser offline seed 46, PC-browser
  offline seed 47, and a restart of 47. Receipts are under
  `/private/tmp/texttext-six-20261010/results/`; the test contract and runner
  README list the coverage. Mac CLI invalid/intermediate TextPack seed 49 passed
  two rounds. PC CLI invalid/intermediate seed 50 **failed**: the Windows native
  editor left its selected document. Its receipt is
  `/private/tmp/texttext-six-20261010/results/stress-2026-10-11T05-29-50-412Z-50`.
  Windows inventory fix `b8ce3147` retains the last valid entry during a
  temporary invalid ZIP and has a focused regression that distinguishes repair
  from actual deletion. PC SSH recovered. A fresh six-client PC CLI replay
  passed two rounds with all editors open and exact convergence; receipt:
  `/private/tmp/texttext-six-20261010/results/stress-2026-10-11T05-44-56-930Z-52`.
  A second fresh fixture passed five rounds under the same PC CLI fault:
  `/private/tmp/texttext-six-20261010/results/stress-2026-10-11T05-47-13-104Z-53`.
  Same-position insertion by all four live editors, concurrent with both CLI
  file edits, passed one and five rounds on fresh fixtures, receipts:
  `/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-00-38-369Z-56`
  and `/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-02-00-583Z-57`.
  Unicode edits across all six clients passed five rounds with exact text
  equality: `/private/tmp/texttext-six-20261010/results/stress-2026-10-11T06-06-34-459Z-58`.
  An earlier setup attempt (seed 51) stopped before edits when the Mac actor
  reopened the previously selected note; the fixture was opened explicitly
  before seed 52. The native file-open event now queues behind an in-progress
  navigation rather than disappearing; the browser regression holds the first
  file read, dispatches a second native open, then proves the queued read runs.
  This source change is not yet installed. The Windows repair fix is physically verified in the private Windows test
  build, but six-client acceptance is not complete and the installed Windows
  app has not been updated.

- Automatic six-client [runner/protocol](../sync/stress/README.md) has real
  Mac and Windows app, browser, and direct-file actors with bounded rounds,
  retained receipts, restart checks, and browser offline / invalid-file fault
  options. It passed 47 harness tests. Its simulated example is only a harness
  check. Physical acceptance remains limited to the slices recorded above;
  implement and exercise the remaining fault matrix in the
  [acceptance contract](verification/six-client-sync-acceptance.md).
- Source `0f224adb` addresses two failures exposed by the local two-account browser
  collaboration run: undo silently stopped after React StrictMode effect
  replay, and a reload could start a fresh journal while the old page still
  held the pending journal's Web Lock. The full 377-test sync client gate,
  StrictMode browser epoch test, and local two-account collaboration run pass.
  The latter covers same-position inserts, offline two-tab recovery,
  writer-scoped undo/redo, idle uploads, and permission downgrade. This
  source is not yet installed or deployed; physical six-client fault rounds
  remain open.
- `release/promote-local.sh` now builds and checks the sandboxed Apple
  Development app with native Apple sign-in before Oracle deployment, after
  the isolated standalone health check. This fixes the prior promotion path
  that deployed web then tried to install a browser-only Mac app. The focused
  contract test passed; the amended promotion has not been run end to end.

- Source `22a3ffa2` makes stale live epoch bindings fail closed into the
  durable reopen path. The focused 35-test epoch suite, live browser adoption
  check, TypeScript, and complete local-Postgres sync gate passed (885 shared
  tests plus native checks). It is included in the deployed, Mac-installed,
  and Windows-installed source above; physical fault acceptance remains open.
- The simultaneous Mac/PC app, browser and direct-file small-text round passed
  with all 13 edits visible and identical saved `text.md` hashes. See the
  [physical six-client receipt](verification/2026-10-09-six-client-live-edit.md).
  A brief invalid TextPack write with both Mac editors open also recovered and
  converged to Windows; its [receipt and native regression](verification/2026-10-09-invalid-intermediate-textpack.md)
  are in `8616ce61`.
  The remaining fault and two-account rounds in the
  [acceptance contract](verification/six-client-sync-acceptance.md) are open.
- A fresh [browser edit with the Mac reader open](verification/2026-10-09-browser-mac-windows-live-note.md)
  appeared before Finish and reached both Mac and Windows TextPacks with the
  same extracted Markdown hash. The Windows app was open on a different note,
  so its visible editor is not covered by this receipt.
- The [Windows save/restart receipt](verification/2026-10-09-windows-save-restart.md)
  covers a fresh physical PC app edit, durable flush, separate-process reader
  reopen without a recovery notice, and Mac file catch-up. The installed PC app
  was relaunched afterward. Pending-edit restart and concurrent fault rounds
  remain open.
- An [agent-created built-in note](verification/2026-10-09-agent-template-cross-client.md)
  kept one ID under idempotent retry, retained its template version, and
  appeared in the Mac app, production browser, and Windows files. A
  [custom agent-authored type](verification/2026-10-09-agent-custom-type-cross-client.md)
  also passed idempotent creation, item creation, signed-in browser rendering,
  and Windows file propagation. Type update/remix/retire and the wider agent
  permission/proposal matrix remain unverified.
- The older Windows `Six-client acceptance 1232a` journal could not merge
  automatically across an epoch change. Its edits are retained in the
  recovered TextPack and preinstall sync backup above. Test live recovery
  without closing the editor on a new disposable note; the manual recovery
  of this historical conflict does not prove automatic convergence.
- The Mac's older File Provider mount is not enumerable. Source `1a6abf82`
  made the selected iCloud vault the storage health target; build 1241 passed
  installer health without bypass. The Finder provider still reports a
  warning and needs separate repair if it is to be supported. Do not reset
  the mount or user files.
- The main checkout has unrelated dirty edits in
  `src/components/workspace/assistant/attachments.ts` and
  `src/lib/workspace/__tests__/tabs.test.ts`; preserve them.

## References

- [Sync design](file-vault-collaboration-2026-09-30.md) and [agent interoperability](agent-interoperability.md)
- [Oracle operations](../release/oracle/README.md)
- [Archived earlier handoff](archive/HANDOFF-2026-10-09-pre-final19.md)
