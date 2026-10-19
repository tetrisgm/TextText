# Failed shared-open recovery and ordinary local editing

Source-only fix, awaiting the next installed candidate acceptance. The old installed Mac 1273 failure and its preserved original/image/recovery copy remain separate evidence.

## Changes

- A verified recovery copy closes a session that never created a shared client without accessing its throwing client getter. Successful recovery returns to the workspace; the action is labelled “Save a recovery copy”. Existing client journal retirement checks remain.
- An ordinary native `local_changed` before a client/lease opens closes that failed owner, reads the same item afresh, and uses the existing local editor and its local-file-durable close receipt. Later sync readiness promotes through existing shared-open guards. Explicit local handoff drafts, item/legacy drafts, and pending or unreadable browser journals retain their barriers, including draft rechecks after asynchronous reads.
- Reopen disposes the exact failed owner before acquiring another. No baseline/CAS/epoch guard or timeout was relaxed. Native pending journals are neither removed nor acknowledged; this is not a native journal recovery claim.

## Evidence

Actual production component/session/owner controlled Chromium regressions exposed the no-client recovery getter failure and initial baseline mismatch terminal state. Preserved RED logs: `/private/tmp/texttext-no-client-recovery-red-20261019.log`, `/private/tmp/texttext-initial-baseline-wait-red-20261019.log`.

Final product source checks exited 0:

- `--unopened-recovery`: `/private/tmp/texttext-failed-open-final-recovery-20261019.log`.
- `--initial-pending-baseline`: `/private/tmp/texttext-failed-open-final-baseline-20261019.log`; actual VaultApp trusted input, native close returns local-file-durable while baseline is unavailable, then fresh shared promotion.
- `--recovery`: `/private/tmp/texttext-failed-open-final-existing-recovery-sequential3-20261019.log`.
- `--copy-failure`: `/private/tmp/texttext-failed-open-final-copy-refusal-sequential-20261019.log`.
- TypeScript nonincremental check: `/private/tmp/texttext-failed-open-final-tsc-20261019.log`.
- Node registration tests: `/private/tmp/texttext-failed-open-final-registration-20261019.log`.

Earlier extra recovery controls failed fixture input assertions: the controlled checkpoint failure could detach the body during focus or between per-character input. Preserved final-existing-recovery/copy-refusal and sequential/sequential2 logs document these failures. The fixture now focuses before arming failure and sends the complete phrase through one trusted insertText event; product source was unchanged for that correction. The earlier 12-mode component matrix is prior-source evidence, not a final whole-suite claim. The full candidate will rerun registered checks against its coherent committed source.
