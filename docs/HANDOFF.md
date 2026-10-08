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

Completed source changes, not yet deployed:
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
  tests and TypeScript passed. Hosted dispatch/catalog wiring is in progress.

- `a1a818f3`: hosted agent presence has independent command sessions,
  reauthorized heartbeats and crash expiry; six tests passed.
- `c4878255`, `1edeae85`: resource guidance and CLI discovery use the file
  contract; CLI cannot stage SQL proposals. Resource tests, 36 CLI/auth tests
  and scoped lint passed.

Current work: finish unconditional hosted file dispatch and source-bound gates.
The file agent catalog currently exposes eight commands (workspace/folders,
list/read/search, create/update/append). The other tools in the old registry
remain feature-parity work, not completed features: sharing/comments, file and
folder operations, templates, assets, reading and change history. Do not call
the reduced catalog full agent parity. Capture/full-Markdown creation support
is being restored on the file path. Next are exact-source gates, builds and deployment. The broader suite passed 4,413
checks with 149 skips; its only two failures were then-in-progress mutation
mocks, subsequently replaced and passing in the focused run above. `a04be655`
wires the canonical adapter; unconditional dispatch is under final test.
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
