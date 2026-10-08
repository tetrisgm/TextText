# Windows shared client acceptance, 1183 cohort

Source: `04c265c7`, clean git archive extracted to
`C:\Users\Shokunin\dev\texttext-verify-04c265c7`.
The Windows executable uses a generic file version; the verified source
fingerprint identifies this installed build:
`cd37808ce29a79207575e4572fca08c4e0ea4d70be82c59e839a6ddac8c10aff`.

## Build and install

Pinned Codex bootstrap succeeded on Windows after the CRLF parser fix.
Three parser regressions passed on Mac and Windows. The established build
passed native core and agent suites, 195 shared-client tests, TypeScript,
shared UI bundling, desktop publishing and actual interactive desktop smoke.
The latter passed 28 shared UI checks including note/article/bookmark/gallery/
talk creation, save/reopen and native image attachment roundtrip, plus native
recovery and actual MainWindow close/activation checks.

Candidate: `windows/build/candidate-9d1d610a548d47089157372e802b6d91`.
Smoke receipt: `windows/build/smoke-receipts-6eea45edea8e4d4bb299601c3d8ad0b2`.
Mac copy of complete build log: `/tmp/texttext-build-04c265c7.log`.

After the parent confirmed combined gates, the existing app closed normally
through its renderer flush guard. The installer verified candidate and staged
artifact hashes, retained the previous app, and installed under
`%LOCALAPPDATA%\Programs\TextText`. No process was force-killed. The saved
account and workspace root remained unchanged. Temporary interactive test/
launch tasks were unregistered; no recurring job was installed.

## Installed app acceptance

Actual Windows UIA interaction verified signed-in startup, existing document
content and body search. A dedicated new note, `Windows shared template
verification 1183`, received `Windows snippet verification 1183.`. The real
Add to note > Template controls saved its body as `Windows verification
snippet 1183`, then inserted that saved snippet at the cursor. Finish and
reopen retained both occurrences. On-disk validated document content confirmed
two occurrences in the note and one in the saved template.

The Mac-authored `Shared client verification 1183.` marker appeared exactly
once in the Windows copy of item `290afb22-c198-4a7f-9d26-9a4f04dd9020` without
manual import. At 2026-10-08T05:29:23Z, native outbox and conflict counts were
both zero. The app was left running in saved reader mode.

PC acceptance evidence: `windows/build/installed-acceptance.json`,
`account-search-live.json`, `snippet-inspection.json`, `normal-close.txt`.
Only the dedicated new verification note/template were changed. This proves
local UI, file persistence and passive remote delivery; it does not claim a
live configured AI provider interaction.
