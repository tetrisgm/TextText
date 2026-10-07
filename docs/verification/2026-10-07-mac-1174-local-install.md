# Mac 0.204 (1174) local installation

Source: committed `bfce78c5`, clean snapshot `/tmp/texttext-final-bfce78c5`.
This is an authorized one-off local Store-shaped development installation, not a public release.

## Build and installation

- `mac/scripts/build-store.sh`, `TEXTTEXT_STORE_LOCAL=1`, version 0.204/build 1174.
- Exact-source sync core/native receipts accepted by the build. Swift release compilation and the normal Xcode App Intents pass succeeded (10 intents, 4 shortcuts, 4 parameter summaries).
- Existing installed Codex runtime could not execute `--version` outside its inherited sandbox. The build instead used the existing signed official `/Users/shokunin/.local/bin/codex`, the same `codex-cli 0.153.4`. The successful retry reused the newly generated unchanged App Intents metadata through the existing guarded local-build option.
- Signed Apple Development, team `52WM463HR2`; `codesign --verify --deep --strict` passed. Native Apple sign-in entitlement remains `Default`, sandbox enabled, app group `52WM463HR2.group.app.texttext`.
- All three signed extensions present and registered: share, Quick Look, File Provider.
- Installed using `mac/scripts/install-local.sh` with exact expected version/build and its documented `TEXTTEXT_REQUIRE_RUNTIME_HEALTH=0` local Store exception. Runtime attestation is sandbox-private; no claim of a passing runtime health report. Binary verification and normal launch remained enabled.
- `Package.resolved` restored by the build script; no authentication or workspace configuration changed.

## Visible and filesystem verification

Before replacement, the canonical installed app was signed in, displaying a saved existing note in read mode with no unsaved editor/recovery banner. Normal Command-Q completed before installation.

After replacement, the existing account and iCloud workspace at `~/Library/Mobile Documents/com~apple~CloudDocs/TextText/Workspace` reopened. The prior note rendered unchanged. Command search found `Notes/Windows sync verification 20261007.textpack`. The real Mac editor saved the final paragraph `Mac build 1174 editor marker 20261007.` while preserving the Windows, web and direct-file markers. Normal quit/reopen retained the full note and new marker. The nested `text.md` inside the saved TextPack ZIP independently contained all markers. No other note was edited.

Cross-device reception is recorded by the coordinating verification task; this receipt establishes Mac UI and local persistence only. Extension registration/signature checks do not claim new end-to-end extension action tests.

## Installed SHA-256

- `Contents/MacOS/TextText`: `9c5f74732bd4addfbb93c222409e222eb2dca0fd31fc5b0bab6671128c2172a0`
- `Contents/Resources/LocalVault/app.js`: `7f1a2123e249797820753c155f9b5a7de498f5689b4254270e1750b51a622055`
- `Contents/Helpers/codex`: `1249787b974e5f2d993c9fba5a0b1b881eab7834c54d61d2003779da5ed3da85`

Logs: `/tmp/texttext-mac1174-build.log`, `/tmp/texttext-mac1174-install.log`.

## Real built-in Codex task

In the installed build, Add agent targeted only `Notes/Windows sync verification 20261007.textpack` (item `6df95934-cd09-4a73-b9e6-a6fb8a453547`). Connect Codex immediately recognized the existing ChatGPT account; no credentials were copied or browser authorization required. An actual model task read the note and appended exactly `Mac Codex live edit 20261007.` as a final paragraph. The UI displayed the new paragraph and a completed Codex reply. Independent ZIP inspection found the new marker exactly once and all five earlier markers intact. The coordinating task confirmed the marker reached live Safari. This verifies the native bundled runtime, existing account, dynamic file tools, shared validation/write path and cloud propagation together, beyond mocked app-server tests.
