# TextText handoff

## Current delivery (October 9)

`main` source `19a79616` is installed as Windows TextText and Mac 0.204 build
1240. Oracle serves `texttext-oracle-20261009T122053Z-19a79616`. The exact
source passed the full release gate; the release receipt is in the clean build
snapshot at `/private/tmp/texttext-delivery-b65c4ca5/.texttext/release-gate-receipt.json`.
Windows cold-start evidence: `/tmp/texttext-win-final19-delivery.md`. Mac build,
install and Oracle deploy logs: `/tmp/texttext-mac1240-19-build.log`,
`/tmp/texttext-mac1240-19-install-known-finder.log`, and
`/tmp/texttext-oracle-19a79616-ship.log`. The Mac app opened the existing iCloud
workspace, found an existing note, and saved/reopened a new note. Share,
Quick Look and File Provider extensions are registered. Oracle deployed with a
fresh backup and passing authenticated smoke checks; Algorave remained active.

## Open work

- The six-client Mac/PC app, browser and CLI torture run is in progress. Its
  report target is `/tmp/texttext-six-final19-report.md`. Do not claim sync
  acceptance before every client converges and its editors survive.
- Windows' older `Six-client acceptance 1232a` journal remains protected: no
  pending marker was lost, but automatic epoch merge could not absorb it. The
  exact checkpoint, journal and cloud evidence is in the Windows report above.
  Preserve that journal and improve live recovery without closing the editor.
- The Mac's preexisting File Provider mount is not enumerable. Both build 1239
  and 1240 fail `workspace.storage` and `finder.provider` live health on that
  mount, although the selected iCloud vault is usable. The attested candidate
  passed isolated health; the local installer used
  `TEXTTEXT_REQUIRE_RUNTIME_HEALTH=0` for this known mount failure. Fix the
  provider or correct the health contract for a selected iCloud vault before
  treating runtime health as green. Do not reset the mount or user files.
- The main checkout has unrelated dirty edits in
  `src/components/workspace/assistant/attachments.ts` and
  `src/lib/workspace/__tests__/tabs.test.ts`; preserve them.

## References

- [Sync design](file-vault-collaboration-2026-09-30.md) and [agent interoperability](agent-interoperability.md)
- [Oracle operations](../release/oracle/README.md)
- [Archived earlier handoff](archive/HANDOFF-2026-10-09-pre-final19.md)
