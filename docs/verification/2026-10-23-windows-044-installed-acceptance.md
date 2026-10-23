# Windows 044e5441 installed acceptance

Unified release 044e5441 installed the same commit on Windows, Mac and web. On October 23 the real installed Windows app passed one open/edit/save/normal-close/reopen cycle. Existing owned fixture: Notes/Untitled 31.textpack, UUID 080a76d5-f83d-456f-b893-67b869d27af2, title Windows launch acceptance 24104475 20261023. This is distinct from the shared Web241 multiplayer fixture ee455de6-5640-453c-8632-7984a370688c.

Real keyboard input appended the second paragraph below. Ctrl+S completed at 22:43:52.336 UTC. CloseMainWindow returned true at 22:44:40.928 UTC; WaitForExit confirmed normal exit at 22:44:41.038 UTC. Reopened PID 27992 displayed the whole content at 22:45:22.858 UTC. Read-only inspection of its canonical TextPack markdown confirms the exact newline and body:

```text
Launch241 exact body L1. Reopened edit exact. Release a868426a exact reopen. Release d7a06af4 exact reopen.
Windows 044e5441 exact reopen verified.
```

Startup measurement remains unverified. First PID 21088 started at 22:42:34.786860 UTC; the first snapshot already showed listing and restored body at 22:42:42.586 UTC, giving only a 7.80-second upper bound. It proves neither a three-second pass nor a failure. Edit card opened successfully and real typing worked. No placeholder or timeout was observed, so no diagnostic stack or repeated timing loop was taken.

The attempted ProcessStartInfo launch with remote-debugging port 9333 and a bounded CDP readiness probe was rejected before execution by automatic approval review, stating blocked by policy. It was not retried or repackaged. The supported normal launcher completed the required durability reopen instead. No owner input conflict, forced quit, deletion, journal reset, simulated acceptance, or source change occurred. The app remains open on the Windows fixture for coordinated multiplayer navigation; Phase2's measured five-launch target is still open.
