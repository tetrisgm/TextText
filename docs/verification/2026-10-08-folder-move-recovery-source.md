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

Pending: public immutable move preview and approval adapter, expanded-access
review, client integration, integrated required gate and live acceptance.
