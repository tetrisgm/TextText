# Duplicate identity discovery

October 17, 2026. Bounded T13 / P4.4 server-store slice; full native identity matrix remains open.

## Invariant and change

Directory traversal must not select a winner between fresh packs carrying the same identity. Discovery now collects candidate paths before publishing an index entry. Two fresh copies are both diagnosed. An established indexed original remains authoritative while its path exists. When that path is missing and multiple replacements exist, discovery preserves the index, history and collaboration epoch without inventing a tombstone. Removing ambiguity allows the remaining unique file to be discovered.

The missing-path fallback for direct content, path and identity reads uses the same classification under the writer lock. Otherwise a read could retire the collaboration epoch despite the listing correctly refusing ambiguous files. Stable direct reads retain their existing fast path. Candidate bytes are reread and validated before indexing; discovery does not retain all candidate file contents in memory.

## Verification

- Four new parameterized cases cover both creation orders, two fresh duplicates and two replacements for a missing indexed original. They assert unchanged original bytes, index, history and collaboration metadata; repeated listing; direct reads during ambiguity; and direct-read recovery after ambiguity resolves.
- The extended direct-read regression failed before the fallback correction: 2 failed, 35 passed. Private log: `/private/tmp/texttext-t13-duplicate-read-before.log`.
- Corrected server suite: 37 passed, exit 0, `/private/tmp/texttext-t13-duplicate-discovery.log`.
- Independent root rerun: `node scripts/with-local-database.mjs node node_modules/vitest/vitest.mjs run src/lib/vault/server-store.test.ts src/local-vault/model.test.ts`, 55 passed, exit 0. Local Postgres only; `/private/tmp/texttext-t13-tag-review-tests.log`.

This source change is not deployed. Full folder, active-editor, offline and restart combinations remain T13 work. External writes are not serialized by the server's internal lock; this change does not claim an atomic filesystem namespace snapshot. No user files were migrated or deleted. Rollback is the source commit; no format migration is required.

## October 18: case-equivalent destination collision

A real case-sensitive scratch filesystem reproduced a separate move bug: two distinct files with case-equivalent names and identical bytes were collapsed into one instead of returning a collision. The preflight now permits an occupied canonical-equivalent destination only when both regular-file paths identify the same device/inode. A disappearing path cannot establish that alias.

The collision regression failed before the correction and the complete 38-test server-store suite passed afterward on a new isolated 128 MiB case-sensitive HFS+ image. Its owned `/dev/disk14` was detached; the image and red/green logs remain under the private scratch directory `texttext-case-sensitive-pvxet1x9`. A subsequent host-filesystem test verifies true case-only rename, exact bytes, final spelling and receipt replay; it passes and explicitly skips the distinct-file test on the case-insensitive host. Log: `/private/tmp/texttext-t13-case-alias-host.log`.

This covers a pre-existing destination. Concurrent target appearance and interrupted-move provenance remain separate boundaries.
