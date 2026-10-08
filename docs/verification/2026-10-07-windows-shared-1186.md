# Windows shared client acceptance, 1186 cohort

Source `a6fee0e4`, clean archive at
`C:\Users\Shokunin\dev\texttext-verify-a6fee0e4`.
Installed fingerprint:
`853c6d543c1a02f675839e47841ec8359d524b497934f39739e5ec513ad1ea1b`.

Native file/sync and agent tests, 255 shared client tests, TypeScript, bundle,
publish and actual desktop editor/close/activation smoke passed. Candidate:
`windows/build/candidate-a04a9f72970947b9a61be445b9aa4302`.
Smoke: `windows/build/smoke-receipts-0d7f28c8086b40eab68ce49b1a19d602`.
Mac build-log copy: `/tmp/texttext-build-a6fee0e4.log`.

Installation followed normal renderer-guarded close and verified candidate/
staged hashes. Prior app retained at
`%LOCALAPPDATA%\Programs\TextText-previous-20261007T235248-5dd333ed`.
Existing account/workspace retained; no forced termination or recurring jobs.

Actual installed app reopened the existing agent-created Research v2 item.
Both document header and Add agent target showed its saved title,
`Agent template creation verification 1185`, without the filename identity
suffix. The file path remains available separately in the agent panel.
Four starter headings still rendered. The agent panel was then closed; no
prompt, provider authorization or content mutation was performed.
PC UI evidence: `windows/build/agent-title-ui.json`.

The [1185 receipt](2026-10-07-windows-shared-1185.md) supplies unchanged
create/edit/search/save/reopen and passive server-created template delivery
evidence. Those flows were not repeated. This check does not claim live model
execution; guarded visual proposal validation is covered by the shared tests.
