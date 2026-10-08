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

The sole content boundary now provides authoritative preview and execution
wrappers. Preview checks current ownership before reading files, derives its
manifest from the engine, and creates no reservation. Execution rechecks ownership
under the engine lock, validates the retained review hash and separately requires
acknowledgement of added destination access. Real local PostgreSQL tests cover
revoked access, stale manifests, changed reviews, empty-folder preservation,
rebased grants, expanded-access rejection and one audit row across retries.

These database tests are now mandatory in the core gate, which requires a local
PostgreSQL URL and explicitly enables them. Gate tests reject missing/remote
database configuration without printing credentials. The working-tree core run
passed 765 tests in 80 files and TypeScript; unrelated pre-existing local edits
were present, so this is not an attestation of a frozen release candidate.
Log: `/tmp/texttext-folder-move-boundary-core.log`. Focused database/engine tests
also passed. ESLint has no errors and two existing store warnings. The public
proposal adapter, access-review UI and client integration remain pending.

Authoritative previews now return a separately validated frozen folder review.
Its readable summary names source/destination paths, file/folder counts and each
additional recipient/role. Validation retains restored-file lifecycle fences,
checks the full plan hash and rejects changed destinations, hidden access or
malformed roles. A cloned plan cannot drift when the staging caller later edits
its original object. Sixteen combined preview/boundary tests passed, followed by
three review tests covering the final lifecycle case; TypeScript and focused
ESLint passed. Review tests are included in the core gate. This data model is
not yet wired into public proposal staging or approval execution.

The proposal review page now has an additional-access section and required
acknowledgement checkbox. Its server action sends only that acknowledgement and
the stored proposal ID after checking the current session. The decision service
validates a stored folder review before claiming it and rejects missing
acknowledgement or an altered hash without starting execution. Dismissal remains
available. These are source-level approval safeguards; public folder proposal
staging/execution still is not enabled. Page/service regressions passed 47 tests;
TypeScript passed. Actual rendered/live acknowledgement acceptance is pending.
