# TextText handoff

## Installed and live

- Mac: `/Applications/TextText.app`, local Store-shaped **0.204 (1176)**,
  including the saved-file close guard. Existing account, native
  Apple sign-in entitlement, three signed extensions and iCloud workspace are
  preserved. Workspace:
  `/Users/shokunin/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace`.
  No public desktop release was published.
- Oracle: **`texttext-oracle-20261007T223538Z-4712e8d9`**. Authenticated session,
  cookie-origin enforcement, read/write, canonical storage and audit smoke passed.
  Backup: `texttext-20261007T223642Z-a2a9efd0.dump`. Previous release retained;
  Algorave services active, HAProxy unchanged. Hosting and storage remain Oracle.
- Windows: self-contained WPF/WebView2 app installed in
  `C:\Users\Shokunin\AppData\Local\Programs\TextText`, candidate
  **`8ca77072ef324c95b4202de1e79ac490`**, source `911e7564`.
  No Node or .NET SDK is required by users. Account state is DPAPI-protected;
  native code owns TextPack files, sync journals and bundled Codex.
  Previous app retained as `TextText-previous-20261007T155724-bc262a43`.
- PC source: `C:\Users\Shokunin\dev\texttext-sync-20261007`.
  Final build log: `windows-final-utf8-build.log`; desktop receipts:
  `windows/build/smoke-receipts-8b5efd2734e149318439dc771df70f1b`.

## Verification and fixes

- Mac/web/Windows edits and direct TextPack edits converged in the real apps.
  Editing while Windows was stopped survived restart and uploaded correctly.
  Actual Mac and Windows Codex authorization and tool edits passed, with agent
  identities visible in Safari. Only the dedicated Windows verification note
  was changed in these passes; original user notes were preserved.
- Server presence rejected agent identities below the mocked route boundary.
  `4712e8d9` fixes join/read/leave validation; the real store now has a signed
  session lifecycle regression, including malformed and cross-principal denial.
- `96d02284`: own-upload ACK now notifies the Windows editor even when global
  connection state stays ready. `8bdae21e`: checkpoint-only typing skips extra
  manifest requests, while 30-second remote checks cannot be starved.
- `1048ba24`: a read-only editor awaiting external sync can close only after a
  fresh file read and successful clean-journal retirement. Pending or unreadable
  journals and persistence failures still block close. Publishing is unchanged.
- Final Windows ACK refresh, normal close and reopen passed, preserving all eight
  verification markers and both saved accounts. `911e7564` explicitly uses UTF-8
  for agent subprocess input/output; eight agent/guard regression checks passed.
  Startup diagnosis established a test-launch error: scheduled tasks defaulted
  to background CPU/I/O/memory priority. The same WPF probe rendered in 494 ms
  at normal priority versus 14.5 seconds at background priority. `c2761fd9`
  sets/asserts normal interactive test priority. The unproven software-rendering
  workaround was removed in `ff3462c1`; default rendering and diagnostics remain.
  Actual account restoration and all eight markers were confirmed after correcting
  the launch priority, and the app closed normally. Final candidate
  `6ecf6765af1d4a2e871a03a6b5f2ce70` (source `c1c99964`) passed its full build gate
  and sealed receipt; smoke `1962809f581d477eb76e1a0b28dce860` passed. SSH reset
  during the install attempt, so its outcome is unknown. Inspect the installed
  receipt before retrying; do not rebuild unchanged source. Both documented PC
  routes subsequently failed. Final Unicode response and comment checks remain.
- `71c00dac` connects Windows recovery actions to the validated local recovery
  directory, ignoring renderer-supplied paths. Native coverage now has 112
  assertions. Expanded real desktop smoke passed 26 UI/template/image checks,
  native recovery access and five actual window-close checks (`c1c99964`).
- Receipts: [Windows live checks](verification/2026-10-07-windows-desktop-live.md),
  [Mac 1176 install](verification/2026-10-07-mac-1176-local-install.md),
  [Mac 1174 save/reopen](verification/2026-10-07-mac-1174-local-install.md),
  [Mac 1175 agent lifecycle](verification/2026-10-07-mac-1175-agent-presence.md),
  [sync failure audit](verification/2026-10-07-sync-failure-audit.md).

## Regression protection

- [Sync subsystem contract](../sync/README.md): separate engine/client/server
  boundaries, native core isolation, frozen v1 journals, future-version rejection,
  stale epochs, external edits, lost ACKs, recovery and provider-absence coverage.
- Exact-source receipts gate normal Mac builds/releases. Windows builds require
  native core, agent, shared client, TypeScript and actual desktop tests; install
  verifies source and every artifact. No build/release/install background jobs.
- Latest native Windows suite: **112 assertions passed** on Mac and PC build;
  actual desktop suite covers 26 UI/template/image checks, native recovery and
  five window-close checks.
  Full earlier Mac web suite: 4,303 passed, 146 skipped; DB suites: 114 passed.
  Changed code received focused tests and required build gates. Unaffected
  125-second picker evidence was reused.

## Limits and preserved work

- A second physical Apple device, provider eviction/hydration on Windows and
  hardware power loss were not live-tested. Automated tests do not certify those.
  Template/reference visual parity is outside this sync verification.
- The requested existing `Shoku's Space/My Notes/TextText Changelog.textpack`
  is absent from the active workspace and CLI search. No duplicate was created.
- Standalone `~/.local/bin/texttext` still uses build 1158; bundled agent testing
  used the installed native runtimes, not that CLI.
- Unrelated worker changes remain in `src/components/workspace/assistant/attachments.ts`,
  `src/lib/workspace/__tests__/tabs.test.ts`, and `scripts/.probe-editor.ts`.
- Oracle deploys and one-off local installs are authorized. Public desktop
  releases still require an explicit request. Preserve Algorave and shared HAProxy.
