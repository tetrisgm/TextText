# TextText handoff

## Current objective

Complete the [October 22 remaining-work plan](plans/remaining-work-2026-10-22.md) on `main`. T21–T27 of the older checklist are obsolete. The owner requests parallel agents, finite evidence-based checks, and no repeated testing after a clear result.

## Delivered and current blockers

- The human-invoked unified release delivered full commit `a868426a6f87819a4673616bb41458e9350cf732` to Oracle web, Mac 0.203 build 1277, and Windows. Each installed/live surface passed one real exact-content edit, save, normal close, and reopen check. The Mac owner pin was restored. [Mac/web receipt](verification/2026-10-23-a868-mac-web-installed.md), [Windows receipt](verification/2026-10-23-windows-a868-installed-acceptance.md).
- Cross-client sync is still blocked by three empty trailing-space folders, `Phase3 `, `Phase3 A `, and `Phase3 A 98b5314a `, in the remote catalog. Both native clients reject the catalog before reconciliation; the Mac UI reports sync paused. The web folder-view GET that created them was fixed in `9aeb8f79` and verified on the live site in the Mac/web receipt. Exact-path preflight found the three directories empty, without descendants, JSON references, or audit records. Their removal awaits the owner's explicit approval. No journal, guard, or folder has been reset or hidden. [Catalog evidence](verification/2026-10-23-windows-catalog-sync-block.md).
- Phase 2 remains open. Installed Windows listing took 4.457 s and restored-note editability 6.701 s, over the 3 s targets; one later sampled startup isolated duplicate retained-registry reads before navigation and again for first listing. Sampling perturbed timing and is not acceptance. A focused Windows read-count correction is in progress; do not repeat installed launch timing until it ships. [Timing receipt](verification/2026-10-23-windows-241-installed-launch.md).
- Phase 3's 24-row installed light/dark matrix and Phase 4's four-entry-point template/feed checks remain open. Batch A navigation checks and the live folder-read correction are recorded, but multiplayer requires catalog repair. Reviewed server feed proposal commands are committed as `20baf011` ([receipt](verification/2026-10-23-feed-command-proposals.md)); native adapters and installed acceptance remain open. See the [plan](plans/remaining-work-2026-10-22.md).

## Preservation and next decisions

Use `main` in the existing PC and Mac checkouts; no worktrees. Mac `ssh mac` works on the LAN. Preserve the owner's uncommitted `mac/Package.resolved` SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`, retained release backups, native journals, and old conflicts. Read the plan's operational notes before each human-invoked release. Do not delete the three malformed server folders without the owner's approval; the exact-path preflight and nonrecursive empty-directory-only repair are prepared but unexecuted. Phase 5 owner decisions and Phase 6 consolidation remain as stated in the plan.

[Archived history](archive/texttext-handoff-2026-10-22-before-unified-release.md).
