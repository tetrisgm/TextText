# TextText handoff

## Installed and live

- Mac: `/Applications/TextText.app` **0.204 (1179)**, source `3ff475d9`.
  Account, iCloud workspace, native Apple sign-in and three extensions preserved.
  Startup, search, gallery zoom/comments display and normal close/reopen passed.
  [Receipt](verification/2026-10-07-mac-1179-gallery-workspace.md).
- Oracle: **`texttext-oracle-20261008T023523Z-3ff475d9`**. Exact-source
  sync core (244 checks) and native gates passed. Authenticated session,
  origin enforcement, read/create/edit and audit smoke passed; scratch removed.
  Backup `texttext-20261008T023609Z-b45886d3.dump`; prior release retained.
  TextText and all three Algorave services active; HAProxy mtime unchanged.
  Logs: `/tmp/texttext-quiet-sync-core.log`, `/tmp/texttext-quiet-sync-native.log`,
  `/tmp/texttext-quiet-deploy.log`. No public desktop release.
- Windows: installed candidate **`c69bcd6c9a17491db56c038836e963a0`**, source
  `889bac73`, at `C:\Users\Shokunin\AppData\Local\Programs\TextText`.
  Account Settings, body search, actual single-instance file opening and normal
  close/reopen passed. Nine markers preserved, outbox empty; reader reopened in
  1.599 seconds. [Receipt](verification/2026-10-07-windows-desktop-live.md).
- Active Mac workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Preserve existing files. Only dedicated verification notes changed during tests.

## Current follow-up

Windows startup regression fixed in `033231ae`: WebView2 must enter the live
visual tree before initialization. The production startup/rollback gate now
covers it. Working candidate `c69bcd...` was restored and opened successfully.
Final candidate `b4ba548f662943ec9b70749f58f7442f` passed all gates; installation
and actual folder-picker switch/back await PC SSH recovery. Do not rebuild.
See [Windows receipt](verification/2026-10-07-windows-desktop-live.md).

Shared inactivity now pauses quietly; reconnect revalidates authority before
sending journaled edits (`3ff475d9`, 49 focused tests). This change is installed on Mac and live on Oracle. Windows final candidate
contains it but remains pending installation. Actual Safari interaction checks
for this final patch remain pending; prior account acceptance is recorded below.

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
