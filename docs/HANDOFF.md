# TextText handoff

## Current objective

Execute [the October 22 remaining-work plan](plans/remaining-work-2026-10-22.md).
T21–T27 of the older checklist are obsolete. Do not run or prepare them.
The owner requests maximum parallel agent work; root owns commits and release,
with one heavy Mac build lane and independent Windows investigation.

## Active work

- Phase 1 entry: `bash release/ship-all.sh` on the Mac. Pushed commits
  `34fd9081` (sync producer/local database), `62a68a49` (checkout/storage
  preflights), `b05a675e` (combined release).
  [Sync checks](verification/2026-10-22-release-sync-entry.md),
  [preflights](verification/2026-10-22-release-preflights.md),
  [entry checks](verification/2026-10-22-ship-all-entry.md).
- First combined invocation log: Mac `/private/tmp/texttext-ship-all-b05a675e.log`.
  Full release and sync gates passed for `b05a675e`. After the held run's child
  finished, pulling release fixes deliberately invalidated its source receipt.
  The coordinator exited before delivery, restored the exact owner pin and
  cleared its lock. Its `delivery.json` records an empty delivered list.
  [First-run receipt](verification/2026-10-22-unified-release-first-gate.md).
- Installer review found an existing TERM fallback after refused normal quit and
  rollback that could move a running app. Focused corrected installer tests pass
  on the Mac; pushed as `b0463854`. Windows interactive-session normal quit is
  `ec9215a9`; Oracle backup/unit preservation is `2e43cdd8` and `090ea78d`.
  Mac artifact preservation is `4fb09aae`. The fresh unified invocation remains
  pending.
- Windows installed startup reproduced the timeout/blank workspace. Stack samples
  distinguish synchronous `SyncEngine.Load` path validation on the UI dispatcher
  from initial listing inventory work holding the store. Root captured the actual
  UI; narrow optimizations and causal regressions pass on PC and Mac, preserved
  in PC stash `bac70feec271069be85f81b980f8e107378f9e94` pending Phase 1 delivery.
  [Evidence](verification/2026-10-22-windows-startup-native-reads.md).
  Phase 2 measured targets and installed acceptance are not complete.
- Batch A review found `Notes/` assumptions in backlinks/link picker and silent
  backlink read failures. Production-component regressions are being prepared;
  installed reproduction remains required. Live CLI discovery confirms no feed
  commands/proposals; assets and template retirement have reviewed proposal paths.

## Last verified delivered identities

| Surface | Identity and evidence |
| --- | --- |
| Mac | `56d144f7`, 0.204 (1274), canonical `/Applications/TextText.app`; [installed acceptance](verification/2026-10-19-mac-1274-installed-acceptance.md) |
| Windows | `ca7c5540` content, candidate `0c0c29a8…`; [normal save/reopen evidence and remaining startup failure](verification/2026-10-22-windows-first-session-close-blocked-profile.md) |
| Web | `aa8f8a1b`, deployment `texttext-oracle-20261023T023701Z-aa8f8a1b`; [13 authenticated smoke checks](verification/2026-10-22-web-aa8f8a1b-delivered.md) |
| CLI | signed `56d144f7`; [installation evidence](verification/2026-10-19-mac-1274-installed-acceptance.md) |

## Preservation and operational references

Mac LAN `ssh mac` works. Use main in the existing PC/Mac checkouts, no worktrees.
Preserve owner's `mac/Package.resolved` SHA256
`eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`,
`mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. The last file targets
localhost and deletes fixtures; it is not installed acceptance. The release entry
keeps standalone Sparkle pins in git and restores the owner's working pin.

The first release run preserved owner pins under Mac
`.texttext/ship-all/20261023055157155-b05a675e/owner-Package.resolved`.
The run's finally path restored the owner pin with the exact SHA256 above.
Do not discard its backup or clear release locks blindly.

[Oracle operations](../release/oracle/README.md),
[database operations](DATABASE-OPERATIONS.md), and the plan's operational notes
cover current builds/deploys. No public Mac update is requested. Fresh stopped
backups and actual open/edit/save/normal-quit/exact-reopen remain release exit checks.

Held owner decisions remain in plan Phase 5: retained conflict/rename items
`5749b5ac` and `926668f8`, scheduled PC reboot, and exact-path cleanup approval.
No filesystem recovery workarounds or deletions are authorized.

[Archived handoff and historical receipts](archive/texttext-handoff-2026-10-22-before-unified-release.md).
