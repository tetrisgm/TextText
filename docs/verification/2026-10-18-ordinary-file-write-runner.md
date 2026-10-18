# Ordinary file writer runner preparation, 2026-10-18

Status: source and real filesystem unit evidence only. No six-client physical pass.

`fileWrites` selects one CLI actor, in-place or atomic mode, 1..8 writes and a
10..250 ms interval. Total accounted suboperations are bounded to 600. Each
write has a unique planned chunk and role-bound ordinal ID; one final role marker
completes the logical round operation. Convergence removes chunks independently,
allowing CRDT interleaving, and requires all six full canonical snapshots plus
exact asset pins. Independent reopen binds both document/body hashes and the
exact writer scenario. Other editor sessions retain their existing continuity
requirements. No native source changes or candidate builds were needed.

Every attempt backs up its observed preimage. In-place opens r+, verifies the
same inode/preimage and owner binding, truncates/writes/fsyncs, then verifies exact
readback and unchanged assets. Atomic mode fsyncs a temporary file, rechecks its
observed preimage and renames, then verifies the changed file identity/readback.
There is no rename fallback for in-place mode. Contention retries are bounded;
precondition failure preserves newer external bytes. Failures after mutation
retain confirmed writes and the uncertain attempted phase/byte count, with all
backups. No automatic repair hides a failed incomplete write. File-content fsync
is not a claim about whole-machine power-loss directory durability.

## Evidence

- Five real Mac filesystem tests cover both modes and each accepted fsynced
  readback/asset digest, external replacement at the precondition fence, injected
  second-write post-truncate failure, refused role/ordinal/inode/readback evidence,
  and reused-marker refusal before another destructive write:
  `/private/tmp/texttext-file-writes-unit-final-20261018.log`.
- Four coordinator cases cover all-six full-state/suboperation accounting for
  both modes, invalid evidence, retained partial prefix and interleaved chunks:
  `/private/tmp/texttext-file-writes-coordinator-20261018.log`.
  These process adapters are explicitly simulated and never count as physical.
- Related adapter/source tests passed 26 tests:
  `/private/tmp/texttext-file-writes-adapter-unit-20261018.log`.

The physical campaign, malformed metadata variants, whole-pack creation,
move/delete/restore/stale writer cases and actual close during concurrent peer
traffic still require their own receipts. Existing closeProbe is normal close
after converged rounds, not a close-during-traffic test.

Final exact current stress suite passed 125 tests, zero failures/skips in 41.516
seconds: `/private/tmp/texttext-file-writes-checkpoint-20261018.log`. This includes
full-document/mode receipt binding on reopen. Source was stable through the gate.
