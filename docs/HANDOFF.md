# TextText handoff

## Installed and live

- Mac: `/Applications/TextText.app` **0.204 (1177)**, source `346ddf0d`.
  Native Apple sign-in, three extensions, account and iCloud workspace preserved.
  Save, normal quit/reopen, search and real account Settings passed.
  [Receipt](verification/2026-10-07-mac-1177-account-settings.md).
- Oracle: **`texttext-oracle-20261008T002518Z-c5d625b7`**. Account Settings
  verified in actual Safari and Mac. Backup `texttext-20261008T002625Z-83906e54.dump`;
  authenticated read/write/audit smoke passed. Algorave remains active; HAProxy
  unchanged. Hosting/storage remain Oracle; no public desktop release.
  [Receipt](verification/2026-10-07-account-parity-and-build-gates.md).
- Windows: installed candidate **`37bde41a123d42b09de28a46dac547fb`**, source
  `346ddf0d`, at `C:\Users\Shokunin\AppData\Local\Programs\TextText`.
  Body search and restored content verified; real account Settings check pending.
- Active Mac workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  Preserve existing files. Only dedicated verification notes changed during tests.

## Next: finish Windows installation

Final candidate **`699cd68d717142d0bbcbae3efd8c0eb5`**, source `035f5fd7`, is
built and sealed on the PC at `C:\Users\Shokunin\dev\texttext-sync-20261007`.
It adds guarded same-workspace TextPack opening, single-instance forwarding,
Open-with registration without overriding defaults, and pinned clean npm setup.
117 native assertions, 176 shared tests, 28 actual UI checks, recovery and eight
close/activation checks passed. **Do not rebuild** unless relevant source changes.

Both existing SSH routes (`pc`, `pc-tunnel`) began resetting before commands
could execute. The final candidate is not installed. When access returns:
inspect installed receipt and unsaved UI, quit normally, use established installer,
then verify actual file activation, no duplicate app, account Settings, save/reopen.
[Windows receipt and candidate details](verification/2026-10-07-windows-desktop-live.md).

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

- Connecting additional sign-in providers is not exposed in the new shared
  Settings yet; current connected providers display correctly. Commercial ChatGPT
  website sign-in still requires OpenAI registration, which the owner lacks.
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
