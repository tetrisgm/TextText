# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1184)**, source `98bb52b5`.
  Startup, note icon, search cache invalidation, save and normal reopen passed.
  [Receipt](verification/2026-10-07-recovery-templates-1184.md).
- Windows: product source **04c265c7**, installed in the existing location.
  Build, actual startup/search, snippet save/insert/reopen and passive Mac edit
  delivery passed. [Receipt](verification/2026-10-07-windows-shared-1183.md).
- Oracle: **texttext-oracle-20261008T060605Z-98bb52b5**. All thirteen production
  HTTP smoke checks passed. Algorave services and shared proxy were preserved.
- Actual Mac deletion/restoration, same-ID Safari reading, direct CLI editing,
  web editing and passive Windows convergence passed without manual refresh.
  [Combined receipt](verification/2026-10-07-live-restore-1182.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work

- Product source `04c265c7` passed 457 mandatory core tests, TypeScript and native
  gates. Mac 0.204 (1183) is installed: startup, template controls, save,
  search invalidation and normal reopen passed.
  [Current receipt](verification/2026-10-07-shared-clients-1183.md).
- Canonical templates, cloud file context, approval crash recovery, shared web
  assistant proposals/provider settings and attributed whole-turn agent presence
  are implemented. Regression coverage is wired into the mandatory gates.
- Windows candidate from the same source passed 195 shared-client tests, native
  checks and actual desktop smoke. Installed snippet/persistence acceptance also passed.
- Oracle deployment passed all 12 production HTTP checks. Actual Safari account,
  provider Settings and passive Mac-edit delivery passed. No provider is
  configured, so live model execution is not attested.
- Duplicate-Yjs packaging root cause is fixed and deployed. Live alias and
  constructor identity passed; startup warning is absent.
- Native folder-route correction is deployed and expanded live smoke passed,
  including empty folder creation, durable retry and audit uniqueness.
- `ccf675f8` is deployed: 475 core tests, TypeScript, native gates and 13 live
  checks passed. CLI template creation and identical retry passed; Research note
  synced into the Mac template picker. Creating an item from it omitted starter
  text despite stored starter/example body. `1f4ab68e` fixes explicit starter
  creation; actual browser create/edit/reopen and focused tests passed. Awaiting
  client installation and live acceptance.
- `2d258ef7` bounds stalled collaboration requests and repairs interrupted
  startup recovery; 53 client tests passed, including same-operation write retry.
  Awaiting combined gates, client installation and Oracle deployment.
- `96982b41` fixes graceful read draining. Actual production transport exited
  cleanly in 6.047 seconds versus 30.025 seconds before the fix.
  [Shutdown evidence](verification/2026-10-07-read-poll-shutdown.md).
- Final candidate `98bb52b5` includes document bootstrap recovery and full
  manifest-body deadlines. All 500 core tests, TypeScript and native gates
  passed in the clean frozen clone. Mac1184 is installed and Oracle is deployed.
  Live CLI template update/retry, unchanged old pinned item, new starter creation,
  save/relaunch, direct file edit and Safari convergence passed. Windows build
  exited successfully but SSH now resets; installation is waiting for connectivity.
  [Current receipt](verification/2026-10-07-recovery-templates-1184.md).
  Logs: `/tmp/texttext-sync-98bb52b5.log`,
  `/tmp/texttext-oracle-98bb52b5-build.log`.
- `30726329` offers the latest version of each template for creation while
  retaining older pinned definitions. Focused and browser checks passed.
- `b54dd129` adds immutable template-version updates; 31 focused checks passed,
  not yet deployed. Preserve old pinned documents during updates.
- Standalone CLI `ccf675f8` is installed; 106 tests passed. Real commands and
  get_workspace now work while local file reads remain unchanged.
  [Receipt](verification/2026-10-07-cli-account-commands.md).

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
