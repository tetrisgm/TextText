#!/usr/bin/env node
// Reader responses for poll nodes.
//
// A poll's options live in the document (a rows field); READER RESPONSES live
// here, one row per (post, poll field, responder), so re-voting updates in
// place and tallies count readers. Deleting the post cascades its votes away.
// Mirrors documentResponses in src/lib/db/schema.ts.
//
// Idempotent (IF NOT EXISTS). Runs inside scripts/run-release-migrations.sh,
// whose coverage guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-add-document-responses.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping responses migration.");
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
  CREATE TABLE IF NOT EXISTS document_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    field_id text NOT NULL,
    responder_key text NOT NULL,
    responder_name text,
    values jsonb NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL,
    CONSTRAINT document_responses_responder_not_blank
      CHECK (length(btrim(responder_key)) > 0)
  )
`);
await client.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS document_responses_one_per_responder_idx
    ON document_responses (post_id, field_id, responder_key)
`);
await client.query(`
  CREATE INDEX IF NOT EXISTS document_responses_post_field_idx
    ON document_responses (post_id, field_id)
`);

const { rows: [row] } = await client.query(
  `SELECT count(*)::int AS responses FROM document_responses`,
);
await client.end();
console.log(`Reader responses ready. responses=${row.responses}`);
