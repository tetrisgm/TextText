# TextText handoff

## Current objective

Complete the [October 22 remaining-work plan](plans/remaining-work-2026-10-22.md) on `main`. T21–T27 of the older checklist are obsolete. The owner requests parallel agents, finite evidence-based checks, and no repeated testing after a clear result.

## Delivered and current blockers

- The human-invoked unified release delivered full commit `d7a06af43455e205a780615131f955168d034346` to Oracle web, Mac 0.203 build 1278, and Windows. Each installed/live surface passed one real exact-content edit, save, normal close, and reopen check. The Mac owner pin was restored. The installed Mac assistant staged a feed proposal for review without applying it. [Mac/web receipt](verification/2026-10-23-d7-mac-web-installed.md), [Windows receipt](verification/2026-10-23-windows-d7-installed-acceptance.md).
- Cross-client sync is still blocked by three empty trailing-space folders, `Phase3 `, `Phase3 A `, and `Phase3 A 98b5314a `, in the remote catalog. Both native clients reject the catalog before reconciliation; the Mac UI reports sync paused. The web folder-view GET that created them was fixed in `9aeb8f79` and verified on the live site in the Mac/web receipt. Exact-path preflight found the three directories empty, without descendants, JSON references, or audit records. Their removal awaits the owner's explicit approval. No journal, guard, or folder has been reset or hidden. [Catalog evidence](verification/2026-10-23-windows-catalog-sync-block.md).
- Phase 2 remains open. One uninstrumented launch of installed `d7a06af4` still showed the workspace placeholder at +8.53 s and the exact restored note at +15.45 s, over both 3 s targets; no timeout banner appeared. This is a clear failure, so no five-launch timing loop ran. The retained-registry read cache shipped but was insufficient. A focused transport harness found two `files.list` calls per listing, with the second re-reading folders already in the first manifest; a one-call correction and regression are in progress. [Timing and durability receipt](verification/2026-10-23-windows-d7-installed-acceptance.md).
- Phase 3's 24-row installed light/dark matrix and Phase 4's four-entry-point template/feed checks remain open. Existing Mac/web Batch A navigation, list and search interaction passes need not be repeated; Windows and folder flows remain. The `d7a06af4` release includes reviewed server feed commands and Mac/Windows native stage-only adapters; real Mac staging passed, while native template/asset commands remain to be added. Cross-client multiplayer requires catalog repair. See the [plan](plans/remaining-work-2026-10-22.md).

## Preservation and next decisions

Use `main` in the existing PC and Mac checkouts; no worktrees. Mac `ssh mac` works on the LAN. Preserve the owner's uncommitted `mac/Package.resolved` SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`, retained release backups, native journals, and old conflicts. Read the plan's operational notes before each human-invoked release. Do not delete the three malformed server folders without the owner's approval; the exact-path preflight and nonrecursive empty-directory-only repair are prepared but unexecuted. Phase 5 owner decisions and Phase 6 consolidation remain as stated in the plan.

[Archived history](archive/texttext-handoff-2026-10-22-before-unified-release.md).
