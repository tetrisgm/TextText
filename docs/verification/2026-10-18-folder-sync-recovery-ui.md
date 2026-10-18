# Shared saved-folder recovery

T13 Mac/Windows shared UI source slice, October 18. Native enforcement remains authoritative; this view never moves, deletes or overwrites files.

Recovery exposes a separate `folderSyncMoves` inventory, distinct from interrupted local rename metadata. Every row has the same fourteen required keys on Mac and Windows. Strict validation rejects future fields, unsafe paths, ambiguous identities, mismatched original commands and changed receipt topology. Completed results carry only their original moved receipt; unavailable rows have no invented server authority. Review and cancelled rows require their separate server inspection.

Opening a row requests a fresh native inspection. Explicit confirmation echoes the captured request hash, local inspection, server inspection and consent through the captured transport. A failed confirmation discards the inspection. Account/root changes, unmount and superseded requests cannot install an old result. The native bridge binds actual root/workspace/account across awaits. Windows overwrites caller scope with its captured native scope.

The UI offers cancellation only after server review, finishing a completed move, or keeping a verified cancellation receipt. It explains that cancellation preserves current files and restoring the original local spelling may still be necessary. Offline/unverified rows remain visible without a confirmation action. Successful acknowledgement refreshes both retained history and Trash while keeping Recovery open.

## Verification

- Focused schema/Windows transport: 11 checks pass; `/private/tmp/texttext-folder-sync-review-ui-unit-final-20261018.log`.
- Complete local-vault unit suite: 509 checks in 66 files pass; `/private/tmp/texttext-folder-sync-review-shared-full-20261018.log`.
- TypeScript passes; `/private/tmp/texttext-folder-sync-review-ui-tsc-final-20261018.log`.
- Actual isolated Chromium component/RecoveryDialog fixture passes; `/private/tmp/texttext-folder-sync-review-browser-final-20261018.log`. It covers review/completed/cancelled/unavailable, future/changed records, rejected consent and reinspection, captured transport, late old-account reply refusal, and history/Trash refresh. The only native calls are inspection and scoped acknowledgement, plus ordinary history/Trash reads.
- Light/dark screenshots were inspected at `/private/tmp/texttext-folder-command-recovery-{light,dark}.png`; neutral existing recovery styles, readable contrast, visible confirmation controls. The fixture is registered in manual verification.
- Manual verification helper: 8 checks pass; `/private/tmp/texttext-folder-sync-review-gate-helper-20261018.log`. New Mac folder propagation/profile suites are required by the native filter rather than silently omitted.

This is a real Chromium fixture with controlled bridge replies, not an installed app, real Safari gesture, server deployment, or six-client acceptance claim. Actual native recovery gates and real HTTP engine integration are separate receipts. No user data, production database or installed binary was changed by this slice.
