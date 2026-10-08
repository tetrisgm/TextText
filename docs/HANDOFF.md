# TextText handoff

## Installed and live

- Mac `/Applications/TextText.app`: **0.204 (1182)**, source `b2ceb842`.
  Startup, note icon, search cache invalidation, save and normal reopen passed.
  [Receipt](verification/2026-10-07-mac-1182-restore.md).
- Windows: product source **5861988e**, candidate
  `fdd6221385d54e3794031c2a48f2b1d0`, installed in the existing location.
  Native Core 151 assertions, actual startup/search/reopen, passive deletion,
  restoration and subsequent file/web edits passed.
  [Receipt](verification/2026-10-07-windows-desktop-live.md).
- Oracle: **texttext-oracle-20261008T042939Z-233e53b3**. All twelve production
  HTTP smoke checks passed. Algorave services and shared proxy were preserved.
- Actual Mac deletion/restoration, same-ID Safari reading, direct CLI editing,
  web editing and passive Windows convergence passed without manual refresh.
  [Combined receipt](verification/2026-10-07-live-restore-1182.md).
- Mac folder:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Only dedicated verification notes changed during acceptance.

## Current work, not yet shipped

- `2ecab750`: shared UI client-directive regression protects native/web packaging.
- `0fad7bb7`: reusable note body snippets use existing Templates TextPacks;
  inline/full editing, save/insert/reopen and both themes verified. Embedded
  media snippets remain unsupported.
- `8ecfc126`, `60a51add`: platform shortcut labels with hydration tests.
- `d317a757`: cloud model catalog uses canonical file commands and guarded
  schemas. Eleven focused tests and combined TypeScript passed.
- `61b379d7`: canonical agent template listing/application, live custom definition
  delivery and durable native checkpoints. Passed 74 selected sync, 18 server and
  13 Mac shared-editing tests, TypeScript and lint.
- `816e9912`: cloud agent context uses authorized canonical files and hash-fenced
  selections; 71 focused checks passed.
- `48a3f378`: canonical approval previews, fresh hashes/grants and durable replay;
  88 tests passed, including a real TextPack absent from SQL.
- Frozen combined source `48a3f378` is running core/native gates in
  `/private/tmp/texttext-shared-XdMxA6`; log
  `/tmp/texttext-shared-48a3f378-sync.log`. No new install yet.
- Shared web assistant transport and usable workspace provider Settings are in
  progress. Read-only support is an increment, not full write/proposal parity.

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
