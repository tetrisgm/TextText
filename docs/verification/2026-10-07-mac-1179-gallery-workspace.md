# Mac 0.204 (1179) acceptance

Installed `/Applications/TextText.app` from source `3ff475d9`, clean archive snapshot `/private/tmp/texttext-mac-226c8f19` advanced to that commit before the final build. The initial 226c8f19 candidate was never installed. This is the authorized one-off local Store build, not a public release.

- Exact-source shared (243 tests) and native gates passed. Copied receipts from a different directory fingerprint were rejected correctly; the build reran its gates instead of bypassing them.
- Final build, signature verification and arm64 verification passed for the app and all three extensions. Native Apple sign-in entitlement is `Default`; sandbox remains enabled. Existing official Codex runtime was bundled unchanged.
- Before replacement, 1178 was in read view with all nine existing verification markers and no editable draft. Its Offline banner cleared asynchronously after Retry and showed Windows presence. Root subsequently identified the inactive-session/offline conflation; 1179 includes the paused/reconnecting fix.
- Normal Command-Q succeeded. Local installation preserved account and iCloud workspace. Startup displayed the actual signed-in email and existing verification note without an offline warning.
- Actual workspace `.texttext/workspace-binding.json` contains exactly `version: 1`, origin `https://texttext.app`, and workspace ID `be28ae03-c64e-4695-80af-04f048f86f37`. No credentials or device journal fields are present.
- Command-K search for `1177 account verification` returned the existing note.
- Opened the existing Gallery and first image. Zoom displayed 125%; arrow-key pan retained the current image. Fit restored 100%. Opened the per-image comments panel read-only, then switched to image 2; zoom reset and the panel remained scoped to that image. No comments or gallery metadata were written. Integrated thread creation/reply/isolation is covered by `gallery-comments.browser.mjs` with the production TextPack codec.
- Restored the dedicated note, quit normally and reopened. All nine markers remained visible, with the account and folder intact. The first CUA observation timed out during launch; a subsequent observation confirmed the complete normal window. No process termination was used.
- No document content was changed in this acceptance pass. Existing save/reopen evidence remains in the 1177 receipt; the shared close/durability regressions passed in the current native/shared gates.

Installed SHA-256:

- Native executable: `82cb55587552ab8deb3c86cec332c18744e385f0544cfe934936c462d14dcfbd`
- LocalVault app.js: `b816ee31b21d342ed93a26bdf32eb34632555727cf5dc16d2b694b45d827def7`

Logs: `/tmp/texttext-mac1179-final-build.log`, `/tmp/texttext-mac1179-install.log`. Established local Store sandbox-private runtime-health exception was used; no runtime-health attestation is claimed.
