# TextText handoff

## Current objective

Complete the [October 22 remaining-work plan](plans/remaining-work-2026-10-22.md) on `main`. T21–T27 of the older checklist are obsolete. The owner requests parallel agents, finite evidence-based checks, and no repeated testing after a clear result.

## Delivered and current blockers

- One human-invoked `release/ship-all.sh` run exited 0 and delivered full commit `2410447543bd883cd23abd305ade14e183e6f5d7` to Oracle web, Mac 0.203 build 1276, and Windows. Each installed/live surface passed one real create/edit/save/normal-quit/reopen exact-content check. The Mac owner pin was restored. See the [plan](plans/remaining-work-2026-10-22.md) and the October 23 installed receipts under `verification/`.
- Phase 2 is open. A measured installed Windows launch showed listing at 4.457 s and restored exact note at 6.701 s, over the 3 s targets. The note survived normal quit and reopen without a timeout notice. Stop launch repetitions until a causal fix is ready. [Receipt](verification/2026-10-23-windows-241-installed-launch.md).
- Cross-client sync is currently blocked. A live web folder-view metadata GET created three trailing-space folder names in the remote catalog. Both native full passes reject this catalog before normal item reconciliation; a Windows installed-assembly validation of the actual 38-folder/217-item manifest isolated exactly these three names, and every item path passed. The Mac UI reports sync paused. No journal or folder has been reset, deleted, or filtered to hide this. The causal GET correction is committed and pushed as `9aeb8f79`, with [regression evidence](verification/2026-10-23-folder-view-read-only.md). Its live verification and a safe repair of the retained catalog remain open. The folder names are `Phase3 `, `Phase3 A `, and `Phase3 A 98b5314a `.
- Phase 3 batch A and Phase 4 feed parity are in progress. A feed command patch is prepared outside the checkout at PC `%TEMP%/texttext-feed-command-9f54c838667f4b08bb576d4f0bc382a4/feed-parity.patch`; it has focused durable retry, viewer refusal, audit and proposal checks but no real acceptance. The 24-row matrix still needs installed light/dark results, and multiplayer is blocked by the catalog issue. Batch A ends with one release after its fixes.

## Preservation and next decisions

Use `main` in the existing PC and Mac checkouts; no worktrees. Mac `ssh mac` works on the LAN. Preserve the owner's uncommitted `mac/Package.resolved` SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`, retained release backups, native journals, and old conflicts. Read the plan's operational notes before the next human-invoked release. Do not delete the three malformed server folders without the owner's approval; first inspect their exact contents and choose a repair that preserves identities and unrelated sync. Phase 5 owner decisions and Phase 6 consolidation remain as stated in the plan.

[Archived history](archive/texttext-handoff-2026-10-22-before-unified-release.md).
