# TextText handoff

## Current delivery (October 9)

Windows TextText is installed from source `19a79616`; its cold-start evidence
is `/tmp/texttext-win-final19-delivery.md`. Oracle serves
`texttext-oracle-20261009T122053Z-19a79616`; the deployment receipt is
`/tmp/texttext-oracle-19a79616-ship.log`. Algorave remained active.

Mac 0.204 build 1241 is installed from source `c786b505`. Its exact-source
release receipt is `/private/tmp/texttext-delivery-1a6abf82/.texttext/release-gate-receipt.json`;
build, isolated health and install receipts are `/tmp/texttext-mac1241-build-final.log`,
`/tmp/texttext-mac1241-health.log` and `/tmp/texttext-mac1241-install.log`.
The isolated app passed 18 checks, and the normal installer passed with one
warning for the older Finder provider mount. The running app opened the
selected iCloud workspace and existing note. Build 1240 had already proved
search, save/reopen and direct CLI/atomic ZIP edit visibility on a test note.

## Open work

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
