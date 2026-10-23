# Foreground sync checkpoints: prepared for installed verification

Native change `41959359` addresses observed dispatcher construction and sync-gate
waits. Shared UI change `317aab3c` addresses stale bootstrap errors and status
responses. These checks establish source behavior; installed targets remain open.

Sync now yields to queued readiness/editor admissions only after existing
recovery/capability validation and at completed operation boundaries, with an
exact persisted-state check. It releases through the existing finally path and
reloads state on the next pass. It never yields inside download/apply or
upload/acknowledgement. A bounded credit prevents repeated foreground reads
from starving queued uploads. The worker retains its full-pass retry obligation
through busy/deferred retries and does not report those as completed sync.

One serializer serves connection events and reads, preserving conflict and
authentication states. Remote-response diagnostics increment only after an
actual manifest response; they do not claim upload or full-pass completion.
Scheduling failures remain fenced and become observable. Initial bridge
construction runs off the dispatcher, with stale/cancelled candidates joined
and retired. Listing avoids its redundant sync-gate wait; path inspection keeps
reparse/cloud checks while reducing repeated attribute calls.

UI reads clear only their own recovered error. Late initial connection responses
cannot overwrite newer status; unrelated events cannot erase action failures.

## Checks

- PC full Core: 1,820 assertions, exit 0.
- PC full Windows bridge: 193 assertions, exit 0.
- PC WPF compilation: zero errors; two existing NU1510 warnings.
- Mac full integrated Core and Windows portable suites: both exit 0.
- Actual production renderer regressions: eight cases passed on PC and Mac.
- TypeScript and whitespace checks passed.

Baseline controls reproduce stale status/errors, blocked foreground admission,
unbounded-priority upload starvation and lost rerun after a busy retry. Corrected
tests cover the actual readiness-to-editor bridge path, repeated reads with an
exactly-once upload, state reload, cancellation, and preserved bytes.

Mac logs: `/private/tmp/texttext-integrated-focused.EShMuP/core.log` and
`windows.log`. PC logs:
`%TEMP%/texttext-phase2-fullchecks-01b74168126844d1a31a2e0f5f94b7d3/`.
Initial isolated test setup failures (missing dependency/fixture copies) are
retained; they were corrected before the complete passing runs.

Next: unified release, five actual Windows launches with listing and restored
editing each under three seconds, plus real exact-content remote convergence
and normal quit/reopen. No journals, retained conflicts or recovery guards were
removed. Mac actor reentrancy differs from the Windows pass semaphore; no
unproven cross-await scan cache was introduced.
