# TextText handoff

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

- Automatic six-client coordinator: [runner/protocol](../sync/stress/README.md)
  now provides seeded concurrent append rounds, readiness barriers, exact text
  and baseline preservation checks, editor continuity, bounded child processes,
  a live local dashboard, and retained replay/evidence files. Its 13 harness
  tests are included in the sync client/core gate. The example is explicitly
  simulated and establishes no physical acceptance. Next integrate the real
  Windows runners and Mac editor/Safari/direct-file actors with the protocol,
  then add the named fault scenarios in the acceptance contract. Do not count
  command-based app appends as native editor input.
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
