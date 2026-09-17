#!/usr/bin/env node
// A source belongs to a subject.
//
// The news strip used to list publishers, which is not what a news strip is
// for: nobody opens a reader wanting "Polygon.com", they want games. This
// column says which channel a source feeds, so the strip can be subjects the
// way the app this Home copies had them. Null means unplaced: the source
// still appears in For You and Latest, it just has no tab of its own.
//
// Idempotent (IF NOT EXISTS).
//
//   node scripts/migrate-add-feed-channel.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping feed channel migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Adding feed_connections.channel...");
await sql`ALTER TABLE feed_connections ADD COLUMN IF NOT EXISTS channel text`;

// Null channel is ambiguous on its own: it means both "never placed" and
// "the owner took it out of every channel". This says which, so a source
// deliberately left out is never quietly placed again by the next poll.
console.log("Adding feed_connections.channel_placed_at...");
await sql`ALTER TABLE feed_connections ADD COLUMN IF NOT EXISTS channel_placed_at timestamptz`;

console.log("Indexing the strip's query...");
await sql`
  CREATE INDEX IF NOT EXISTS feed_connections_channel_idx
    ON feed_connections (blog_id, channel)
    WHERE channel IS NOT NULL AND deleted_at IS NULL
`;

console.log("Done. Existing sources are placed by their next check, or at once with scripts/backfill-feed-channels.mjs.");
process.exit(0);
