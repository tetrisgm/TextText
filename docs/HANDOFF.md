# TextText handoff

## Current objective

Complete the [October 22 remaining-work plan](plans/remaining-work-2026-10-22.md) on `main`. T21–T27 of the older checklist are obsolete. The owner requests parallel agents, finite evidence-based checks, and no repeated testing after a clear result.

## Delivered and current blockers

- The human-invoked unified release on `044e544160862b625eea02afd649f4917325f51c` exited 0 and installed that exact commit on Oracle web, Mac 0.203 build 1280, and Windows. Installed Mac and Windows plus authenticated live web each passed exact-content edit, save, normal close, and reopen. [Mac receipt](verification/2026-10-23-044e5441-mac-acceptance.md), [Windows receipt](verification/2026-10-23-windows-044-installed-acceptance.md). Phase 1 is complete. The five-launch Phase 2 timing target remains unverified; one Windows launch had only a 7.8 s upper bound, not a measured pass or fail.
- Real cross-client sync exposed a distinct two-ID path collision: the installed Windows note and the Mac/web note both claim `Notes/Untitled 31.textpack`. Windows retained both bytes and conflict evidence, but cannot project the shared note at that path. The immediate work is a reviewed, durable keep-both recovery in Windows Core/UI and identity-bound names for new notes on all clients. Do not rename files manually or reset journals. Installed multiplayer acceptance follows the next unified release.
- Identity-bound names for new web/Windows and native Mac items are committed as `841fcf5f` and `cbf8ea18`; a focused actual two-replica Mac regression and web/Windows transport tests pass. Reviewed Windows recovery is committed as UI/bridge `82eec23b` and Core `7fd56a20`. Browser, transport, type, WPF and full PC Core (1,863 assertions) checks pass; Mac focused Core passes 24. [UI receipt](verification/2026-10-23-windows-path-collision-recovery-ui.md), [Core receipt](verification/2026-10-23-windows-path-collision-recovery.md). The next step is one same-commit release, then real installed keep-both and multiplayer acceptance.

- Batch A web has a bounded real light/dark and exact-content receipt; broader 24-row parity is not claimed. [Current matrix](verification/application-parity-matrix.md), [web receipt](verification/2026-10-23-044e5441-web-batch-a.md). Phase 4 template version/retire source guard is prepared separately and deliberately held out of the collision release. Phase 5 retained items and the later Phase 6 architecture decision remain in the plan.

## Preservation and next decisions

Use `main` in the existing PC and Mac checkouts; no worktrees. Mac `ssh mac` works on the LAN. Preserve the owner's uncommitted `mac/Package.resolved` SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`, retained release backups, native journals, and old conflicts. Read the plan's operational notes before each human-invoked release. The owner has authorized deletion with judgment; preserve content and use exact, evidence-backed scope. Phase 5 owner decisions and Phase 6 consolidation remain as stated in the plan.

[Archived history](archive/texttext-handoff-2026-10-22-before-unified-release.md).
