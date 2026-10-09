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
Oracle deployment of this change remains pending; installed-client evidence below.

## Previous reader-recovery deployment completed

Oracle now serves `texttext-oracle-20261009T020822Z-ee7292ad`. Full web-only
verification, database/sync checks, production build and archive checks passed.
The immutable verified archive deployed; thirteen authenticated live checks
passed, previous release retained. All four TextText/Algorave services are
active. HAProxy mtime remains `2026-10-01 00:11:31.941901734 +0000`.
Actual Safari reload reopened `Finder photo share 1231`, signed in, with image
controls and live Mac presence. A transient connection message cleared without
Retry. Logs: `/tmp/texttext-reader-recovery-{web-verify,oracle-deploy}.log`.

## Installed clients

Mac **0.204 (1232)**, source `2e0e10c1`, passed exact-source core/native checks,
signing, replacement and signed-in startup. Prior saved image reopened intact.
Created `Notes/External file collaboration 1232.textpack` with the CLI, identity
`351e446b-b891-4d52-a0ae-c7811fa4af8f`. Command K found it. A CLI append appeared
in the already-open native reader without reopen. Safari opened the same file.
Native typing appeared in Safari before Finish/Save. After Finish, independent
CLI read contained both exact markers, and the physical Windows ZIP contained
the same identity plus both markers. No transfer latency was measured here.
Logs: `/tmp/texttext-mac1232-{build,install}.log`.

Windows source `2e0e10c1` passed native/core/agent tests, 346 shared tests,
TypeScript and actual interactive WPF/WebView smoke. Candidate
`candidate-bac01f7e399b41c4a17890bc25a208c1` and staged receipt verified.
All six current native checkpoints were neither pending nor retired before
stopping the exact canonical process. Previous app retained at
`TextText-previous-20261008T192102-ab35f378`. Canonical new app responds in
interactive session 1 (PID 43856); temporary launch/smoke tasks removed.
No user data was removed. Owner-window visual recovery remains unverified.
