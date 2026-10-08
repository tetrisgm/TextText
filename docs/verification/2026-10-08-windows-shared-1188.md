# Windows shared client acceptance, 1188 cohort

Source `43614e64`, clean archive at
`C:\Users\Shokunin\dev\texttext-verify-43614e64`.
Installed source fingerprint:
`8c9694e9025282a9d0bffa233c7aaec473b8d9f61a04e01641e710d0a0d2e528`.

Native core/agent tests, 269 shared client tests, TypeScript, shared UI bundle,
publish and actual desktop smoke passed. Candidate
`windows/build/candidate-6f2a693a859742039d360c2d562a141e`; smoke
`windows/build/smoke-receipts-9ad46a03040e4374afbd5af9fceb8f80`.
Mac log: `/tmp/texttext-build-43614e64.log`.

The Windows run includes authoritative permission caching across 304/restart,
new offline owner/folder-granted notes versus hidden existing items,
revoked queued deletion retention, and later permission restoration. Actual
MainWindow smoke verifies failed prepared editor flush preserves the prior
workspace/bridge and does not construct a replacement bridge. These isolated
checks do not establish live multi-account switching acceptance.

Normal renderer-guarded close and verified install preserved the prior app at
`%LOCALAPPDATA%\Programs\TextText-previous-20261008T003927-67db8beb`.
The installed app retained the account, workspace and existing open document
`Agent template creation verification 1185`, its Research note look and four
headings. Mac peer presence remained visible. No content was created or changed.
UI receipt: `windows/build/installed-after-login.json`, observed
2026-10-08T07:40:12Z. The first startup sample at roughly eight seconds saw only
the native shell; the later sample saw the complete editor. This is not a new
startup performance certification.

The matching Oracle rollout was still pending during this read-only acceptance;
no claim is made here about live scoped role changes on that rollout. Existing
unchanged read/search/save and cross-client dataflow evidence remains in the
[1185](2026-10-07-windows-shared-1185.md),
[1186](2026-10-07-windows-shared-1186.md), and
[1187](2026-10-08-windows-shared-1187.md) receipts.
