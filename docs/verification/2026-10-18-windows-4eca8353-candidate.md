# Windows 4eca8353 normal and private actor candidates

Exact source `4eca8353f455d5960e5c4cd592bece0aefff70fa`. Both fresh actual-PC builds exited 0, with no uncommitted overlays. Strict before/after proofs match: **3,158 tracked files**, source input SHA-256 `e100bcf09a1bc9c689ba62610ea88f3aa01328a1563a0497b1c276f577f650f2`, archive SHA-256 `97985bbecf11b4b8b516fb8739a1d5e5b3c851e649f7606b49c1b720c7adc512`.

This candidate supersedes the [35c726dd build](2026-10-18-windows-35c726dd-candidate.md) for delivery preparation. Previous artifacts and evidence remain preserved.

## Official normal candidate

`C:\Users\Shokunin\AppData\Local\Temp\texttext-pc-frozen-4eca8353-cc_bg_xy\normal-build\source\windows\build\candidate-ed436acc8cf14b3d9eba971ef6a03644`

The supported `windows/scripts/build.ps1` passed locked dependencies/runtime checks, **1,106 Core assertions**, **114 bridge checks**, **24 private actor helper checks**, **11 Agent checks** plus renderer flush, **593 client tests in 52 files**, **11 registered Node checks**, TypeScript, shared UI packaging and self-contained publish. Actual isolated smoke receipts passed **32 desktop checks** and **29 MainWindow close checks**. The official candidate receipt verified twice.

The generated TypeScript cache was reversibly retained outside the source archive; strict source proof stayed unchanged. Existing dependency/compiler warnings did not become failures.

| Normal artifact | SHA-256 |
| --- | --- |
| TextText.exe | `23076418e72dcb9b8fa0d9ba0e435e46611a3c9c047bb96afb6be903772dc429` |
| TextText.dll | `960c89e9190620ad7c87abbfc564b2edaff4b62fd7ac12181361e1f08f147411` |
| TextText.Core.dll | `06004100c2c0220bcf49799c9a5e91151db4a5d7685e443f137f93670b4f10b2` |
| Assets/app.js | `395293e4aa6d9a5bd9260cffc31f3363e6906dfdbcd56a4cd6a7ddfdb3494431` |

Smoke evidence: `normal-build/source/windows/build/smoke-receipts-aa878ba3ca224994a3f86c1614c12bd9`. The owned temporary WebView directory `texttext-desktop-smoke-ce7eb138-188f-4348-b606-0b7fe3cbbbd8` remains preserved.

## Sealed private actor

The unchanged frozen-source wrapper passed all three required steps: locked npm, shared UI and native actor compilation. Its source proofs match the normal candidate. Sidecar: `private-actor-lf/StressBuildIdentity.json` under the evidence root. Build receipt SHA-256:
`cba9f663a8253054605db928dfa0617876eaa0f40113c30654022951c988f3c9`.

| Private actor artifact | SHA-256 |
| --- | --- |
| MainWindow assembly | `a4d2b3737467d4703b9cbc4ac2e9cd24f8833f40ae84ec8cdc0bad7662e7dbe2` |
| Core | `c4042830f80e1916117344f3778a75e5cac1ffc794ffa4911c295eecaf797f5d` |
| LiveAcceptance actor | `9fcb090c1661d929a0a268c80348e3a79dd393bad8af4da9eac633c69ae3173a` |
| Existing dotnet host | `21a46f1e5235cf4e844b9de5429f0e198b9c97a41f0503a66442f1d639ca3ee6` |

Normal and actor shared UI hashes match. These trusted local receipts and artifact pins are not physical collaboration acceptance.

## Preservation and limits

Bounded Security queries found **zero matching Shokunin login failures (4625) or lockouts (4740)** during **2026-10-19 01:29:09–01:34:55 UTC**. The existing WebView workaround remained present; boot time remained October 14. No SSH identity, profile, tunnel, policy, account or credentials changed.

**Not installed. Neither candidate was launched against the owner's workspace.** Owner PID **40636** remained responding in session 1. Its guarded normal close, pending-work recovery review and verified backups remain prerequisites before installation. Fixture close checks do not establish that the owner process is safe to terminate. No public release occurred.

## Evidence

PC root: `C:/Users/Shokunin/AppData/Local/Temp/texttext-pc-frozen-4eca8353-cc_bg_xy`.
Copied Mac receipts/logs: `/private/tmp/texttext-pc-frozen-4eca8353-cc_bg_xy`.

Includes exact source/bootstrap manifests, normal/actor process results and logs, normal candidate verification, actual smoke JSON, actor build receipt/sidecar, and security-start/end.json. Completion receipt SHA-256:
`f8c2d33ec59a718a2480790f718e267b8a5cdb6ae46f5040ff09bd60dee6fccf`.
