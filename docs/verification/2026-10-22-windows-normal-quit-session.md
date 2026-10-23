# Windows normal quit across SSH and desktop sessions

Read-only inspection through the existing Mac `ssh pc` profile observed the
PowerShell helper in session 0 (PID 21900) and installed TextText in session 1
(PID 44676). TextText's `MainWindowHandle` was 0 from SSH. The previous combined
release requested `CloseMainWindow` directly in that SSH session. No close was
requested during this inspection.

`windows/scripts/ship-all.ps1` now uses the existing interactive-task pattern
from `smoke.ps1` for a quit-only helper. The temporary task uses the current
qualified account, Interactive/Limited execution and a hidden PowerShell window.
The helper checks every target session before requesting any close, requests
normal close, and waits up to 120 seconds. Refusal or timeout leaves the app
running. It sends no termination signals and dismisses no prompts.

The caller requires a success receipt, successful task completion and no running
TextText process before starting its backup or installation. The task is
unregistered in `finally`; no recurring trigger, build or installer is scheduled.
The 150-second scheduler limit bounds only this helper, which launches no app.

Windows-only verification: `test-quit-normally.ps1` passed with process doubles
covering normal close, refusal, timeout, foreign session, already exited and empty
process lists. Receipt checks reject missing/failed proof and a remaining process.
PowerShell parsing passed for the helper, caller and test. These scripts depend
on Windows Task Scheduler and desktop sessions; they were not executed on Mac.
The shared release checkpoint tests were separately verified on Mac in the
preceding `b0463854` change.

No interactive task was registered or started, no real app was closed, and no
desktop input was sent during this verification. Real task execution and
installed edit/save/normal-quit/reopen acceptance remain pending.
