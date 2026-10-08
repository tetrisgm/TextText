# Account and proposal cohort 1191

Frozen source `f3167c4b`, built from clean clone
`/private/tmp/texttext-shared-XdMxA6`. Required gate passed 725 core tests,
TypeScript and native suites, including 40 CLI creation/remote tests.
Log: `/tmp/texttext-sync-f3167c4b.log`.

Mac `/Applications/TextText.app` is 0.204 (1191). Signed arm64 app and three
extensions verified. The normal quit preceded installation; established local
Store sandbox installation exception leaves the runtime report unverified.
Actual UI startup separately showed the same iCloud workspace, account identity
and pinned custom-template item. Logs: `/tmp/texttext-mac1191-build.log` and
`/tmp/texttext-mac1191-install.log`.

Command K found the existing dedicated 1185 note by title. Appended only
`Account and proposal verification 1191.` and saved. The real TextPack Markdown
contains that marker and all three prior 1189/1190 markers exactly once. Normal
quit/relaunch preserved headings and markers. Initial launch observation timed
out; the next inspection showed the full editor, so this is not a launch-speed
measurement. Search for the new body marker found the correct note, verifying
cache freshness after save. Unaffected measured performance receipts remain valid.

Windows same-source build/install and account/search acceptance:
[receipt](2026-10-08-windows-shared-1191.md).

Oracle serves `texttext-oracle-20261008T090012Z-f3167c4b`. All 13 live deployment
checks passed, including mutations/retries, canonical audit, restore and stale
upload fencing. Previous release retained. Fresh backup:
`texttext-20261008T090233Z-b74fd340.dump` (176744 bytes). TextText and Algorave
remain active. Log: `/tmp/texttext-oracle-f3167c4b-deploy.log`.

Already-open Safari received the new Mac marker automatically before navigation
or reload, with both desktop clients shown in presence. Live proposal/custom-field
acceptance is still pending. No public desktop release was performed.
