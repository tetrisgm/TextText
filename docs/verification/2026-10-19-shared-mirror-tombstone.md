# Shared mirror tombstone policy

Source integration only. No installed app, live workspace, account, or deployment changed. This does not establish six-client physical acceptance.

## Contract and native boundary

One strict 17-field policy decides `defer`, `no-local`, `remove-local`, or `retain-conflict`. Removal requires a unique verified identity, exact local/baseline hash, all three exact paths, baseline/remote revision, and **known equal** retained/remote lifecycle. Unknown generations preserve content. `no-local` is not metadata acknowledgement. Hashes require exactly 64 lowercase hexadecimal characters, including rejection of a trailing newline.

Both native adapters revalidate captured local bytes, identity, durable protection state and authority after the policy await; removal/conflict additionally requires a fresh unchanged remote item. Native protection inspection reads bounded existing records without recovery, following, publication, or directory creation. Explicit Windows tombstones precede generic protected-path following and pending rename retirement.

Mac projection identity indexes can legitimately drop absent paths during the normal scan. The invariance assertions concern durable baseline, lifecycle, outbox, conflict, deletion intent, and retained checkpoint records; they do not claim all sync-state bytes are immutable for every case. The Windows pending-rename case does additionally prove exact complete state bytes unchanged.

## Test-first evidence

The separate actual native RED fixtures demonstrated four weak Windows cases (stale revision, moved path, unknown generation, changed generation) and two weak Mac cases (unknown/changed generation), including restart. Historical bytes remained retained in every case: this was unsafe projection removal, not demonstrated data loss. Original native RED summary: `/private/tmp/texttext-mirror-tombstone-native-red-summary-20261019.json`, SHA-256 `cc90cebca6217580d19c3ef839a0089163954a92d18b4f5c42a4c3adb7999b3a`.

A separate passing pre-integration actual-PC gate ran 1169 checks without the tombstone fixture. Neither RED run is relabelled as passing.

The first broad Mac integration run found an older positive fixture expecting removal without lifecycle proof. Its exact failure was captured in the tool transcript; its local log was inadvertently overwritten by the rerun. The corrected fixture obtains a lifecycle-bearing pack through the production download path and preserves that lifecycle in the controlled deletion response. Unknown-generation negative tests remain.

## Verified gates

- Pure policy and host: 32 tests pass, including strict envelope/echo/schema and malformed hashes.
- Actual packaged Chromium policy host: pass, including offline vectors and reload fencing.
- Actual WKWebView host: 3 tests pass with the newly packaged tombstone vectors.
- Mac relevant Sync, SharedEditing, tombstone, shared-path, profile and protected-transport suites: 145 tests, 4 existing optional skips, zero failures. Tombstone suite: 10 tests, zero skips.
- TypeScript: `tsc --noEmit --incremental false` exits zero.
- Windows portable policy/native fixtures: pass, including a production-created pending immutable shared rename after controlled lost reply. An absent tombstone preserves exact state, checkpoint and intent bytes without replay or recreation.
- Actual-PC full Core intermediate snapshots: 1323 and 1333 passing checks. Each used a fresh exact committed archive plus named hashed overlay, `--no-incremental`, compiled artifact/host hashes, and identical source proofs before/after. Final exact-source actual-PC full Core gate passes **1337** checks, exit zero. Evidence: `/private/tmp/texttext-tombstone-pc-green-20261019-mzaryryd/result.json`, SHA-256 `721f9e5f0be0e81c5d85de17a57fabe0f4f3abb8d3de5335cef168baa035851f`. Its 3200-file source proof is identical before/after.

Reachable await cases include changed local hash, duplicate identity, remote restore, authority revocation, and native journal/checkpoint publication. Mac additionally opens a real editor during the policy await. Windows same-engine editor activation is serialized behind the sync gate; its actual already-open editor deferral is tested instead. No impossible race is claimed.

Absent projections preserve actual pending upload/conflict, deletion intent and closed checkpoint records. The separate pending-rename fixture exercises the nonempty immutable rename map. Malformed/future retained checkpoint inspection refuses without rewriting bytes.

Raw logs use `/private/tmp/texttext-tombstone-*20261019*`. All Swift gates restore the exact original owner `Package.resolved` bytes, SHA-256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. Actual-PC normal process and user state remain untouched.
