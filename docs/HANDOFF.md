# TextText handoff

## Installed and live

- Mac: `/Applications/TextText.app` **0.204 (1181)**, source `116d3dde`.
  Account, iCloud folder and three extensions preserved. Startup, search cache
  invalidation, actual save and normal reopen passed. New tenth test marker
  reached Windows automatically exactly once.
  [Receipt](verification/2026-10-07-mac-1181-file-core.md).
- Oracle: **`texttext-oracle-20261008T034937Z-4a7ecb0`**, source `4a7ecb09`.
  Exact-source core passed 289 tests and native gates. All nine production smoke
  checks passed; actual Safari owner-home redirect, signed-in account, ten saved
  markers and both desktop participants verified.
  [Receipt](verification/2026-10-07-oracle-file-core.md).
- Windows: source **`116d3dde`**, sealed candidate
  `6c51e20e7df74552b663767a9390de38`, installed in the existing location.
  Native smoke, 189 shared tests, startup/search/reopen passed. Account preserved;
  ten markers exactly once, empty outbox. Receipts `222f68ec`, `bb569016`.
  [Receipt](verification/2026-10-07-windows-desktop-live.md).
- Active Mac workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Preserve existing files. Only dedicated verification notes changed during tests.

## Current follow-up

Home List/Cards (`160a74ba`) uses the same items/actions and a personal
per-device/workspace preference. Browser regression is in `npm test`; light,
dark and narrow checked. Actual Safari `/start?to=home` now opens the canonical
workspace, both layouts retain 16 items, and List survives reload. Screenshot:
`/tmp/texttext-home-list-safari.png`. No document mutations during acceptance.

The owner explicitly dropped old-data migration as a requirement. Do not spend
further work on a lossless SQL-to-TextPack migration. The target is one file
content system and the same UI/editor/sync implementation on Mac, Windows and
web, with narrow native filesystem, credential and OS integration adapters.
No deletion has been performed or is required to stop exposing the old paths.

Completed and deployed source changes:
- `14f0c275`: authenticated owner legacy home opens the shared file workspace;
  five focused route tests passed.
- `ac01d85e`, `f52d268c`: template links open the shared permission-gated picker;
  no GET-created SQL drafts. Unit tests, actual browser creation regression,
  session regression and TypeScript passed.
- `89a2bdc1`: all three client entry points and native packaging share one UI;
  six architecture checks participate in core/Windows gates.
- `86acd6bb`: empty directories appear in server/web manifests, scoped grants
  filter folder names, and folder changes invalidate listing revisions.
  67 relevant tests, TypeScript and scoped ESLint passed.

- `30e3b3dc`: fresh accounts provision file presets with immutable setup intent
  and completion records. Real local-Postgres interrupted/concurrent setup test
  passed without SQL posts/folders; edited/moved/deleted starter retries pass.
  Grant-compatible deterministic UUIDs are verified in `90c78429`.
- `cf7e9682`: Mac/Windows receive empty folders additively; omission never
  deletes. A folder collision does not block unrelated document sync. Mac 23
  sync tests and Windows Core passed. Template browser regression runs in npm test.

- `0d382a02`: Mac folder selection no longer creates an independent starter
  set before server sync. Real controller test leaves an empty offline folder
  empty; explicit template creation remains available.
- `f57677a9`: file command engine uses the existing durable intent/receipt
  transaction; lost-response append retry returns exactly once. 28 focused
  tests and TypeScript passed. Public dispatch is now file-only (`88c5a359`).

- `a1a818f3`: hosted agent presence has independent command sessions,
  reauthorized heartbeats and crash expiry; six tests passed.
- `c4878255`, `1edeae85`: resource guidance and CLI discovery use the file
  contract; CLI cannot stage SQL proposals. Resource tests, 36 CLI/auth tests
  and scoped lint passed.

Native command compatibility and the outdated SQL deployment smoke are fixed
(`90253663`, `4a7ecb09`). The gate now decodes responses using the actual Swift
contract and checks canonical file persistence, audit and durable retry. The
initial failed deployment rolled back correctly; the corrected deployment passed.

Next: extend the canonical agent backend beyond its current eleven tools,
starting with audited item move/trash operations. Keep shared UI and sync gates
mandatory; full capability and reference-template parity remain unfinished.

File-only dispatch (`88c5a359`), capture/Markdown (`2ce56ca3`), durable comments
(`f4352d53`, `1ccb5163`) and expanded sync gate (`48ac492a`) are committed.
Frozen-source core passed 286 tests; native gate passed. MCP suite passed 153.
Remaining agent capabilities are in [the backend inventory](agent-file-backend.md).
The prior export/inventory helpers never migrated production content.

Windows startup regression `033231ae` is fixed in the installed candidate:
WebView2 enters the live visual tree before initialization. Actual installed
startup is verified, not pending PC connectivity.

Shared inactivity now pauses quietly; reconnect revalidates authority before
sending journaled edits (`3ff475d9`, 49 focused tests). This change is installed
on Mac and live on Oracle. Windows installed candidate contains it as well. Actual Safari opened the dedicated note on this
deployment, showed the signed-in account and Mac presence, and retained all
nine markers after switching away
and back without a false Offline/Retry banner. No content was edited.

## Changes and durable checks

- Shared account menu/Settings uses authenticated account profile on all clients.
  Logout is only in the menu; web logout waits for successful editor persistence.
- Windows folder search and offline feed history use the local TextPacks (`9754af15`).
- Sync gate symlink entry bypass fixed with regression (`ba132012`). Mac `/tmp`
  resolves to `/private/tmp`; old candidates were explicitly tested by physical path.
- Windows build runs pinned npm 11.10.0 `ci --ignore-scripts` before tests (`035f5fd7`).
- Production dependency audit is clear after sharp 0.35.5/source-map-js 1.2.2.
  Five dev-only ESLint dependency advisories remain; available audit suggestion
  would downgrade the framework's ESLint config and was not applied.
- [Sync subsystem contract](../sync/README.md) and exact-source gates protect
  journal compatibility, external edits, epochs, recovery, ACKs and session lifecycle.
  [Previous acceptance and references](verification/2026-10-07-handoff-before-account-parity.md).

## Remaining scope and limits

- Settings now exposes account-bound sign-in management. Google is not configured
  on Oracle; commercial ChatGPT sign-in requires OpenAI registration, which the
  owner lacks. No real additional provider was linked during verification.
- Current-workspace folder relocation and portable identity are implemented on
  Windows; final installed picker verification is pending as above. Selecting a
  different cloud workspace still needs an account workspace-discovery flow.
- Per-image gallery anchors and zoom/pan are implemented with integrated browser
  regression coverage in default tests. Full reference-service visual parity
  remains unproven; see [audit](design/template-reference-parity.md).
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power-loss behavior are not live-certified.
- Existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not found;
  no duplicate was created. Standalone CLI updated to source `d52a9eef`;
  [receipt](verification/2026-10-07-standalone-cli-current.md).
- Preserve unrelated worker edits: `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, `scripts/.probe-editor.ts`.
- Local installs and needed Oracle deployments are authorized; public desktop
  releases still require an explicit request. No background build/install jobs.
