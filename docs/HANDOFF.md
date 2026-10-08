# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1184)**, source `98bb52b5`.
  Startup, note icon, search cache invalidation, save and normal reopen passed.
  [Receipt](verification/2026-10-07-recovery-templates-1184.md).
- Windows: product source **98bb52b5**, installed in the existing location.
  Build, actual startup/search freshness, Research v2 starter creation and
  save/reopen passed. [Receipt](verification/2026-10-07-windows-shared-1184.md).
- Oracle: **texttext-oracle-20261008T060605Z-98bb52b5**. All thirteen production
  HTTP smoke checks passed. Algorave services and shared proxy were preserved.
- Actual Mac deletion/restoration, same-ID Safari reading, direct CLI editing,
  web editing and passive Windows convergence passed without manual refresh.
  [Combined receipt](verification/2026-10-07-live-restore-1182.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work

- `98bb52b5` passed 500 core tests, TypeScript and native gates. Mac1184 is
  installed and Oracle deployed with 13 live smoke checks. Actual save/search,
  template version creation and retry, starter content, normal relaunch, direct
  file editing and Safari convergence passed.
  [Current receipt](verification/2026-10-07-recovery-templates-1184.md).
- Automatic recovery now bounds complete requests, preserves operation IDs,
  handles interrupted startup, and retries transient document bootstrap failures.
  Graceful server shutdown wakes read polls while preserving writes; the fresh
  compiled production probe exited cleanly in 6.043 seconds.
  [Shutdown evidence](verification/2026-10-07-read-poll-shutdown.md).
- Shared reader fastpath `428fa881` removes a measured plain-paragraph parser
  hotspot; component checks passed. Integrated route remeasurement awaits the
  next build. Status/presence-driven rendering is being checked separately.
  [Performance evidence](verification/2026-10-07-file-vault-bounded-performance.md).
- Web Add agent/bookmark entrypoints are fixed in `2be649c8` with browser
  targeting/no-auto-send checks. These changes are not installed/deployed yet.
- Agent create-from-template is in progress. Web approval currently rejects
  template create/update because durable tool registration and canonical parser
  defaults disagree; a separate fix and receipt-recovery tests are in progress.
- Standalone CLI `ccf675f8` remains installed; 106 tests passed. Real account
  commands and live template create/update/retry work while local reads remain
  offline. [CLI receipt](verification/2026-10-07-cli-account-commands.md).
- Shared provider Settings and attributed agent presence are implemented.
  No web provider is configured,
  so live model execution is not attested.

Keep one canonical file system and shared UI/editor/sync implementation across
Mac, Windows and web. Native adapters handle filesystem, credentials and OS
integration. Legacy data migration is explicitly out of scope; no deletion is
needed to stop using legacy content paths. Home List/Cards already shares items
and actions, with a personal per-device/workspace preference.

## Remaining scope and external limits

- [Agent command inventory](agent-file-backend.md).
- [Reference-template parity audit](design/template-reference-parity.md).
- Google client exists but its secret is unavailable; Oracle Google sign-in is
  not configured. Commercial ChatGPT sign-in requires OpenAI registration that
  the owner does not yet have.
- Account workspace discovery remains incomplete. Windows live folder-picker
  acceptance is deferred; isolated native checks passed.
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power loss are not live-certified.
- Required existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not
  found. Do not create a duplicate. Standalone CLI receipt:
  [current CLI](verification/2026-10-07-standalone-cli-current.md).

## Working conventions and evidence

- [Sync subsystem contract](../sync/README.md) and exact-source gates cover
  journals, external edits, epochs, recovery, acknowledgements and sessions.
  Reuse unaffected receipts; verify relevant changes.
- Preserve unrelated edits in `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, `scripts/.probe-editor.ts` and the
  existing Python cache. Coordinate concurrent edits before staging.
- Local client installs and needed Oracle deployments are authorized. Public
  desktop releases require an explicit request. No automated build/install jobs.
- [Archived implementation history](verification/2026-10-07-handoff-before-shared-templates.md).
