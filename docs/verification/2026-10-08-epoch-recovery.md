# Retained editing epochs

The preserved Windows fixture A contains both an accepted batch whose ACK was
lost and one later pending update. Its last acknowledged revision is
`bd01a564078864a0b29fd4a36a536fc5e58728eba705ea445e523aae2311b15f`.
The operation receipt for `e7d58ad9-1c7a-4826-bf79-c0d43c5bf959` points to
`02bac165e421cc18139376066fcb17e791b73b5f615c361864679f77aa69d04a`.
Read-only comparison demonstrated that merging the old acknowledged TextPack,
full pending snapshot and current file duplicates the accepted PC marker.
Replaying text snapshots is therefore insufficient evidence for safe recovery.

## Candidate

Before invalidating or replacing an epoch, the store now durably retains its
binary Yjs state and revision under
`.texttext/collaboration/<item-id>.epochs/<epoch>.json`. This is one record per
replaced epoch, not a new full snapshot for every keystroke. File and directory
fsync complete before invalidation. If a crash leaves retention durable but the
epoch live, a later boundary refreshes the record with the latest accepted state.
Deletion marks a permanent barrier, including deletion after prior invalidation;
restoration also fences a checkpoint left by an older installation.

The pure recovery engine first merges the offline binary state into the retained
authoritative Yjs state. This deduplicates acknowledged operations and includes
accepted edits the offline writer never saw. Only then does it reconcile against
the new epoch, preserving current pack assets and metadata. It refuses to skip
epochs or cross a deletion barrier, and returns no writable result for conflicting
replacements. Each recovery crosses one boundary; a future caller must walk every
retained boundary rather than assuming an old epoch belongs to the current life.

Final core verification passed 862 tests, TypeScript and all three browser
continuity modes, with an exact-source receipt in
`/tmp/texttext-epoch-recovery-core-final.log`. The focused tests reproduce lost
ACK duplication, unseen accepted work, concurrent later appends, conflicting
replacements, deletion after invalidation, and an interrupted retention attempt.
The initial core run refused an attestation because source changed during it;
only the final run is the passing receipt. No Oracle deployment yet.

## Authorized server operation

The existing collaboration POST now accepts `operationId`, `epoch`, and
`recoveryUpdate` (the retained complete binary Yjs state encoded as base64),
mutually exclusive with ordinary `updates`. It uses the same fresh edit
authorization and app-token attribution checks as normal editing. The store
walks every retained boundary under its lock, prepares the final result, then
uses its existing durable intent, audit and idempotency receipt path. A retry
after another writer edits returns its original receipt without rewriting the
newer content; authorization is rechecked even on that receipt path.

Missing history, a deleted lifecycle or conflicting content return explicit 409
recovery codes. No candidate file is committed for those cases. Traversal is
bounded to 64 epochs per request; it never silently skips missing boundaries.
The focused store/route tests passed 40 checks in
`/tmp/texttext-recovery-write-focused.log` before the final additional retry
revocation assertion. The final shared core gate passed 865 tests, TypeScript
and all three browser continuity modes with an exact-source receipt in
`/tmp/texttext-recovery-write-core.log`.

## Remaining integration

The client still needs a stable recovery-operation journal, durable replacement
of the pending journal, and native lease adoption before automatic reopening.
The endpoint is not called by the client yet and is not deployed. Archived
states do not exist retroactively for the older Windows fixture; its original
journals and history remain unchanged.
Do not clear that journal or label the Windows failure resolved from these tests.
