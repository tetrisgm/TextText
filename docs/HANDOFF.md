# TextText handoff

## Installed and live

- Mac: `/Applications/TextText.app` **0.204 (1180)**, source `160a74ba`.
  Account, iCloud workspace, native Apple sign-in and three extensions preserved.
  Startup, search, List/Cards persistence and normal close/reopen passed.
  Automatic reconnection through the Oracle deploy passed without Retry.
  [Receipt](verification/2026-10-07-mac-1180-home-views.md).
- Oracle: **`texttext-oracle-20261008T024706Z-160a74ba`**. Exact-source
  sync core (244 checks) and native gates passed. Authenticated session,
  origin enforcement, read/create/edit and audit smoke passed; scratch removed.
  Backup `texttext-20261008T024807Z-5fca6b5c.dump`; prior release retained.
  TextText and all three Algorave services active; HAProxy mtime unchanged.
  Logs: `/tmp/texttext-home-sync-core.log`, exact-source Node 22 native receipt
  from the Mac snapshot, `/tmp/texttext-home-deploy.log`. No public desktop release.
- Windows: source **`160a74ba`**, sealed candidate
  `2ceb30aa87be49b0a9a70919f50a6fcd`, installed in the existing location.
  Full build/native startup gates, account, List/Cards persistence, normal
  close/reopen and all nine sync markers passed; outbox empty. Live folder
  picker switch/back deferred while the owner was using the PC.
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

Current work: route authenticated owner legacy home entry into `/vault`, route
new template creation through the shared file UI, and add a shared-client
architecture regression gate. Existing export/inventory helpers are preparation
only and have never migrated production content. References: `a7bd430d`,
`f910d38f`, `8eda3d86`; real local-Postgres regression/fix `9ef750e0`.

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
