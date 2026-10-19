# TextText content-first checkpoint

## Current recovery work, October 19

Continue the existing [27-task completion plan](plans/shared-app-finish-checklist.md); [HANDOFF](HANDOFF.md) is authoritative for current installed identities and external dependencies. The shipped-state and acceptance sections below describe an earlier design baseline, not the current candidate. Main source now includes strict saved-move records, older-reader fencing, shared rename eligibility and shared tombstone decisions. Native immutable replay integration is active in parallel; these newer sources are not installed.

Shared recovery UI is committed in `87fe53b8`: strict inspection, scoped consent, stale-callback isolation and terminal-only stopping. Fourteen unit tests, real React Chromium checks, TypeScript and inspected light/dark screenshots pass; see [UI evidence](verification/2026-10-19-saved-file-move-recovery-ui.md). Native bridge hooks are prepared but await actor and bridge checks. Queued-upload policy/wrappers are committed in `9f13d6ac`; [source proof](verification/2026-10-19-queued-upload-path-policy.md) distinguishes the observed native discrepancy from the pending adapter fix. Next: finish native replay/recovery and queued-upload adapters, run broader native checks, then prepare a coherent installed candidate. Do not imply an unavailable native account review, Apple callback, or changelog connection has completed.

Native integration remains uncommitted while broader gates run. Frozen Mac replay/recovery checks passed22 cases plus58 shared-editing tests (two existing helper skips) and one actual WK bridge fixture. Additional path-only revision and later-peer-name regressions are now being checked before the broader Swift lane. Windows focused replay/recovery checks passed54 assertions; full actual-PC Core checks exposed interactions with retained checkpoints and snapshot serialization, now under a fresh source gate. Actual-PC app compilation and bridge runtime passed the earlier snapshots. Actual WebView2 now passes120 vectors in each visible, hidden and production-factory phase, plus58 forged/reload refusals: [evidence](verification/2026-10-19-webview2-policy-lanes.md), committed `5412ef41`. Attachment-only ACKs and stopped-name binary continuation are being corrected before final native gates; these must not acknowledge unseen text or skip unrelated peer assets. No candidate install or deployment has occurred.

Preserve owner changes to Package.resolved, assistant attachments, tabs tests, Python cache and the editor probe. Root owns shared recovery UI/bridge work; adapter workers own native Sync files. No UI-owned process is running. Current source evidence and actual physical gates are linked from HANDOFF and verification receipts.

## Settled product

TextText works from ordinary folders of self-contained TextPacks. A person can edit, rename, and move those files directly. The Mac app, web workspace, Finder projection, and agent tools use the same validated document primitives. The [file-vault architecture](design/texttext-file-vault-migration.md) governs storage, collaboration, recovery, and conflicts.

Article, Bookmark, Brief, Case study, Gallery, Note, Page, Project, Talk, Timeline, and To-do are editable starter TextPacks. Reading list, Contact sheet, and Reference index are folder presets over the same primitives. Templates can be created or changed by an agent without adding another content model or executable presentation code.

## Historical shipped state

- Public version 0.203 build 1150 shipped from `eef38b7e` and is recorded by `e3f75ce7`. It remains the notarized Sparkle artifact.
- Clean `main` at `012d78bc` was promoted to Oracle as `tt-1151-012d78bc-6abe91a4`. `/Applications/TextText.app` is the single installed copy at 0.203 build 1151. It is Developer ID signed, arm64, and contains three extensions and `Contents/Helpers/texttext`.
- `texttext.app`, media, PostgreSQL, retained backups, and Mac update files run from Oracle. No TextText storage uses Cloudflare R2 or Vercel Blob.
- The product changelog has one newest `0.203` section and passes TextPack lint.

## Acceptance evidence

### Folders, templates, and agents

- The offline folder browser suite covers creation, templates, capture, image paste, reading, search, recovery, keyboard use, narrow layout, light and dark themes, and reduced motion.
- Local file editing and external atomic edits pass through the real native window. Agent commands address the same paths, use hash guards for writes, attribute mutations, and keep edits visible in the document.
- Starter template assets are bundled in the signed app and validated as TextPacks. Folder presets and agent-authored template proposals have focused coverage.

### Collaboration and sync

- Two-account acceptance covers presence, persisted comments and replies, concurrent convergence, writer-scoped undo and redo, offline recovery, three-editor reload convergence, folder and note discovery, and permission downgrade enforcement.
- A settled editor sends one presence heartbeat and no repeated content mutation uploads. Content sync resumes after a real change or reconnects after an outage without a Retry action.
- Hash and epoch guards reject stale destructive writes while preserving the other writer's bytes.

### Release and hosting

- The exact release gate passed web, database, live workflow, sync, collaboration, native, TestFlight, Apple, TypeScript, and production build checks.
- Production authenticated smoke tests created, read, edited, audited, and removed a scratch note after migration.
- Public 0.203 appcast and ZIP match Oracle byte for byte. Stable and immutable download routes, byte ranges, the version endpoint, and sign-in page pass.
- TextText and Algorave services are active with zero restarts. Both backup timers are active and their newest dumps have readable tables of contents.

### Performance

The historical 240-pack run measured cached item open at 590.9 ms p95. `7f59e8fd` reduced the bounded six-sample comparison to 339.6 ms p95, a 42.5% improvement. A later full production run measured input visibility at 17.9 ms p95. Cached open still misses the original 100 ms target, and the bounded memory samples do not prove leak absence. See the [performance receipt](file-vault-performance-2026-09-30.md).

## Remaining refinement

- Continue profiling cached item open only if the 100 ms target remains a product requirement.
- Oracle-local backups do not survive loss of the Oracle VM or its block storage. That is the explicit Oracle-only durability boundary.
- Interactive production OAuth was not re-entered during the automated release. The public sign-in page is live, native Apple sign-in passed its release checks, and the prior installed flow was accepted manually.

## References

- [Handoff](HANDOFF.md)
- [Implementation receipt](file-vault-implementation-2026-09-30.md)
- [Collaboration receipt](file-vault-collaboration-2026-09-30.md)
- [Recovery receipt](file-vault-recovery-2026-09-30.md)
- [AI sidebar architecture](ai-sidebar-architecture.md)
