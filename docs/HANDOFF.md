# TextText handoff

## Current objective

Complete the [October 22 remaining-work plan](plans/remaining-work-2026-10-22.md) on `main`. T21–T27 of the older checklist are obsolete. The owner requests parallel agents, finite evidence-based checks, and no repeated testing after a clear result.

## Delivered and current blockers

- One human-invoked `release/ship-all.sh` delivered full commit `ec300bb388126631edb73a491faf80bad14fb776` to Oracle web, Mac 0.203 build 1279, and Windows, with exit code 0. Installed exact-content checks for this build are in progress after the catalog repair; do not infer acceptance from build success. The release log and exit marker are `/private/tmp/texttext-ship-all-ec300bb3.log` and `.exit` on the Mac.
- The human-invoked unified release delivered full commit `d7a06af43455e205a780615131f955168d034346` to Oracle web, Mac 0.203 build 1278, and Windows. Each installed/live surface passed one real exact-content edit, save, normal close, and reopen check. The Mac owner pin was restored. The installed Mac assistant staged a feed proposal for review without applying it. [Mac/web receipt](verification/2026-10-23-d7-mac-web-installed.md), [Windows receipt](verification/2026-10-23-windows-d7-installed-acceptance.md).
- The owner authorized removal of the three empty trailing-space Oracle folders, and their exact paths were removed with empty-directory-only checks. All 1,480 TextPack path/content hashes were unchanged; receipts and journals remain. [Repair receipt](verification/2026-10-23-empty-catalog-folders.md). Installed cross-client sync acceptance is in progress. Native catalog handling still needs a scoped warning and continued healthy-item sync so another malformed folder cannot pause the whole workspace.
- Phase 2 remains open. One uninstrumented launch of installed `d7a06af4` still showed the workspace placeholder at +8.53 s and the exact restored note at +15.45 s, over both 3 s targets; no timeout banner appeared. This decisive failure stopped a repeated timing loop. The one-call `files.list` correction is now shipped in `ec300bb3`; its installed latency is under one focused check. [Timing and durability receipt](verification/2026-10-23-windows-d7-installed-acceptance.md).
- Phase 3's 24-row installed light/dark matrix and Phase 4's four-entry-point template/feed checks remain open. Existing Mac/web Batch A navigation, list and search interaction passes need not be repeated; Windows and folder flows remain. The `d7a06af4` release includes reviewed server feed commands and Mac/Windows native stage-only adapters; real Mac staging passed, while native template/asset commands remain to be added. Cross-client multiplayer requires catalog repair. See the [plan](plans/remaining-work-2026-10-22.md).

## Preservation and next decisions

Use `main` in the existing PC and Mac checkouts; no worktrees. Mac `ssh mac` works on the LAN. Preserve the owner's uncommitted `mac/Package.resolved` SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`, retained release backups, native journals, and old conflicts. Read the plan's operational notes before each human-invoked release. The owner has authorized deletion with judgment; preserve content and use exact, evidence-backed scope. Phase 5 owner decisions and Phase 6 consolidation remain as stated in the plan.

[Archived history](archive/texttext-handoff-2026-10-22-before-unified-release.md).
