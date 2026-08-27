#!/usr/bin/env node
// Drop `capabilities` from stored look definitions.
//
// A look declared which product features its items supported - assets,
// capture, collaboration, comments, import, publish, responses, search - and
// nothing ever read it. The only code that touched it checked the array for
// duplicates. It was derived for every AI-generated type and declared on all
// eleven built-ins, so the schema advertised a capability system the product
// did not have, sitting exactly where a future session would assume one worked
// (owner ruling 2026-08-27).
//
// The definition schema is strict, so a stored definition still carrying the
// key would fail to parse once the field is gone. This runs before the deploy
// that removes it, and a definition without the key parses fine on the old
// code too, so the order is safe in both directions.
//
// Idempotent. Runs inside scripts/run-release-migrations.sh, whose coverage
// guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-drop-template-capabilities.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping template capabilities drop.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

const { rows: before } = await client.query(
  `SELECT count(*)::int AS n FROM document_templates WHERE definition ? 'capabilities'`,
);
const carrying = before[0]?.n ?? 0;

await client.query(
  `UPDATE document_templates
      SET definition = definition - 'capabilities'
    WHERE definition ? 'capabilities'`,
);

console.log(`template capabilities: dropped from ${carrying} look(s)`);

await client.end();
