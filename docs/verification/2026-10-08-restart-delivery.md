# Restart reconciliation delivery

Source `88e9ad0e` retains pending native journals when a same-ID file changes
while closed. Reopening reconciles the native projection, newer browser journal
and current file before any checkpoint. Full core/native gates passed on Mac:
853 shared tests, TypeScript, browser continuity scenarios and native suites.

## Mac

0.204 (1234) installed at `/Applications/TextText.app`, signed with three
extensions. Exact-source clean-clone build and install logs:
`/tmp/texttext-mac1234-build.log`, `/tmp/texttext-mac1234-install.log`.
The installer runtime-health probe remains unverified because its report is
sandbox-private. Actual CUA startup showed the signed-in iCloud workspace and
saved fixture 1232d. Editing and Finish passed; direct ZIP inspection found
`[mac-app:restart1234:00]` exactly once, pack SHA256
`0fe4dca8948a4aafaabc15fd92694db23cd0445c58000592deeec508fde43622`.
This is startup/save evidence, not a physical pending-journal restart test.

## Windows

Canonical app replaced from verified candidate
`C:\Users\Shokunin\dev\texttext-client-88e9ad0e\windows\build\candidate-0f305620278d463980cc311b721f82a6`.
Native suites, shared client tests, TypeScript and actual desktop smoke passed.
Logs `%TEMP%\texttext-windows-88e9ad0e-build.{out,err}.log`.
Installer verified source/artifact and staged receipt. Previous app retained at
`C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261008T205348-6c5abe98`.

Real restart runner used fixture `ad815a9d-0158-4088-bd80-fd1317ffee8c`, whose
native checkpoint was pending, epoch 1, generation 18, with no retirement.
Its original state remains under
`C:\Users\Shokunin\dev\texttext-live-restart-88e9ad0e\before-native-state`.
The production window became ready, but file activation remained on Home and
failed after 45 seconds. No typing occurred. Failure surface had no notices.
Receipts in that directory's `receipts` subfolder. This repeats an earlier
intermittent activation failure; retry alone is not a fix. Diagnostic runner
`98e67022` records native queue/transition state on failure.

Oracle is unchanged. Six-client simultaneous acceptance remains outstanding.
The required pre-existing TextText changelog was not found; no duplicate created.


## Activation root cause

Diagnostic retry retained valid native account and bridge, with an empty
activation queue and no active transition, yet the renderer was back on Home.
A deterministic browser regression then reproduced the race: hold the first
folder listing, activate a file through the native entry point, then release the
listing. Startup location restoration replaced the selected file with Home.
The baseline fails with actual `All files`, expected `Untitled`.

The candidate preserves explicit selection and fences asynchronous saved-location
reads against subsequent navigation. The same regression now passes and continues
through editing, shared-session promotion and file collisions. It is included in
the core gate as `--early-open`. Logs `/tmp/texttext-early-open-{before,after}.log`.
The physical PC has not yet received this navigation fix. Full core verification
passed in `/tmp/texttext-activation-core.log`: 853 tests, TypeScript and all three
browser modes, with an exact-source receipt. Native code is unchanged.


## Physical navigation retest, source 3319d821

The isolated production Windows window used native source `88e9ad0e` and the
exact shared UI built from `3319d821` (app.js SHA256
`4006ff676e7d79bb5cd80494f3316ebb186a538f2d9075fbd4b51381a8925479`).
Native activation returned `opened`; the header remained on fixture 1232a.
The Home replacement is fixed in this run. The next assertion failed: the
retained shared session displayed the recovery notice before an editor opened.
No test typing occurred. Receipts:
`C:\Users\Shokunin\dev\texttext-activation-3319\receipts`.

Retained journal after normal close: epoch 1, sequence 5, one pending update,
a batch, `unqueuedDirty=false`, and the generic epoch/access retirement reason.
Do not infer current server permissions or epoch from that generic reason alone.
Original checkpoint copies remain preserved. This is an unresolved recovery
failure, not a passed restart test.

A separate fixture 1232d continuity run was launched under `receipts-d` with
12 inputs. Its result is not yet collected: new SSH connections are temporarily
resetting on both existing PC profiles. The CLI actor did not start. Do not
count this as a simultaneous app/CLI run. Local runner compilation passed with
zero warnings/errors (`/tmp/texttext-cursor-observation-build.log`). The runner
now records bounded protocol cursor/permission observations without response
content or credentials to distinguish retirement causes on subsequent runs.
