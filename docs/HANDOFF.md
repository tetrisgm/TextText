# TextText handoff

## Installed and live

- Mac: `/Applications/TextText.app` **0.204 (1178)**, source `889bac73`.
  Native Apple sign-in, three extensions, account and iCloud workspace preserved.
  Save, normal quit/reopen, search and real account Settings passed.
  [Receipt](verification/2026-10-07-mac-1178-provider-management.md).
- Oracle: **`texttext-oracle-20261008T020052Z-889bac73`**. Account Settings
  verified in actual Safari and Mac. Backup `texttext-20261008T020156Z-3323c000.dump`;
  authenticated read/write/audit smoke passed. Algorave remains active; HAProxy
  unchanged. Hosting/storage remain Oracle; no public desktop release.
  [Receipt](verification/2026-10-07-reconnect-account-management.md).
- Windows: installed candidate **`c69bcd6c9a17491db56c038836e963a0`**, source
  `889bac73`, at `C:\Users\Shokunin\AppData\Local\Programs\TextText`.
  Account Settings, body search, actual single-instance file opening and normal
  close/reopen passed. Nine markers preserved, outbox empty; reader reopened in
  1.599 seconds. [Receipt](verification/2026-10-07-windows-desktop-live.md).
- Active Mac workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Preserve existing files. Only dedicated verification notes changed during tests.

## Current follow-up

Account-management rollout passed on installed Mac/Windows, Oracle and actual Safari; see [reconnect/account receipt](verification/2026-10-07-reconnect-account-management.md).

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
- Windows arbitrary-workspace file opening, per-image gallery comment anchors,
  and full reference-service visual parity remain beyond this completed batch.
- Second physical Apple-device iCloud delivery, Windows provider eviction and
  hardware power-loss behavior are not live-certified.
- Existing `Shoku's Space/My Notes/TextText Changelog.textpack` was not found;
  no duplicate was created. Standalone CLI remains older build1158.
- Preserve unrelated worker edits: `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, `scripts/.probe-editor.ts`.
- Local installs and needed Oracle deployments are authorized; public desktop
  releases still require an explicit request. No background build/install jobs.
