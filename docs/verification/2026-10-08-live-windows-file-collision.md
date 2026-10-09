# Live Windows file/editor collision

## What ran

The new explicit `windows/TextText.LiveAcceptance` runner uses the production
WPF MainWindow, WindowsBridge, saved account, selected workspace, native file
watcher, shared renderer and Oracle transport. It inserts text through WebView2
input and records the visible editor, then verifies persisted Markdown. No HTTP
or native adapter is mocked. Later runs isolate browser drafts under their receipt
directory; normal app startup still uses its existing profile.

The direct-file actor edits only `text.md` inside the existing TextPack and uses
atomic replacement, retaining the preceding archive. Its implementation is
`windows/scripts/live-acceptance-file-edit.ps1`.

This is preparation for the six-client test, not a six-client pass. The Windows
browser actor, coordinated fault schedule, and sustained pending-write collision
remain unverified.

## Measured focused run

Fixture `Notes/Six-client acceptance 1232d.textpack`, item
`81cecae3-6cf9-47e0-9098-53f593832ed8`. Native assembly SHA-256
`d0950ae041c913424b799b2cf83304a9c0b386c8ef9ec63e6b612cc1b8274e17`,
production UI copied from installed verified source `2e0e10c1`; Oracle remains
`texttext-oracle-20261009T023037Z-9189ee96`.

At 02:53:37 UTC October 9 the native editor began six inserts, three seconds
apart. The PC shell atomically edited Markdown seven seconds after that start.
Every native marker and the CLI marker appeared exactly once in the final visible
editor and saved TextPack. Independent Mac CLI inspection confirms all seven.

The editor disappeared at 02:53:45.048 while showing “Waiting for the updated
file to sync”, then “Opening the shared document”. It returned at 02:53:46.242:
**1,195 ms without the editing surface**. Later input and durable flush passed.
The runner explicitly refocuses before each insertion; this does not prove caret
continuity or uninterrupted typing during the gap.

PC receipts: `C:\Users\Shokunin\dev\texttext-live-acceptance-1232d\receipts`.
Mac copies: `/tmp/texttext-live-1232d-{events.jsonl,result.json,pc-cli.json}`.

## Earlier interrupted run and retained state

Run `preflight1232c` had the Mac app, Mac Safari, Mac CLI, Windows app and Windows
CLI connected to item `ad815a9d-0158-4088-bd80-fd1317ffee8c` (1232a). The first
runner treated any momentary missing editor as a test exception and attempted
close immediately during external-file refresh. That is not a valid completed
concurrency run. The production close guard refused to discard pending work.
Only that test process was subsequently stopped after copying its native journal.

The dedicated fixture's native checkpoint was pending (epoch 1, sequence 5).
It remains preserved, with a copy under run c's `receipts/retained-native-state`.
The first runner used the normal WebView profile; this is why the final runner
always supplies an isolated profile. Mac and Safari test edits were finished
through their actual UI. No user documents or journals were deleted.

PC receipts: `C:\Users\Shokunin\dev\texttext-live-acceptance-1232c\receipts`;
Mac event/result/CLI copies use `/tmp/texttext-live-1232c-*`.

## Root paths still to fix

`CollaborativeVaultEditor.reset(false, true)` destroys the client, clears it from
state and removes the editor until native sync is acknowledged. This explains
the measured gap. `FileCollaborationClient.notifyExternalFileChange` explicitly
retires the session when pending changes exist. Simultaneous CLI editing and
typing therefore still need an in-place, durable reconciliation path and focused
regressions; a clean external edit recovering is insufficient evidence.

Also inspect the native stale pending-checkpoint case before reopening the first
fixture. Preserve its retained state; do not manually erase journals to produce
a green test.

## Verification and machine state

- Mac .NET build of the live runner: zero warnings/errors.
- Native core suite on Mac: passed, `/tmp/texttext-live-acceptance-core.log`.
- Physical PC WPF smoke and production window-close/file-activation suite passed
  after supplying the complete production Assets directory. Receipt directory:
  `C:\Users\Shokunin\dev\texttext-live-smoke-1232d\receipts-complete-assets`.
  The earlier test package omitted Assets and failed that setup check; it was
  corrected without changing product code.
- Canonical Windows app was stopped for the single-instance live test. Test runs
  completed and their launch registrations were removed. Reopening the canonical
  app is still outstanding: SSH began resetting immediately after service accept
  on both existing `pc` and `pc-tunnel` profiles. This is not evidence the PC is
  powered off. `/tmp/texttext-pc-ssh-check.log` records the direct failure.
- No website deployment, public release, or installed-client replacement in this
  change. The only product code change is optional test-profile injection; the
  application entry point retains its default profile behavior.
