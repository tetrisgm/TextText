# Windows shared client acceptance, 1191 cohort

Exact source `f3167c4b`, clean archive at
`C:\Users\Shokunin\dev\texttext-build-f3167c4b`.
Verified candidate `windows/build/candidate-22df38d0062f4be9b06560b4f08bddcd`;
actual desktop receipt `windows/build/smoke-receipts-751c9868c6704de7bb5cb315a0032c23`.
Mac build log: `/tmp/texttext-windows-f3167c4b-build.log`.

The complete Windows build exited zero: native storage/sync and agent suites,
291 shared-client tests (including five profile-recovery regressions), TypeScript,
self-contained publish, and actual WPF/WebView desktop smoke. Desktop smoke
covers editor creation/save/reopen/search, failed flush preservation, workspace
switching, and native activation. No required check was bypassed.

Installed after the exact-source Mac gate passed. Inspected the existing editor,
then normal Window.Close completed its durable save handshake without forced
termination. Installer verified candidate and staged artifacts and preserved the
previous app at `%LOCALAPPDATA%\Programs\TextText-previous-20261008T015848-ce7f95d9`.

The installed app reopened the same original workspace and dedicated 1185 note.
At 08:59:31 UTC it showed `ramine@ramine.net Signed in`, all four note headings,
both 1189 verification markers, and `Template cohort verification 1190.`.
No user content was changed. Startup first exposed the shell before the editor;
this receipt does not certify launch speed. Actual installed search for
`Agent template creation verification` returned the saved title and correct
Notes TextPack path; the command menu was closed, returning to the editor.

The five profile tests cover transient failure, denied access, old-account late
responses, exhausted retries followed by first confirmed online readiness, and
replacement of long backoff on a genuine reconnect without repeated-ready spam.
No outage was induced against the real account during this installed check.
Temporary interactive verification tasks used normal priority and were removed.
