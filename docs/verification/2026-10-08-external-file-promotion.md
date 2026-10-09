# External-file entry into live collaboration

## Root cause

`OpenVaultEditor` gated local-to-shared promotion on `awaitSharedMode`, which is
set by app creation flows. An existing or externally created TextPack opened
before its upload was acknowledged stayed in local mode despite later sync
notifications. Reopening could join collaboration, masking the defect.

The shared UI now checks every local editor on file/sync notifications. It
retains the existing serialized promotion, durable flush, draft checks, stable
identity and double revision read. No periodic timer or healthy shared-editor
polling was added. Native, Windows and web use this UI.

## Regression

The existing browser scenario was not wired into the required gate and its
fixture predated folder defaults and the relocated Publish button. It now runs
in the core sync gate for both app-created and externally created files. The
fixture handles folder defaults and waits for an actual shared session rather
than a removed button.

The old external-file path saved one local edit and opened zero shared sessions
after sync acknowledged it (`/tmp/texttext-external-promotion-before.log`). With
the fix, both modes pass: local typing survives promotion, no duplicate pushes,
no extra local writes, focus returns to the body, and subsequent external edits
in local-first and server-first arrival orders reopen cleanly without recovery.
Logs: `/tmp/texttext-{external,new-note}-promotion-after.log`.
TypeScript passed (`/tmp/texttext-external-promotion-types.log`). The required
core gate passed all 848 tests, TypeScript and both browser modes; exact-source
receipt saved (`/tmp/texttext-external-promotion-core.log`).

This is deterministic browser/bridge regression evidence. It does not certify
physical iCloud eviction, Windows owner-window behavior or latency percentiles.
Deployment/install of this change remains pending.

## Previous reader-recovery deployment completed

Oracle now serves `texttext-oracle-20261009T020822Z-ee7292ad`. Full web-only
verification, database/sync checks, production build and archive checks passed.
The immutable verified archive deployed; thirteen authenticated live checks
passed, previous release retained. All four TextText/Algorave services are
active. HAProxy mtime remains `2026-10-01 00:11:31.941901734 +0000`.
Actual Safari reload reopened `Finder photo share 1231`, signed in, with image
controls and live Mac presence. A transient connection message cleared without
Retry. Logs: `/tmp/texttext-reader-recovery-{web-verify,oracle-deploy}.log`.
