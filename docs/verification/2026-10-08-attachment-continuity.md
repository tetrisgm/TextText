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
reconciliation, or the six-client acceptance requirement. Not yet deployed.


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
retired PC journal and has not yet been deployed.
