# T16: separate-process write and receipt boundaries

A real Node writer is SIGKILLed after durable file/receipt commit, either before audit delivery or after successful audit delivery but before acknowledging its caller. A new Node process independently reopens disk, drains the receipt outbox and replays the same operation. Both tests retain exact archive bytes, Unicode body and binary asset bytes, return the original revision and produce one durable audit-sink entry. Reusing the operation ID with changed bytes rejects before reaching the sink.

The fixture sink intentionally uses deterministic create-only operation IDs, matching the production deterministic audit ID and ON CONFLICT semantics. Receipt delivery is at least once. This does not prove an actual PostgreSQL outage or machine power loss. Other T16 boundaries remain open.

Command: `npx vitest run src/lib/vault/server-write-crash.test.ts src/lib/vault/server-store.test.ts`. Exit 0: 40 passed, one pre-existing optional skipped test. Log: `/private/tmp/texttext-file-write-process-crash-verified-20261018.log`.

Initial fixture attempts incorrectly required single callback delivery and omitted the mandatory sink for changed-ID refusal. Those harness mistakes were corrected without production changes; logs remain `/private/tmp/texttext-file-write-process-crash-20261018.log` and `/private/tmp/texttext-file-write-process-crash-final-20261018.log`. No product regression is inferred from those failures.

Tests create disposable temporary roots only. No production database, deployed app or existing user document is touched.

## Production PostgreSQL receipt sink

`TEXTTEXT_READING_DB_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/lib/vault/write-receipt-replay.db.test.ts` passed one test against loopback-only local Postgres. A controlled audit callback refusal leaves a durable file receipt; the normal store reader subsequently drains it through the production PostgreSQL audit sink. Replaying the original write leaves one audit row; changed bytes with the same operation ID refuse without a second row. Exact file bytes survive, and audit rows contain no body. This models audit-service unavailability; it does not stop PostgreSQL or claim a real network outage. Fixture rows and temporary files are cleaned up. Log: `/private/tmp/texttext-file-receipt-postgres-replay-20261018.log`; TypeScript passes in `/private/tmp/texttext-receipt-replay-typecheck-20261018.log`.
