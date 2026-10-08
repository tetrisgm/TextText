# Mac 0.204 (1177) account settings installation

Source `346ddf0d`, clean snapshot `/tmp/texttext-final-346ddf0d`. Built with the established local Store workflow and existing standalone Codex 0.153.4. Installed at `/Applications/TextText.app`; native Apple sign-in, saved account, iCloud workspace and three registered extensions were preserved. No public release.

## Verification

- The `/tmp` alias exposed a verification-script entry-point bug: its main guard compared the argument path with the resolved module path, silently skipping invocation. This was detected before installation. Explicit `node /private/tmp/texttext-final-346ddf0d/sync/verify.mjs` subsequently passed **238 shared tests and the native gate**, writing both exact-source receipts. Parent fix `ba132012` protects later invocations. The skipped invocation is not counted as verification.
- Store compilation, normal App Intents generation and signature verification passed. The established installer verified version/build and signatures, using the documented sandbox-private runtime-health exception; runtime health attestation remains unverified.
- Before replacement, build 1176 was idle in read view with no unsaved input. Normal Command-Q completed before installation.
- Build 1177 opened the existing iCloud workspace and dedicated `Notes/Windows sync verification 20261007.textpack` note with its eight prior markers intact.
- Added only `Mac build 1177 account verification 20261007.` to that dedicated test note using the editor. Finish saved it; normal Command-Q terminated the process. Relaunch displayed the new marker and all eight previous markers.
- Search for `1177 account verification` found that note. Escape dismissed search normally.
- Quick Look, Share and File Provider extensions remain registered.
- Account identity and shared Settings live-server verification are pending the matching Oracle account endpoint deployment. Before deployment the sidebar correctly retains the generic signed-in fallback; no successful profile fetch is claimed here.

## Installed SHA-256

- `Contents/MacOS/TextText`: `4c73b1bdf58afb970e22a834deec45613cf3660dd3a93f105f2341471ce29902`
- `Contents/Resources/LocalVault/app.js`: `8a1cefd08bc3c2da5f619c9a36344482c488d4e85d769d919dfd2b3b58d32de1`

Logs: `/tmp/texttext-mac1177-build.log`, `/tmp/texttext-mac1177-sync.log`, `/tmp/texttext-mac1177-install.log`. Receipts: snapshot `.texttext/sync/darwin-core.json` and `darwin-native.json`.
