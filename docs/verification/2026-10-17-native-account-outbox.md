# Native upload queue ownership, October 17

T07 source unit, not installed. Sync actors accept an immutable optional account ID and persist it with newly created state. A verified account refuses mismatched or unbound existing state before starting transport work. Legacy unbound callers also refuse account-labelled state. Checkpoint stores created by the Mac actor now capture that principal; opening checks account ownership before interrupted checkpoint replay.

Regressions on both adapters queue an upload while offline, retain exact state/file bytes through another account's refused opening, then resume under the original account with the same operation ID and payload. An unbound legacy queue is refused unchanged rather than adopted by its next opener.

## Verification

`bash scripts/test-sync.sh --native-only` passed: required Mac suites executed 101 tests (one separately covered no-space environment skip), 40 agent tests, and the full portable Windows core. Log: `/private/tmp/texttext-t07-account-outbox-final-gate.log`.

Two failed harness runs remain in `/private/tmp/texttext-t07-account-outbox-gate.log` and `/private/tmp/texttext-t07-account-outbox-core-final.log`: the new Windows fixture first omitted the existing hash for replacement, then failed to catch the intentionally injected offline exception. The corrected fixture passed without relaxing production checks.

## Remaining

Production credential/session plumbing, root ownership and explicit legacy recovery/adoption must be coherent before native activation and delivery. Existing native callers still use the unbound default. The physical six-client/account switch and migration gates remain open.
