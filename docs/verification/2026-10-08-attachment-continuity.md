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
