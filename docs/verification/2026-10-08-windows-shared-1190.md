# Windows shared client acceptance, 1190 cohort

Exact source `5254ff85`, clean archive at
`C:\Users\Shokunin\dev\texttext-build-5254ff85`.
Candidate `windows/build/candidate-2ba064086f0348fc8ac097b09de71c6a`;
actual desktop receipt `windows/build/smoke-receipts-7393b4cbcaec4ed9851363c306079b42`.
Installed source fingerprint:
`7ae0b5efa52a27711f56bc24203a7fd2563aaf6201f536b34b73d2f49e7b1691`.
Mac build log: `/tmp/texttext-windows-5254ff85-build.log`.

Required native storage/sync and agent suites, 286 shared-client tests,
TypeScript, self-contained publish and actual desktop smoke passed. Desktop
checks cover creation, save/reopen, search, every template family, opaque image
preservation, failed workspace switching, durable close and native activation.
The initial temporary wrapper stopped on an npm stderr warning; the corrected
wrapper retained explicit exit-code checking and reran the complete build.

Installed after the combined Mac gate passed. The existing editor was inspected
and Save invoked; it remained an editor, so normal Window.Close exercised the
shipped durable flush handshake. The process exited without forced termination.
Installer verified source/artifacts twice and retained the previous app at
`%LOCALAPPDATA%\Programs\TextText-previous-20261008T013939-387bae9e`.
No user text was edited during this acceptance.

On reopening, the existing workspace and dedicated 1185 note retained its four
headings, both 1189 verification markers and `Template cohort verification 1190.`.
The app first displayed its shell before the full editor; startup speed is not
certified by this receipt.

Oracle restarted during startup. At 08:40:30 UTC the editor displayed its saved
local content and a waiting-for-connection message. At 08:41:29 UTC it recovered
without Retry, navigation or restart: the message disappeared and live Mac/PC
presence returned. The original account session and workspace remained intact.
The account footer retained a generic signed-in label after its failed initial
profile lookup; that independent shared-UI retry gap is being fixed in the next
cohort. No logout or credential manipulation was performed.
