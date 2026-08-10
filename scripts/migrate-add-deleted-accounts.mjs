#!/usr/bin/env node
// Tombstones for deleted accounts.
//
// A deleted account leaves nothing behind that could identify the person: the
// users row is gone, the workspace is gone, the audit rows have had their actor
// nulled. This table exists for the two things that still have to be true
// afterwards.
//
// First, a stale session must not be able to recreate the account. Sessions are
// JWTs with no server-side session table, so a cookie minted before the
// deletion still verifies afterwards, and upsertUser would happily INSERT the
// users row straight back. The sub_hash is consulted on that path and refuses.
//
// Second, the released public names stay held. A handle and a username are
// addresses other people have linked to, so letting the next signup take them
// would silently point someone else's readers at a stranger.
//
// sub_hash is a one-way SHA-256 of the sign-in subject, never the subject
// itself: enough to recognise the same identity coming back, useless as a
// record of who it was.
//
// NO FOREIGN KEYS ON ANY COLUMN, deliberately. user_id and blog_id name rows
// that are about to be deleted, and there are already nine NO ACTION
// references into users blocking that delete. A tenth here would make the
// tombstone the thing preventing the deletion it exists to record.
//
// Idempotent (IF NOT EXISTS). Runs inside scripts/run-release-migrations.sh,
// whose coverage guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-add-deleted-accounts.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping deleted accounts migration.");
  process.exit(0);
}

// node-postgres, not the Neon HTTP driver: this must run against local
// Postgres in development and Neon in release, same as migrate-unified-documents.
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS deleted_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_hash text NOT NULL UNIQUE,
    user_id uuid,
    blog_id uuid,
    username text,
    handle text,
    requested_at timestamp DEFAULT now() NOT NULL,
    completed_at timestamp
  )
`);

// Partial unique indexes: the held names must be unique among tombstones, but
// many tombstones legitimately have no username or handle at all.
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS deleted_accounts_username_idx
    ON deleted_accounts (username) WHERE username IS NOT NULL
`);
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS deleted_accounts_handle_idx
    ON deleted_accounts (handle) WHERE handle IS NOT NULL
`);
// Finds purges that were interrupted, for scripts/finish-pending-account-deletions.ts.
await client.query(`
  CREATE INDEX IF NOT EXISTS deleted_accounts_pending_idx
    ON deleted_accounts (requested_at) WHERE completed_at IS NULL
`);

const { rows: [row] } = await client.query(
  `SELECT count(*)::int AS tombstones,
          count(*) FILTER (WHERE completed_at IS NULL)::int AS pending
     FROM deleted_accounts`,
);
await client.end();
console.log(`Deleted accounts ready. tombstones=${row.tombstones} pending=${row.pending}`);
