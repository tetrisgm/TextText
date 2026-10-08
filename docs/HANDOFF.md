# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1183)**, source `04c265c7`.
  Startup, note icon, search cache invalidation, save and normal reopen passed.
  [Receipt](verification/2026-10-07-shared-clients-1183.md).
- Windows: product source **04c265c7**, installed in the existing location.
  Build, actual startup/search, snippet save/insert/reopen and passive Mac edit
  delivery passed. [Receipt](verification/2026-10-07-windows-shared-1183.md).
- Oracle: **texttext-oracle-20261008T053344Z-25e439c0**. All twelve production
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
- `25e439c0` is deployed with the Yjs repair. Expanded folder smoke exposed the
  native allowlist rejecting create_folder; `ef18a85f` fixes it with real route
  regression. Failed smoke scratch cleanup was verified (zero scratch blogs).
- `e758c989` implements agent template creation/save-look as validated TextPacks.
  Frozen `ccf675f8` passed 475 core tests, TypeScript and native gates. Its Oracle
  deployment is running: `/tmp/texttext-oracle-ccf675f8.log`; verify completion
  and expanded live smoke before claiming these commands shipped.
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
