# Windows 98b installed acceptance

Installed receipt verifies source `98b5314ad0c7cc1193bb7e2828b967af6b4b12fd`,
matching the delivered Mac and web. The initial unified command stopped at its
Windows backup copy; installation completed through the supported installer
after a separately verified stopped backup. This is recovery of the same
candidate, not a claim that the first command succeeded uninterrupted.

PowerShell 5 cannot copy the expanded retained-state backup paths beyond its
legacy path limit. A disposable fixture reproduced the failure. The reviewed
temporary Node copy helper passed two focused checks on Windows and Mac.
The recovery wrapper used existing PowerShell 7 for all reparse-point checks,
verified clean exact source, candidate receipt, successful normal-quit receipt,
process absence, SHA256 inventories before/after/copy and account bytes, then
called unchanged `install.ps1` and verified the installed receipt. No guards
were bypassed. Both partial backups remain preserved.

Complete backup:
`C:\Users\Shokunin\AppData\Local\TextText-backups\ship-all-20261023074103440-98b5314a-longpath-d6faf14e454e4234983667b792c6d95a`.
Previous app:
`C:\Users\Shokunin\AppData\Local\Programs\TextText-previous-20261023T011552-da079358`.

## Actual installed UI check

The installed app was launched normally. Startup remained slow, initially showing
the chooser and timeout, then restored the existing workspace and C3 note.
This does not meet Phase 2 timing targets.

Through the real New note button and keyboard input, created
`Notes/Untitled 30.textpack`:

- Title: `Phase 1 Windows 98b5314a 20261023`
- Body: `Windows installed acceptance 98b5314a. Exact content survives normal quit and reopen.`

Alt+F4 exited normally; a process check confirmed no TextText process remained.
A fresh launch produced a new window (`22482654`) and rendered the exact title
and body in its Note card. No force close or journal reset was used.
Independent hosted readback has not yet found the Windows note, so server
convergence is not claimed by this local durability check.

[Mac and web acceptance](2026-10-23-mac-web-installed-acceptance.md) records the
same source and their actual normal reopen checks.
