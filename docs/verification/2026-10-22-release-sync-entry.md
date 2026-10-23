# Phase 1: sync gate entry

Cause: `test:sync` called the verifier without loading local Postgres or producing
the browser mirror-policy bundle required by native tests. October 22 deployment
needed both steps supplied manually.

The npm entry now produces a fresh bundle, exports its directory, and runs the
verifier through `with-local-database.mjs`. A producer failure stops the gate;
its output remains available for diagnosis. The wrapper is fingerprinted.

Mac verification: two executable wrapper regressions passed, including producer
failure propagation and the same bundle reaching the database-wrapped verifier;
`bash -n` passed. These are orchestration checks, not installed acceptance.
The full gate and three-surface release remain Phase 1 work.

Mac access recovered via the existing LAN SSH profile. Owner `Package.resolved`
remains SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.
