# Workspace and permission acceptance, 1189

Desktop source `54f33a4e`; Oracle remains the compatible web source `43614e64`,
deployment `texttext-oracle-20261008T073956Z-43614e64`.

## Verification

- Exact-source core gate: 588 tests; TypeScript passed. Required native suites,
  including the real two-vault HTTP contract, passed. Logs:
  `/tmp/texttext-sync-54f33a4e.log` and `/tmp/texttext-sync-43614e64.log`.
- Mac 0.204 (1189) signed and installed at `/Applications/TextText.app` with
  three verified extensions. Normal quit/install retained the account, iCloud
  workspace and open verification note. Actual startup showed editing controls.
  Logs: `/tmp/texttext-mac1189-build.log`, `/tmp/texttext-mac1189-install.log`.
  The installer runtime-health probe was disabled under the established local
  workflow; actual UI startup was checked separately.
- Oracle normal deployment passed thirteen live checks. A fresh validated backup
  preceded migration. TextText and all three Algorave services remained active;
  HAProxy/runtime configuration mtimes were unchanged. Logs:
  `/tmp/texttext-oracle-43614e64-build.log`,
  `/tmp/texttext-oracle-43614e64-deploy.log`.
- Actual Mac and freshly loaded Safari account menus displayed the owned current
  workspace. The current workspace choice was disabled rather than reopening it.
- Mac UI saved `Workspace capability verification 1189.` exactly once in the
  dedicated `Agent template creation verification 1185` note. Its four original
  headings remained intact. The marker was present in the local TextPack and
  appeared automatically in the existing Windows and Safari views.
- Actual Mac command search found the new body text and reopened the same note.
  This verifies invalidation after the edit; unchanged reader performance is
  covered by the earlier bounded-performance receipt.

## Defect found during live acceptance

Build 1188 obtained new permissions after Oracle deployment but did not refresh
the Mac listing when no file bytes changed. Windows had the same notification
gap. `5a4deb7d` and `54f33a4e` make changed durable capabilities notify the UI.
Mac regression drives the real controller with a permission-only HTTP response;
Windows regression requires one notification for changed permissions and none
for an unchanged snapshot. Offline permission caches and pending writes remain
intact. Build 1189 contains both fixes.

## Limits

The account exposes one workspace, so live switching between differently
permissioned workspaces is not attested. Preparation, failed flush, revocation,
partial manifests and offline restart cases are regression-tested. Windows
save/reopen return-path acceptance is still in progress; an initial input attempt
made no on-disk edit and is not treated as a sync failure. No public desktop
release was published. Broader product completion remains unproven.
