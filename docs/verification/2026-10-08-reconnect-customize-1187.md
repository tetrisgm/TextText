# Reconnection and customization, build 1187

Verified source `4c7efe85`. Mac 0.204 (1187) installed at
`/Applications/TextText.app`; Windows uses the same source. Oracle serves `texttext-oracle-20261008T070633Z-4c7efe85`.

## Changes and verification

- Recovery probes return immediately before resuming long polls. The unchanged
  document regression verifies automatic return to ready without an edit, one
  subsequent long poll and no upload. This addresses the additional latency
  found during the [1186 deployment](2026-10-08-shared-template-preview-1186.md).
- Bookmark reader baselines release after pending writes/drafts settle rather
  than retaining every previously visited full file and its assets. Focused
  regressions cover queued writes and use of a fresh baseline after revisiting.
- Shared-workspace discovery rechecks grants after filesystem listing, so a
  revoked invitation cannot leak names from the earlier grant snapshot.
- Web item Customize uses persisted template commands with frozen-content
  preview and target/source hashes. A new reusable definition and its application
  require separate approvals. Navigating to another item clears/fences the old
  customization target. Folder customization remains native-only.
- Exact-source core: 555 tests in 51 suites, TypeScript and native gate passed.
  Native selected suite ran 47 tests. `/tmp/texttext-sync-4c7efe85.log`.
- Actual proposal browser passed on frozen source; web Customize send,
  no-autosend and navigation checks passed before freeze. The tests approve
  the original proposal ID, never write raw archives. No live model execution.
- Mac build/signatures/three extensions passed. Normal replacement retained
  account, iCloud root and the existing four-heading agent-created document.
  `/tmp/texttext-mac1187-build.log`, `/tmp/texttext-mac1187-install.log`.
  Installer runtime health remains the established local unverified exception;
  actual app startup was separately checked.

Unchanged performance and cross-device dataflow evidence remains in
[1185](2026-10-07-shared-templates-performance-1185.md). No public desktop release.

Windows passed 260 shared tests, native tests and actual desktop smoke. Existing
account, item, four headings and Mac presence remained correct without content
changes. See [Windows receipt](2026-10-08-windows-shared-1187.md).

Oracle passed all 13 live checks. The first deployment safely refused before
switching because accumulated deployment copies left less than the backup
reserve. With explicit owner approval, 26 obsolete releases and matching upload
directories were removed, retaining the live release, prior rollback and new
candidate. Documents/backups/unrelated services were untouched. Retry created
its backup and passed; free space was 27 GiB afterward. All four TextText/Algorave
services were active. Logs: `/tmp/texttext-oracle-4c7efe85-{deploy,retry}.log`.

Real Safari reload preserved the existing item and Mac/Windows presence.
More > Customize opened the design composer, with no automatic send or content
change. The configured-provider requirement remains; live model execution was
not attempted. The panel was closed afterward.
