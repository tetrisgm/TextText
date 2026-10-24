# TextText handoff

## Current state

The October 23 human-invoked [unified release](verification/2026-10-23-unified-release-gate-order.md) installed `30f167dfbd56dce35a3225460ff2a0c2ff76989d` on Oracle web, Mac 0.203 build 1281, and Windows. The owner Mac's uncommitted `mac/Package.resolved` SHA256 remains `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. The later source-only release-order fix `6b5b7840` is pushed; it does not require another product release.

The two-ID `Notes/Untitled 31.textpack` collision is resolved in the installed Windows app by reviewed Keep both. Both original IDs, complete bytes, and original recovery evidence survived normal quit/reopen; the recovered local note is now at an identity-bound path. The live web edit reached the Windows reader after normal reopen and the Mac package with the exact server hash. [Windows receipt](verification/2026-10-23-windows-30f-path-recovery-installed.md), [web receipt](verification/2026-10-23-30f167df-web-convergence.md), [Mac receipt](verification/2026-10-23-30f167df-mac-acceptance.md). Close this collision/durability batch; do not repeat it as a blocker.

Live simultaneous editing remains unverified. One Mac-origin edit did not save, and the Mac reader accessibility tree was unavailable after reopen, so full Mac visual acceptance is inconclusive. The Phase 2 five-launch timing targets were not measured. The broad Phase 3 parity matrix and Phase 4 workflows are unfinished. These are distinct future product work, not reasons to rerun the successful release/recovery acceptance. See the [authoritative plan](plans/remaining-work-2026-10-22.md) for scope and exit checks; T21–T27 of the old checklist are obsolete.

## Next focused work

Choose one bounded product batch: first diagnose the Mac editor's unsaved input from real UI/runtime evidence, then add a focused regression, fix, and perform one installed edit/save/normal-quit/reopen check. Continue Phase 3/4 in coherent batches with one release each. A partially prepared template source guard is preserved in stash `Deferred Batch B template source guard after sync closure`; it is not shipped or accepted. Phase 5 owner decisions and Phase 6 consolidation remain later decisions. Do not turn the unmeasured Windows timing target into repeated launch loops without a concrete cause and measurement method.

Use `main` in the existing PC and Mac checkouts; no worktrees. Read the plan's operational notes before a release. Preserve the owner pin, retained backups, native journals and old conflicts. [Archived history](archive/texttext-handoff-2026-10-22-before-unified-release.md).
