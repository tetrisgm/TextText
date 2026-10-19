# Default-off PC browser measurement inspection

Additive follow-up to the [native host adapter](2026-10-19-measurement-native-host-adapter.md). Browser ownership inspection is now implemented alongside native inspection, but **no genuine launcher sidechannel is wired and no campaign is activated**.

## Existing authority retained

`stress-browser-task.ps1` now verifies that the actual task ExecutionTimeLimit equals the genuine launcher's existing **TimeSpan.Zero**, in `OwnedTask` alongside its existing exact action/node/hash checks. The same owner is checked before inspection, through both collector callbacks, and again after inspection. Existing launch behavior, priority, mitigation and17feature settings remain unchanged. Zero prevents an OS timeout from killing guarded editors; validating zero is **not** a finite lifetime or cleanup guarantee.

The PC adapter accepts browser scope only with a separately pinned trusted launch record, including Edge runtime tuple/hash, driver/config/task/helper bytes and the exact Node launcher/child script bytes. It passes the trusted maxMs and merged features unchanged to existing `-Inspect`; native still uses `-InspectOwnership`. Both paths recheck captured inputs and fresh same-host collector proof. A process-local `-ExecutionPolicy Bypass` matches existing native/browser relays and applies only to the newly spawned collector invocation with pinned script bytes. No persistent policy/config setting changes.

Existing collector command deadline/output bounds remain. Deadline callback completion is bounded; termination is requested only through its own spawned handle. Timeout-path child exit remains unproven, with partial evidence retained. The successful inert-script test proves actual close/exit on that success path only. Samplers, Mac/file ownership, genuine producer/launcher sidechannels, final-series/phase coverage and physical T24 remain pending.

## Verification and preserved failures

- Mac relevant gate: **140 passed,3 explicit Windows-only skips,0 failed**, including adapter/supervisor/ownership, browser relay/emitter, lifetime/source checks and verifier registration. All five owned executable source hashes match before/after.
- Actual PC gate: **40 passed,0 skips/failures**. PowerShell parses the full current task script, extracts and executes its actual `OwnedTask` with stubbed task/file APIs: zero accepted; nonzero/malformed lifetime, changed action and changed node hash refused. Nine assertions within that test; no real scheduled-task/process query or runtime launch.
- The actual PC also runs the production bounded collector against a disposable inert script with the supported process-local policy flag: exit0/close observed, unchanged script hash, no task/browser/actor launched. Six copied source hashes match main and remain identical before/after the final gate.
- Earlier PC adapter fixtures used POSIX-only mock keys and failed on Windows path separators (22pass/17fail); the test store now normalizes only its mock keys. Production paths/guards unchanged. Original log retained at `/private/tmp/texttext-browser-host-pc-combined-20261019.log`.
- A standalone metadata hash-reader `.ps1` invocation without the relay's process-local policy flag was refused by existing execution policy. No policy was changed; Node performed that metadata read, and the adapter now uses the reviewed existing relay invocation. Initial proof files and controlled directories are retained.

Final evidence: `/private/tmp/texttext-browser-host-review-20261019/` (`test-final.log`, `pc-test-final.log`, source guards and PC bytehash guards). Earlier native-only tests remain separate evidence. New lifetime test registration is parent-owned in scripts/test-sync.sh; that script and sync/verify.test.mjs also contain unrelated pending lifecycle registrations and are not included in this six-path source manifest. No normal app, user fixture, account/profile or browser was touched.
