# Windows agent creation durability

Source `0428bfca`. The native host assigns a stable creation operation to each
model call, distinct from renderer request IDs and reused UI task IDs. The native
store persists the original intent, identity, destination and complete package
before publication. Retries attest committed completion, follow a moved identity
without reverting later edits, reject changed intent and recheck authorization.
Committed records compact the extra package; deleted items are not resurrected.

Mac verification passed: 57 shared transport tests, native Core and Agent
regressions, TypeScript, and Windows shell compilation with zero warnings/errors.
The native tests include interrupted publication, regenerated retry bytes,
renderer restart, repeated model call identity, later edits, interrupted receipt
compaction, missing completion attestation and future-version refusal.
Logs `/tmp/texttext-windows-creation-{js,core,agent,types,shell-build}.log`.

Actual PC build and interactive desktop smoke exited 0. Candidate:
`C:\Users\Shokunin\dev\texttext-client-0428bfca\windows\build\candidate-7dc177d445f94537aa06dfa4c326b748`.
Smoke receipts:
`C:\Users\Shokunin\dev\texttext-client-0428bfca\windows\build\smoke-receipts-64d79a153ab348f59e548828f2ca293d`.
Build log `/tmp/texttext-windows-0428bfca-build.log`. Packaging is self-contained
WPF with the shared UI and bundled official Codex runtime; Node is build tooling.

Not installed: existing installed process 44968 remains responding, with unknown
unsaved state. No force termination or user-content replacement was performed.
These regressions and isolated desktop smoke do not certify installed account
startup, real model creation or cross-client production acceptance.

The preceding folder-review source `0c71652e` passed all 22 release checks;
[exact receipt](2026-10-08-folder-review-release-gates.json). The newer source
requires its own full release receipt before delivery.
