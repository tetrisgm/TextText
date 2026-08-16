#!/usr/bin/env node
// Drop blogs.card_style.
//
// The column chose whether published cards showed their cover image. It was
// set from the Blog page's Layout popover, which also held the home layout;
// when the layout picker moved to Home (owner ruling 2026-08-15) the popover
// went and this lost its only UI. Card style is a property of how a folder's
// index renders, and folder indexes are governed by their look now, so a
// second stored answer on the workspace row is exactly the shape that ruling
// removed. Deleted rather than left unreachable (owner ruling 2026-08-16).
//
// Cards now always show the cover they have, which is what 'cover' meant and
// what every workspace but a deliberate few was already on.
//
// Idempotent (IF EXISTS). Runs inside scripts/run-release-migrations.sh, whose
// coverage guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-drop-card-style.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping card style drop.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

const { rows: before } = await client.query(
  `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'blogs' AND column_name = 'card_style'`,
);
if (before[0]?.n) {
  const { rows: minimal } = await client.query(
    `SELECT count(*)::int AS n FROM blogs WHERE card_style = 'minimal'`,
  );
  console.log(
    `${minimal[0]?.n ?? 0} workspace(s) were on minimal; their cards will show covers.`,
  );
}

await client.query(`ALTER TABLE blogs DROP COLUMN IF EXISTS card_style`);
console.log("card style: dropped");

await client.end();
