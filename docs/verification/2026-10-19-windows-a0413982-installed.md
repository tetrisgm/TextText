# Windows a0413982 installed

The verified [a0413982 normal candidate](2026-10-19-windows-a0413982-candidate.md) was installed locally on 2026-10-19. Product source remains `a041398244964e627ef1a72681ea084310358c61`. No public release or six-client acceptance is claimed.

## Guarded close and preservation

To complete the authorized upgrade, only Cancel was dismissed on the saved-work dialog, followed by one normal close. Source review confirmed Cancel returns before adoption. Same-session UI Automation first verified PID **42616**, exact executable/start time, and the visible Keep saved work / Open folder / Cancel controls. Cancel was invoked once; the complete device-state file hash inventory was unchanged immediately afterward. No ownership choice or adoption occurred.

`CloseMainWindow()` then returned true and PID42616 exited normally at **10:14:47Z**. No force termination was used. The earlier false close attempt and read-only dialog observations remain preserved.

After exit, fresh create-only backup and verification retained the actual vault/device state: **1,110 files, 103 directories, 7,340,498 bytes**, inventory SHA-256 `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`. The single unbound conflicted outbox record remains preserved. The prior installed app backup contains **429 files / 548,019,080 bytes**, stamp/hash inventory `66099c41bc8d1fac82acc8e638ca1804c2a2ccdad833925dd61a5d949df2f07e`. Protected current-user/SYSTEM ACLs, encrypted credential storage, and the empty alternate legacy-state directory were preserved. No plaintext credentials or content were exported.

Backup: `C:/Users/Shokunin/AppData/Local/Temp/texttext-pc-frozen-f994b8f1-9chy9n57/before-a041-stopped-8665890b7a044167a5c7675cf22859c1`. The historical parent identifies the unchanged backup helper, not the candidate source.

## Official installation and actual launch

The candidate's unchanged `windows/scripts/install.ps1 -Candidate .../candidate-77367c42794942de9cab07f3759318ef` passed original and staged receipt verification. Installed receipt verification passed separately afterward. Previous app directory: `C:/Users/Shokunin/AppData/Local/Programs/TextText-previous-20261019T031540-765713d2`.

Installed `TextText.exe` SHA-256: `c34e0639196369e3af428f7e234ad05527775f42d0c12f3e57b5c2bb376c7eed`.

Normal no-argument interactive launch produced **PID33756**, session1, start **10:15:47.9865396Z**, exact installed executable, responding. The original 15-second MainWindowHandle check refused and is retained. A subsequent same-session read-only UI Automation observation verified actual visible TextText window **21368222**, showing Keep saved work / Open folder / Cancel. This verifies recovery UI; it does not claim an editable workspace. The main window has not yet been published while that review is pending. Only this launch's scheduled-task registration was removed; the app remains open. No review control was selected on the new app.

## Evidence and limits

Private evidence root: `/private/tmp/texttext-pc-frozen-a0413982-7wd73u48` (same basename under PC LocalAppData/Temp).

- `cancel-close-result.json`, `owner-blocking-window.json`, and task cleanup proofs.
- `stopped-backup-{inspect,backup,verify}.json`, `stopped-app-backup-summary.json`, and create-only backup config.
- `a041-launch-window.json`, `installed-a041-final.json`, and the preserved first-launch timeout.

Human saved-work ownership review remains pending. No account adoption, normal-root reset, actor launch, or physical campaign occurred. The separate driver-only path-binding fix is commit `4c1fe725`; product identity is unchanged. Its focused identity suite also passed on actual PC: **23/23**, no skips, from three exact Git-blob files in a fresh isolated diagnostic directory; the broader Mac identity/artifact-source run passed **42/42**.
