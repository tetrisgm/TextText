# TextText handoff

## Current delivery (October 9)

Windows TextText is installed from source `19a79616`; its cold-start evidence
is `/tmp/texttext-win-final19-delivery.md`. Oracle serves source `06c3ad60`
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
are also present in the local TextPack's `text.md` and `document.json`; the Mac
reader accessibility tree displayed a shorter body, requiring a visual/editor
convergence check before declaring the six-client round complete.

## Open work

- Source `22a3ffa2` makes stale live epoch bindings fail closed into the
  durable reopen path. The focused 35-test epoch suite, live browser adoption
  check, TypeScript, and complete local-Postgres sync gate passed (885 shared
  tests plus native checks). It is included in the deployed and Mac-installed
  source above; Windows still needs an update and physical acceptance.
- The simultaneous Mac/PC app, browser and direct-file small-text round passed
  with all 13 edits visible and identical saved `text.md` hashes. See the
  [physical six-client receipt](verification/2026-10-09-six-client-live-edit.md).
  A brief invalid TextPack write with both Mac editors open also recovered and
  converged to Windows; its [receipt and native regression](verification/2026-10-09-invalid-intermediate-textpack.md)
  are in `8616ce61`.
  The remaining fault and two-account rounds in the
  [acceptance contract](verification/six-client-sync-acceptance.md) are open.
- Windows' older `Six-client acceptance 1232a` journal remains protected: no
  pending marker was lost, but automatic epoch merge could not absorb it. The
  exact checkpoint, journal and cloud evidence is in the Windows report above.
  Preserve that journal and improve live recovery without closing the editor.
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
