# Browser normal-close runner slice

T21 source/driver preparation, October 18. No physical six-client campaign,
installed candidate delivery, account mutation or new background job is claimed.

`browserClose:{role:"mac-web"|"pc-web",round:1}` selects one isolated plain-append
round, or an independent zero-round reopen with the same scenario and successful
prior physical receipt. Other input/fault combinations are refused. All six
actors first acknowledge their visible input. The selected browser then closes
its actual page through `runBeforeUnload:true`, observes normal context close and
exit of its exact owned browser PID using signal 0 only, and reopens the same
persistent profile without another login exchange. A different observed browser
PID, the same profile hash, generation 2 and fresh actual source/account/session
attestation are required. The other five actors remain mounted. Existing exact
marker/baseline/asset accounting and three stable convergence samples still
apply. This is input-before-close coverage, not forced dirty-journal timing,
offline close or lost server acknowledgement coverage.

## Guarded and uncertain outcomes

A beforeunload dialog is dismissed to preserve the page, and the run fails. The
actual adapter enters a retained error state, accepts no further mutations and
reports verified driver/browser/profile ownership while the page/context remain
live. The coordinator never sends shutdown, closes stdin or signals that actor.
It detaches its own pipe handles; the retained driver keeps the browser alive
until the owner reviews pending edits and closes that browser. Other actors stop
normally. Console output and `summary.json.retainedActors` identify the retained
processes. This is a human-invoked failed acceptance process, not an installed
watcher or scheduled job.

A request that times out or loses its reply could already have reached that
guard. From request dispatch until fresh successful proof, failure therefore
retains the known adapter child even without a parsed refusal. The report marks
browser ownership unverified and never invents a browser PID. An already exited
child is reported as unavailable with its recorded exit, not as a live retained
browser. Unknown outcomes do not authorize generic cleanup escalation.

## Verification

- Pure production-helper and adapter tests cover exact profile/PID qualification,
  normal close with no kill signal, dismissed guard retaining page/context,
  malformed evidence, and bounded waits.
- Coordinator tests cover isolated configuration, exact six-operation accounting,
  missing/false close proof, no forced cleanup after a proven guard or an unknown
  real close outcome, and independent-reopen scenario pins.
- The isolated real Chromium fixture uses keyboard input and persistent content,
  observes normal close and new-process same-profile reopen, and keeps an
  independent peer mounted. A separate fixture parent uses the production
  `ProcessAdapter.retainForReview` and exits: its guarded child driver and browser
  remain alive, with a subsequent heartbeat proving the page/context are still
  present. Only an explicit disposable-fixture cleanup flag then closes them.
  Production runner code has no such cleanup flag.
- Actual Chromium log:
  `/private/tmp/texttext-browser-normal-close-chromium-second-20261018.log`.
  It reports `acceptance:"none"`. The first attempt's about:blank peer fixture
  lacked `crypto.randomUUID`; that harness failure remains recorded separately
  and the peer session probe was corrected.
- The first full Node runner gate passed 157/157. After adding unknown-outcome
  retention and independent-reopen pin tests, the final full runner gate passed
  **159 tests, zero failures, zero skips**, exit 0, in 58.54 seconds:
  `/private/tmp/texttext-browser-normal-close-runner-final-second-20261018.log`.
  Twelve affected runner/test/README SHA256 values matched exactly before and
  after: `/private/tmp/texttext-browser-normal-close-runner-final-second-20261018-source-before.json`
  and `-source-after.json`. The actual Chromium helper/adapter source is unchanged
  from its passing fixture; the later additions concern coordinator uncertainty
  retention and reopen validation.

Real Chrome/Edge on the coherent deployed candidate, guarded real TextText page,
all six simultaneous participants, separate durable reopen and the remaining
transport/lifecycle scenarios still require physical acceptance. An isolated
browser page and simulated coordinator never substitute for those checks.
