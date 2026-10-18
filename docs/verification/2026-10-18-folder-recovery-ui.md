# Folder name recovery UI

October 18, 2026. Source and isolated browser evidence; no installed acceptance claim.

The shared recovery dialog inspects interrupted directory case changes on Mac and Windows. A fresh native metadata read binds the operation ID, both paths and expected directory identity before displaying consent. Keeping the current paths acknowledges that inspection; this command does not move, restore, delete or copy files. Unknown fields, invalid hashes, duplicate operation IDs and changed operation bindings refuse consent. Unsafe paths display as unverified and cannot be acknowledged.

Both native bridges retain workspace/account checks. Recovery lists directory records before ordinary APIs because an unresolved directory intent fences normal registry reads and writes. While fenced, the response exposes folder records and empty file-recovery arrays. After acknowledgment the existing dialog refreshes history without closing. The Windows transport pins the original root, workspace and account for list/read/resolve; a caller cannot override them. Native scope checks remain authoritative.

## Shared verification

- Full local-vault suite: 506 tests across 65 files passed. `/private/tmp/texttext-folder-local-vault-full-20261018.log`.
- Three focused Vitest files: 29 tests passed. `/private/tmp/texttext-folder-shared-unit-20261018.log`.
- TypeScript check: exit 0. `/private/tmp/texttext-folder-shared-tsc-20261018.log`.
- Actual Chromium fixture: exact scoped metadata consent, refusal and fresh reinspection, malformed/future/changed/blocked and unverified records, captured transport, stale account reply isolation, and open-dialog history refresh. `/private/tmp/texttext-folder-rename-recovery-browser-final-20261018.log`.
- Light and dark screenshots inspected: `/private/tmp/texttext-folder-rename-recovery-light.png` and `/private/tmp/texttext-folder-rename-recovery-dark.png`.

Native restart, filesystem race and profile compatibility evidence is recorded separately. Metadata inspection is bounded and copies no file contents. This does not establish an atomic snapshot against arbitrary external filesystem writers or power-loss guarantees. Installed Mac, installed Windows and physical six-client acceptance remain pending.
