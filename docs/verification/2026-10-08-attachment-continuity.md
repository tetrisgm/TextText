# Attachment changes and live collaboration

A verified local-file upload used to reset the Yjs epoch whenever any opaque
TextPack entry changed. Adding an attachment therefore invalidated another
writer's otherwise valid pending text update. The regression reproduces epoch 2
where epoch 1 should remain (`/tmp/texttext-attachment-before.log`).

`projectVaultFileEdit` now treats entries under the validated pack's `assets/`
prefix as pack data, independent of text identities. Causal revision checks,
pack validation, document validation, identity checks and the other metadata
fences remain. A later text update preserves the current attachment entries.

The store regression runs attachment addition, replacement and removal while a
second Yjs writer has a pending insertion. Each insertion commits in the same
epoch, and ZIP inspection verifies the exact resulting asset bytes. A separate
regression retains the fence for unsupported opaque metadata. Focused tests:
24 passed in `/tmp/texttext-attachment-after.log`. Full core gate passed: 854
tests, TypeScript and all three browser continuity modes, exact-source receipt
in `/tmp/texttext-attachment-core-final.log`.

This does not resolve the older retired Windows journal, template metadata
reconciliation, or the six-client acceptance requirement. Deployed with f4b8472f; see delivery below.


## Native CLI retry receipts

Read-only Oracle inspection of the failed PC fixture confirms server epoch 2,
sequence 1, while Windows retained epoch 1. Its acknowledged base remains in
server history. Comparing that base with the current pack found changes to
`text.md`, `document.json`, and an added `net.texttext.mutations/<hash>.json`.
The receipt is the native CLI's immutable idempotency marker; treating it as an
unsupported presentation change resets the epoch during ordinary CLI editing.

The store regression now opens collaboration before a CLI file write with a
receipt and pending human text. Baseline fails the epoch assertion
(`/tmp/texttext-receipt-before.log`). The candidate accepts only newly added,
bounded, correctly named receipts with a valid fingerprint; existing receipt
changes and unknown metadata retain their fences. The human update still
commits and both CLI/human content plus receipt bytes survive later mutations.
Focused tests pass in `/tmp/texttext-receipt-after.log`. Full core gate passes
855 tests, TypeScript and all three browser modes with an exact-source receipt
(`/tmp/texttext-receipt-core.log`).

This prevents the reproduced reset path. It does not clear or repair the old
retired PC journal.


## Oracle delivery and remaining recovery

Source f4b8472f deployed successfully as
`texttext-oracle-20261009T042315Z-f4b8472f`. The verified clean delivery ran
4808 web tests, 118 database tests and four scale tests, full core/native gates,
production packaging and authenticated live read/edit/retry/search/Trash/restore
checks. Receipt: `/tmp/texttext-f4b8472f-web-deploy.log`. Previous release retained.

PC access works with the existing fleet key and `IdentityAgent=none`; no new
key or profile was created. Collected `continuity3319` receipt confirms 12
inputs and continuous editor DOM identity. The CLI actor did not start in that
run, so it is not simultaneous app/CLI evidence.

The older PC journal has one batch whose operation receipt already exists on
Oracle: an acknowledgement was missed. PC-only CLI text and server-only Mac
text also diverge. Recovery needs the accepted receipt's revision as its base,
not an assumed common snapshot. Pending journal bytes remain preserved.


## Concurrent direct-file appends

A reproduced failing regression showed two insertions at the same base position
returned a conflict in full-pack reconciliation. Full-pack merging now uses the
same deterministic remote-first insertion rule as the live document merger.
The regression combines a Markdown-only PC edit with a Mac document edit and
verifies both projections preserve both inserts exactly once. Overlapping
replacements and binary conflicts remain rejected by existing tests.

Focused tests: 59 passed (`/tmp/texttext-pack-append-after.log`). Full core gate:
856 tests, TypeScript, and all three browser continuity modes passed with an
exact-source receipt (`/tmp/texttext-pack-append-core.log`). This additional
change is not installed or deployed yet and does not itself recover old epochs.
