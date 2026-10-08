# Windows shared client acceptance, 1187 cohort

Source `4c7efe85`, clean archive at
`C:\Users\Shokunin\dev\texttext-verify-4c7efe85`.
Installed fingerprint:
`488bf780decff5762b1bf421183d4bc61dae1bc9a5d3bea9f24b9babe1168788`.

Native core/agent tests, 260 shared client tests (including bookmark baseline
retention), TypeScript, shared UI bundle, publish and actual desktop smoke
passed. Candidate `windows/build/candidate-20693eb3e220433a88eae704a09a4248`;
smoke `windows/build/smoke-receipts-5a622f21bd6a4ff095b6f8e7f5b587af`.
Mac log copy: `/tmp/texttext-build-4c7efe85.log`.

Normal renderer-guarded close and verified installation preserved the prior
app at `%LOCALAPPDATA%\Programs\TextText-previous-20261008T000944-bc6cc585`.
Existing account and workspace were retained. No forced termination,
provider request, content creation or modification occurred.

Actual installed startup reopened `Agent template creation verification 1185`
with its saved title, Research note look and four original headings. Signed-in
UI and live Mac peer presence remained visible. UI receipt:
`windows/build/installed-after-login.json` (2026-10-08T07:09:59Z).

The [1185 dataflow](2026-10-07-windows-shared-1185.md) and
[1186 saved-title](2026-10-07-windows-shared-1186.md) receipts cover unchanged
acceptance. Shared tests cover the changed baseline-retention logic; no fresh
bookmark edits were made to the user's workspace for this installation.
Web Customize acceptance belongs to the parent web deployment receipt.
