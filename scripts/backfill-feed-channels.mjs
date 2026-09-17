#!/usr/bin/env node
// Place the sources that were followed before channels existed.
//
// Every active connection with no channel is offered to the same placement
// the app uses when a feed is added: the host map first, then the words in
// its name and address. A source it cannot place is left alone, because a
// wrong subject is worse than none and one click in Manage sources fixes it.
//
// Idempotent: a source that already has a channel is never touched, so the
// owner's own choices survive every re-run.
//
//   node scripts/backfill-feed-channels.mjs            apply
//   node scripts/backfill-feed-channels.mjs --dry-run  show what it would do
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";
import { channelForSource } from "../src/lib/reading/channels.ts";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping.");
  process.exit(0);
}
const dryRun = process.argv.includes("--dry-run");
const sql = await connectMigrationDatabase(databaseUrl);

const rows = await sql`
  SELECT c.id, c.publisher_title, c.site_url, c.endpoint_url, f.name AS folder_name
    FROM feed_connections c
    JOIN folders f ON f.id = c.folder_id
   WHERE c.channel IS NULL
     AND c.channel_placed_at IS NULL
     AND c.deleted_at IS NULL
     AND c.state <> 'detached'
`;
console.log(`${rows.length} source${rows.length === 1 ? "" : "s"} without a channel.`);

const counts = new Map();
let placed = 0;
for (const row of rows) {
  const channel = channelForSource({
    name: row.folder_name,
    publisherTitle: row.publisher_title,
    siteUrl: row.site_url,
    endpointUrl: row.endpoint_url,
  });
  if (!channel) continue;
  counts.set(channel, (counts.get(channel) ?? 0) + 1);
  placed += 1;
  if (!dryRun) await sql`UPDATE feed_connections SET channel = ${channel}, channel_placed_at = now(), updated_at = now() WHERE id = ${row.id}`;
}

for (const [channel, count] of [...counts.entries()].sort((left, right) => right[1] - left[1])) {
  console.log(`  ${channel}: ${count}`);
}
console.log(`${dryRun ? "Would place" : "Placed"} ${placed}; left ${rows.length - placed} unplaced.`);
process.exit(0);
