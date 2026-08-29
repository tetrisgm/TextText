#!/usr/bin/env node
// One-shot migration: document_templates.authoring_source.
//
// A look compiled from a blueprint used to keep only the compiled definition,
// so the blueprint the assistant actually wrote was destroyed at save. Changing
// a look afterwards then meant re-authoring it blind from compiled output, and
// "make the date bigger on my recipe type" had no path at all. This column
// keeps the authoring source beside the definition it produced.
//
// Nullable, permanently. Built-ins are compiled in code and have no row; a look
// saved from a document, a duplicate, an import and a restored version each
// carry a definition that was never authored as a blueprint; and every row
// written before this column has none. Absent means "edited by hand".
//
// Idempotent. Runs inside scripts/run-release-migrations.sh, whose coverage
// guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-add-template-authoring-source.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping authoring source column.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

const { rows: before } = await client.query(
  `SELECT count(*)::int AS n
     FROM information_schema.columns
    WHERE table_name = 'document_templates' AND column_name = 'authoring_source'`,
);
if (before[0]?.n) {
  console.log("authoring source: column already present");
} else {
  await client.query(
    `ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS authoring_source jsonb`,
  );
  console.log("authoring source: column added");
}

await client.end();
