#!/usr/bin/env node
// One person, several ways to sign in.
//
// users.apple_sub held exactly one subject per account, so a user WAS a
// sign-in method: the Apple subject, or "google:<sub>", or the row's own uuid
// for an emailed link. Signing in a different way than last time therefore did
// not reach your workspace, it created a second account, and the effect looked
// exactly like losing everything. The column is also badly named for what it
// came to hold.
//
// This table replaces that with one row per identity, so a user can carry all
// three. The subject strings keep the format they already had, so nothing that
// mints or reads a session has to change its notion of what a subject is.
//
// The backfill copies every users.apple_sub into a row here. apple_sub STAYS
// for now, and stays unique: this migration only adds the ability to have more
// than one identity. Removing the column is a separate change, after the code
// has been reading from this table in production for a while.
//
// Idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING).
//
//   node scripts/migrate-add-user-identities.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping identities migration.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS user_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    subject text NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    CONSTRAINT user_identities_provider_valid
      CHECK (provider IN ('apple', 'google', 'email'))
  )
`);

// The subject is what a session carries, so it must resolve to exactly one
// person. This is the constraint that makes "two accounts, one human" the
// impossible state it should always have been.
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS user_identities_subject_idx
    ON user_identities (subject)
`);
// One row per provider per user: connecting Apple twice is a no-op, not a pair.
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS user_identities_user_provider_idx
    ON user_identities (user_id, provider)
`);
await client.query(`
  CREATE INDEX IF NOT EXISTS user_identities_user_idx
    ON user_identities (user_id)
`);

// Backfill. The provider is derived from the shape the subject already has,
// which is how every resolver in the app has been reading it.
const { rowCount: inserted } = await client.query(`
  INSERT INTO user_identities (user_id, provider, subject)
  SELECT u.id,
         CASE
           WHEN u.apple_sub LIKE 'google:%' THEN 'google'
           WHEN u.apple_sub = u.id::text THEN 'email'
           ELSE 'apple'
         END,
         u.apple_sub
    FROM users u
   WHERE u.apple_sub IS NOT NULL
  ON CONFLICT (subject) DO NOTHING
`);

const { rows: [summary] } = await client.query(`
  SELECT count(*)::int AS identities,
         count(DISTINCT user_id)::int AS people,
         count(*) FILTER (WHERE provider = 'apple')::int AS apple,
         count(*) FILTER (WHERE provider = 'google')::int AS google,
         count(*) FILTER (WHERE provider = 'email')::int AS email
    FROM user_identities
`);
const { rows: [orphans] } = await client.query(`
  SELECT count(*)::int AS n FROM users u
   WHERE u.apple_sub IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM user_identities i WHERE i.subject = u.apple_sub)
`);

await client.end();
console.log(
  `Identities ready. backfilled=${inserted} total=${summary.identities} people=${summary.people} ` +
    `(apple=${summary.apple} google=${summary.google} email=${summary.email}) unbackfilled=${orphans.n}`,
);
if (orphans.n > 0) {
  console.error("Some users have a subject with no identity row; investigate before relying on this table.");
  process.exitCode = 1;
}
