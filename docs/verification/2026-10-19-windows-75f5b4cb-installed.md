# Windows 75f5b4cb installed

Installed frozen product `75f5b4cbc9501d0eabd55eff0851ffd46c0cca80` using its unchanged supported installer, after the [candidate gates](2026-10-19-windows-75f5b4cb-candidate.md) and explicit install approval. Candidate `candidate-38a6974777814447a9912bc6d0645cbf`, staged and installed receipts verified. Installed EXE SHA-256 `0cfbc2e5f2e716140436999fcbb5e92221e92d7e735aae9f6dd18c44cb852558`; verification receipt SHA-256 `48a0ff3e2d7ed9044ecc0f699b797867b0eb13680e57db036a2d4e7771c06549`. EXE, main/Core DLLs, UI and policy bytes exactly match the verified candidate.

Immediate preinstall checks reverified stopped normal state, prior af7 EXE `dec1e578…`, candidate/source receipts and stable backups. The prior af7 app remains at `Programs/TextText-previous-20261019T091218-c3d5fc7c`; all earlier app copies and backups remain preserved.

Fresh private backup `before-75f5-stopped-67185c278e9e4ebc9e404dbe54f4a550` contains legacy vault/device state and current installed app, with protected current-user/SYSTEM ACL and before/copy/after checks. App: 429 files, 548,219,056 bytes, stamp/hash inventory `03c59eb31e9069c5049c4392339b29f5682022e2bd668d8197001b783e920f61`. Opaque account.dpapi was copied without decoding or logging contents; optional selection/location metadata was absent, and alternate legacy state was empty. The initial read-only inventory refused an absent optional Locations file; the corrected probe recorded absence without creating it.

One-off Interactive normal startup used no arguments, profile/root override or forced timer. Actual PID 45476, session 1, start `2026-10-19T16:12:32.5061361Z`, responded with the exact installed EXE. The initial 15-second MainWindowHandle-zero refusal remains recorded. Same-session read-only UI Automation then proved the actual saved-work modal and visible enabled Keep saved work/Open folder/Cancel buttons.

Only exact Cancel was invoked. Device-state bytes were unchanged afterward; one normal CloseMainWindow returned true and the process naturally exited by `2026-10-19T16:13:40.1893958Z`. No Keep, adoption, reset, content edit, fabricated consent or force termination occurred. Owned launch/probe/cancel registrations were removed.

Final receipt and artifact checks passed. Legacy work remains byte-identical: 1,110 files, 103 directories, 7,340,498 bytes; inventory `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`. A fresh post-close opaque metadata copy matched preinstall bytes. Final security reports zero matching 4625/4740 events, no owned child/normal process, and mitigation retained. Human saved-work ownership review remains pending.

This proves installation and guarded normal startup/close. It does not prove normal-root editing, an installed image-import scenario, six-client acceptance or T24 completion. Runner-only commits remain separately pinned.

Private evidence: `/private/tmp/texttext-pc-frozen-75f5b4cb-20261019-retry3` and the same PC Temp basename: `normal-install-plan.json`, `installed-artifact-proof.json`, backup summaries, `initial-launch-refusal.json`, `normal75-process.json`, `normal75-window.json`, `normal75-cancel-result.json`, `installed-postflight.json`, `installed-final-safety.json` and `installed-final-legacy-backup.json`. Backup contents stay private.
