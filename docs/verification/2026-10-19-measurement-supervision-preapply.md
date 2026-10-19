# Default-off measurement preapply boundary

Source-only, October19. New `sync/stress/measurement-supervisor.mjs` and its test; no coordinator, actor, task or host activation. This is not physical T24 evidence or production-ready measurement.

Enabled supervision accepts configuration budgets, not actor PID claims. Trusted executable launcher/OS adapters must independently verify genuine launcher/config/seal provenance; actor-supplied JSON is not authority. Six ownership pipelines run in parallel; **all ownership checks pass before any sampler starts**. Sampler starts run in parallel, followed by parallel fresh OS reinspection. Every phase awaits all settled callbacks before preserving failure, preventing a delayed sampler callback from starting after failure has already been reported.

Owned copies of exact receipt bytes, expected pins and plain deeply frozen samples/manifests prevent callback-reference mutation across awaits. Existing validators enforce PID/start/executable/session/module/profile/task/source identity, valid complete index0 and same-host five-second freshness. CPU first-delta/private unknowns remain null; renderer coverage unavailable, coverageComplete=false. Per-role output/config/initial-sample hashes are retained; no whole-app, HTTP-commit or logical-counter inference.

Finite sampler limits remain120min/1,441samples/8MiB per role. **The module itself is not an end-to-end finite supervisor:** trusted host adapters must enforce real command deadlines; allSettled cannot bound a never-resolving callback. Failed output evidence is preserved and no process-signal API is exposed. No genuine production host adapters are wired, so coordinator enforcement, OS positive rehearsal, phase/finalJSONL/campaign/reopen coverage and actual counters remain separate.

Mac focused gate: **50 passed,0 failures/skips** (25 supervisor controls plus25 existing ownership checks). Covers default-off no collection; mismatched/stale identity; same-host sample freshness; delayed/failing parallel ownership/start callbacks; no sampling before all-six ownership; PID reuse at final barrier; immutable receipt/sample capture and manifest hash stability. Controlled mocks are not genuine launcher or OS proof.

Final exact source SHA256:

- `sync/stress/measurement-supervisor.mjs`: `1ff6c682d6c1612190ca52a765458edd28993cff02084ed5092c6456bbf37fb4`
- `sync/stress/measurement-supervisor.test.mjs`: `dd710bfe5284473d03ef2d554335938651242b0693a4e99e50b176be0455fcde`

Private final source/log manifest: `/private/tmp/texttext-measurement-supervisor-review-20261019/qualified-final-source-manifest.json`; source hashes were identical before/after tests. No accounts, profile changes, runtime sampling or campaign.
