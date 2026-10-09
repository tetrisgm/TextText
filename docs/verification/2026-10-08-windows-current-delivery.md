# Current Windows delivery

Source `ab8d2968`, installed canonical WPF desktop application at
`C:\Users\Shokunin\AppData\Local\Programs\TextText`.

Verified candidate:
`C:\Users\Shokunin\dev\texttext-client-ab8d2968\windows\build\candidate-e7b611dfc820450e808f1d15272d3301`.

The physical PC build ran native core/agent suites, shared client regressions,
TypeScript, self-contained packaging and actual interactive WPF/WebView2 smoke.
All required checks passed; artifact/source receipts were verified before and
after staging. Log on PC: `%TEMP%\texttext-windows-ab8d2968-build-retry.log`.
The first wrapper attempt stopped on an npm warning interpreted as a PowerShell
error; its process was terminal before retry. No application check was bypassed.

On the owner's explicit authorization, stopped only the canonical TextText
process, installed with `windows/scripts/install.ps1`, and reopened on desktop
session 1. PID 45512 reports Responding true. The previous app is retained at
`TextText-previous-20261008T181708-63854ae6`; user files and journals remain.
The temporary smoke and launch tasks were removed; no persistent build job.

Independent PC ZIP inspection found the fresh Mac Safari capture at
`Bookmarks/Safari share verification 1224.textpack`, with exact identity
`e06592ec-97c6-46e0-b17d-f2717252c987`, title and original URL. This verifies
physical Mac-to-Oracle-to-Windows file delivery with the same identity.

The affected historical 1185 note still reports epoch 2, Pending false,
RetiredReason null, journal retirement null and zero pending updates.
This verifies its durable state; disappearance of the visible banner and a
human edit in the canonical installed window remain unverified. No journal
was deleted to make this pass.
