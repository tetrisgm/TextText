# Native account checkpoint boundary, October 17

T07 source work; not activated in installed native clients.

Both checkpoint adapters now accept an immutable optional stable account ID. A supplied identity must match the embedded journal before materialization or interrupted-intent replay. Another account cannot claim pending or unbound legacy work. Original raw checkpoint and file bytes remain available to the original account. Clean acknowledged baselines can start a fresh stream only after an identity/hash check and archival of the original journal bytes.

Mac adds pending-owner, interrupted-intent and clean/legacy transition regressions. Windows adds pending-owner, forged renderer principal, original-owner restart and clean/legacy transition regressions. No bearer value is persisted as a principal.

## Verification

- Before: new Mac and Windows pending-owner regressions failed at the account refusal assertions.
- After: `bash scripts/test-sync.sh --native-only` passed. Mac required suites executed 100 tests (one environment-dependent no-space skip) plus 40 agent tests, with zero failures; portable Windows core passed. Log: `/private/tmp/texttext-t07-native-account-gate.log`.
- Exact-source Windows core passed on the physical PC, including the final raw-byte archive refinement. Log: `C:\Users\Shokunin\dev\texttext-t07-checkpoint-account-final.log`.
- Real disk-full tests remain covered by the [adapter receipt](2026-10-17-adapter-conformance.md).

## Remaining boundary work

Native sessions still use the legacy unbound default in production. Stable credential identity discovery/cache, actor and request plumbing, root/outbox ownership, explicit legacy adoption and physical account switching remain open. Background metadata readers are not principal-scoped. This unit does not complete T07 or authorize claiming old work during upgrade.
