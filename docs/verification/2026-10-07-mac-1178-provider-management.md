# Mac 0.204 (1178) provider management verification

Source `889bac73`, clean physical-path snapshot `/private/tmp/texttext-mac-889bac73`. Built and installed using the established local Store workflow with existing standalone Codex 0.153.4. No public release.

- Required exact-source gates passed: **243 shared tests and native verification**. Both receipts are in the snapshot's `.texttext/sync` directory. The physical path and corrected gate entry-point avoid the earlier `/tmp` invocation issue.
- Store compilation, App Intents generation and code-signature checks passed. Native Apple sign-in entitlement, saved account, iCloud workspace, bundled Codex and all three registered extensions were preserved. The established sandbox-private runtime-health exception was used; no runtime-health attestation is claimed.
- Before replacement, build 1177 was idle in read view with no unsaved fields. Normal Command-Q succeeded. Build 1178 started signed in and restored the dedicated Windows verification note with all nine existing markers.
- Settings displayed the real email, existing workspace and Apple Connected. Clicking Manage sign-in methods opened Safari at the account-bound management page. The page displayed the same email, Apple Connected and Connect GitHub; Google was not configured. No provider connection was submitted and no identity was mutated.
- Closed only the newly opened management tab, restoring the existing Safari workspace. Closed Mac Settings and searched for `1177 account verification`; the correct note appeared. Escape returned to the preserved note.
- No document edits were made in this pass. Earlier save/reopen evidence is recorded in the [1177 receipt](2026-10-07-mac-1177-account-settings.md).

## Installed SHA-256

- `Contents/MacOS/TextText`: `6b0f4703c505f301c61d85e129e2827c58743a05fd0dd66d97c5674b7dbe273d`
- `Contents/Resources/LocalVault/app.js`: `d72b1d9069e69eecafbb91b6956a0e3c51fda2ede57218ad912fd2416cb5ab33`

Logs: `/tmp/texttext-mac1178-build.log`, `/tmp/texttext-mac1178-install.log`.
