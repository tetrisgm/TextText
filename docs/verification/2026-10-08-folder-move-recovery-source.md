# Folder subtree move recovery source

Not installed or enabled through public commands yet.

The engine commits a durable intent before reserving sharing metadata, moves
the subtree through its pending directory, finishes metadata idempotently, then
updates derived paths and delivers one durable audit receipt. Store readers use
the same recovery coordinator. A pre-publication failure aborts its reservation
only while the original directory identity is still at its source path.

Verification on the Mac:

- 12 planning, filesystem and operation tests passed.
- 52 engine-store/server-store/server-collaboration tests passed, including lost
  metadata acknowledgement, exact pack bytes, stable IDs, empty folders,
  audited replay, revoked authorization and stale manifest rejection.
- Real local PostgreSQL reservation test passed, including grant preservation,
  sharing writer fencing, hash-bound abort, repeated abort and cancelled retry.
- TypeScript and focused operation/metadata ESLint passed.
- Owner-only read-only access preview now shares the reservation planner;
  local PostgreSQL verifies it creates no reservation and rejects non-owners.
- Corrected template-version compatibility and the frozen core gate passed
  all 751 tests at `bf0a8eda`. Log: `/tmp/texttext-sync-final-core.log`.
- Required native gate also passed with no failures; both core/native receipts
  match the current working source. Log: `/tmp/texttext-native-bf0a8eda.log`.
  Existing unrelated local edits remain outside these commits; no new client
  build or deployment is claimed for this source.

Pending: public immutable move preview and approval adapter, expanded-access
review, client integration, integrated required gate and live acceptance.

Before public integration, reservation now binds the entire freshly recomputed
plan to its reviewed hash, including items, empty folders, inherited shares and
added access. Replays also compare the stored plan. Canonical key ordering keeps
JSONB round-trips stable, and grant input ordering is deterministic. Engine
request receipts use the same plan hash. Twelve focused tests passed, including
real local PostgreSQL rejection before reservation, changed-plan retry rejection,
unchanged replay without duplicate audits, and reordered object keys. TypeScript
passed. This follow-up is source-only, not deployed or exposed as a command.
