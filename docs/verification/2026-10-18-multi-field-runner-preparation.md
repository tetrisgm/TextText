# Multi-field runner staging, 2026-10-18

Status: source preparation with actual editor/browser integration; native
compile preparation passes. No six-client physical acceptance claimed.

The actual article editor uses `content.subtitle`, rendered as an existing
CollaborativeTextarea with aria-label `Subtitle`. Title/file stem remains stable
fixture/navigation identity. Product projection serializes subtitle as the
single-line `excerpt: <JSON string>` in text.md (`src/local-vault/model.ts`).

Staged helpers require two ordered role-bound operations (body then subtitle),
real input callbacks and complete per-field visibility/preservation evidence.
The first field must remain intact while the second changes. Partial failures
keep confirmed stages and the uncertain attempted field. Full accounting requires
all six canonical full DocumentSnapshots; strips only planned field markers,
preserves both baselines and rejects any unplanned title, fields, tags, assets,
template or presentation change. It allows CRDT order variation only when every
actor converges on that same complete state.

The ordinary external pack helper changes only the canonical text.md projection
excerpt, retaining document.json, projection baseline and binary entries exactly.
This deliberately requires production external-file reconciliation. It refuses
missing, duplicate or malformed existing excerpt metadata.

Ten helper tests passed, zero failures:
`/private/tmp/texttext-multi-field-staged-unit-20261018.log`.
These are unit fixtures, not real application/physical evidence.

## Actual observation surface

Root implemented the approved readonly inspection API in ed8bfae6, documented
in `docs/verification/2026-10-18-live-document-inspection.md`. It reads a validated
detached copy of the actual currentLocalDocument only while editable registration
is active. Actors bind the selected DOM/provider registration key, fixture,
account/root and visible body/subtitle before reading it. Native scoped keys are
actual `namespace:workspaceId:itemId`, not guessed raw item UUIDs. File actors
read complete document.json from the same ZIP sample as body and asset evidence.

The actual UnifiedDocumentEditor fixture passed in Chrome 155.0.8059.84:
`/private/tmp/texttext-multi-field-editor-fixture-20261018.log`. Two trusted
keyboard input events changed body/subtitle, retained the mounted body and hidden
fields/tags/presentation, proved detached inspection cannot mutate the editor,
and verified permission/unmount cleanup. This is an actual mounted editor fixture,
not deployed/native/six-client acceptance. Fixture source:
`sync/stress/multi-field.browser.mjs`.

Coordinator source checks all six complete snapshots, twelve field suboperation
IDs per round, three consecutive complete semantic samples and both body/full
snapshot hashes on independent reopen. Partial failure retains confirmed field
progress and the uncertain attempted field. File owner binding is rechecked per
operation and at the final replacement guard. Native build/actual physical
journeys and the remaining T22 scenarios still need their separate receipts.

## Native compile preparation

Actual-PC LiveAcceptance-only build passed in 1.93 seconds, zero errors and one
existing NU1510 warning: `/private/tmp/texttext-multi-field-pc-compile-20261018.log`.
Only actor source was backed up/replaced. Current Core and existing MainWindow
DLL hashes were unchanged before/after and matched the actor runtime copies.
Actor source SHA256:
`4453ddab049e0f11f89d04f2955158d4e916d2d00645b84eea712115ad100e0a`.
Actor DLL SHA256:
`acbc3c54f6810fe6a9942ea8bcd9ebeba4f05c7817d8b19c9807ab5015d29848`.
No native actor was launched. Mac actor source typechecked in the coordinated
35-test focused native gate (stress actor flag included):
`/private/tmp/texttext-shared-verify-parent-symlink-green-20261018.log`.
A combined full gate is coordinated with the active
retained-move source work.

Accepted full snapshot copies are retained only for the dedicated fixture in
`adapters/<role>.last-document.json`. Each can be independently rehashed against
`finalDocumentHash`; raw account credentials are not part of these documents.

## Final JavaScript checkpoint

The exact current full stress suite passed 108 tests, zero failures/skips in
37.368 seconds: `/private/tmp/texttext-multi-field-final-exact-20261018.log`.
This includes full-snapshot capture rehashing for all six roles, wrong/missing
actor evidence, visible body/full snapshot mismatch, failure-prefix evidence,
full document reopen pin rejection, ordinary guarded two-field file replacement
and owner-binding change refusal. Simulated coordinator runs retain acceptance
`none`. These tests and native typechecking do not complete T22 physical runs.
