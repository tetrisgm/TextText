# Adoption storage refusal and writer fences, October 17

T17/T07 source prerequisite. No user folder or installed app was migrated.

Manual runners create and fill only their own marked tiny disk images. Both platforms fill the image after publishing the adoption intent, observe a real out-of-space error on replacement, verify unchanged original state/checkpoint/projection and blocked ordinary replay, reclaim space and resume the exact pending operation. Original metadata backups remain intact.

- Mac: `python3 scripts/test-checkpoint-nospace-mac.py --adoption`, exit 0. Latest log `/private/tmp/texttext-t17-adoption-writer-nospace.log`; retained image/receipt directory `texttext-checkpoint-enospc-yg49clxq` under the Mac temporary directory. The runner detached its image.
- Physical Windows: `windows/scripts/test-checkpoint-nospace.ps1 -Scenario adoption`, exit 0. Log `C:\Users\Shokunin\dev\texttext-t17-adoption-nospace-retry.log`; retained image/receipts `C:\Users\Shokunin\AppData\Local\Temp\texttext-checkpoint-enospc-9487a9ed2a804263955b5e97ee8d6eb2`. The runner detached its image. First attempt preserved work but its harness retained the filler handle, preventing reclamation; closing/removing only that owned file fixed the harness.

Mac sync actors now retain a shared OS adoption lease for their lifetime. Windows editing leases retain an equivalent shared handle; the adoption transaction already holds the exclusive sync lock. Adoption refuses before publishing an intent while these writers remain alive. Releasing the writer permits explicit adoption; legacy actors cannot reopen adopted state under an unbound identity. No lock-file deletion is used for takeover.

Full native gate including live-writer exclusion: `bash scripts/test-sync.sh --native-only`, exit 0, `/private/tmp/texttext-t17-adoption-writer-native.log`. 37 app tests, 116 kit tests (three explicit helper/manual skips), 40 agent tests and Windows core pass. The Mac real disk-full case was repeated after the lease change. This does not complete T09 cross-process editor ownership or background policy consolidation. Consent/current authorization UI and profile recovery are still required before installation.
