# Browser crash runner preparation, 2026-10-18

Status: source/driver preparation. No TextText or six-client physical pass.

Browser restart now uses CDP to bind the owned persistent context's actual browser
PID to its exact configured profile immediately before SIGKILL. Both actual PID
exit and browser disconnection are required before relaunch. The same profile and
channel reopen with a fresh session/generation and fresh source/build/assets,
browser runtime and account principal attestation. No saved-app login exchange
runs during restart. Full expected identity pins and the next observed editor
session must match. The other five actor sessions remain under existing strict
continuity checks. Profiles are never deleted or repaired as a fallback.

Chrome requires explicit `--enable-automation` for command-line proof. The first
real fixture correctly refused without that proof; the owned launch now supplies
the flag. There is no process-name or guessed-PID fallback.

Offline plus restart explicitly reconnects by restart: the new process loads
online, allowing its persisted journal to recover. It does not claim an offline
reload. Plain kill/restart without an offline role/round does not prove pending
upload state. Simulated coordinator tests always retain acceptance `none`.

## Evidence

- Four deterministic lifecycle tests cover ownership/PID/profile refusal, missing
  CDP, changed PID before signal, and rejection of disconnection without PID exit:
  `/private/tmp/texttext-browser-lifecycle-unit-exact-20261018.log`.
- Three coordinator cases cover held offline browser restart, rejection of
  graceful-close/false-offline evidence, fresh source/build/principal/runtime/
  asset pins and the exact attested replacement editor session:
  `/private/tmp/texttext-browser-restart-coordinator-exact-20261018.log`.
- Actual Chrome 155.0.8059.84 crash fixture passed:
  `/private/tmp/texttext-browser-crash-journal-fixture-exact-20261018.log`.
  Real keyboard input was held offline in a persistent IndexedDB journal with
  strict transaction durability. The owned browser was SIGKILLed, its actual PID
  disappearance verified, and the same profile reopened under a different PID.
  Journal text recovered and reached the local fixture receiver exactly once.
  An independent peer browser retained its mounted element/session. Temporary
  fixture profiles were preserved. This is browser-driver/storage evidence,
  not a TextText journal, authenticated product account or six-client sync test.

No native sources or candidates changed in this slice. Current attested physical
runs, browser close during traffic and the remaining T22 lifecycle/file/fault
matrix still require separate evidence.

Final exact current stress JavaScript suite: 115 passed, zero failures/skips in
39.887 seconds, `/private/tmp/texttext-browser-restart-checkpoint-20261018.log`.
The final driver/lifecycle focused suite also passed 12 tests:
`/private/tmp/texttext-browser-restart-driver-final-20261018.log`.
Only allowlisted crash evidence enters receipts. Source remained frozen during
the final full suite. No native compile is required by this JavaScript-only slice.
