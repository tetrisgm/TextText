# Shared application full gate, October 18

`npm test -- --maxWorkers=4` passes all configured browser stages and Vitest: 578 test files passed, 30 optional files skipped; 5,084 tests passed, 157 optional tests skipped. Exit 0. Log `/private/tmp/texttext-shared-full-corrected-20261018.log`. TypeScript noEmit also passes in `/private/tmp/texttext-shared-final-typecheck-20261018.log`. Enabled local PostgreSQL receipt replay has its separate [receipt](2026-10-18-file-write-process-crash.md); optional skipped database tests are not counted as enabled DB acceptance.

Earlier broad runs exposed stale fixtures and one source-extraction test boundary:

- Template/note/folder fixtures now answer the current workspaceAccess transport command while retaining their held permission gate.
- The web assistant fixture serves the packaged mirror policy, retains prior epochs, and uses the real reconciliation function plus same-operation receipt replay. It asserts the approved external edit crosses epoch recovery instead of returning a fictitious epoch_changed refusal.
- The pre-ready callback fixture ends its extracted source before the new read-only inspection effect; 32 focused pre-ready/inspection tests pass.
- Feed subscription topic expectation now matches its canonical normalized tag, which the same test already expected to be lowercase. Product feed behavior is unchanged.

Failure logs remain `/private/tmp/texttext-shared-full-20261018.log`, `/private/tmp/texttext-shared-full-current-transport-20261018.log`, `/private/tmp/texttext-shared-full-refreshed-fixtures-20261018.log`, `/private/tmp/texttext-shared-full-epoch-aware-fixtures-20261018.log` and `/private/tmp/texttext-web-assistant-refresh-diagnostic-20261018.log`. Focused corrections pass in `/private/tmp/texttext-full-gate-fixture-corrections-20261018.log`. No timeout increase, guard bypass or production mutation was used to make these fixtures pass.

This gate covers shared source tests. Native move, private candidate build, installed acceptance and the current six-client matrix remain separate open gates.

Full enabled local PostgreSQL gate: `npm run test:db`, exit 0, 27 files/119 tests plus four scale tests. The orchestration first checked that DATABASE_URL resolves to loopback without printing its value. Log `/private/tmp/texttext-local-postgres-full-20261018.log`.
