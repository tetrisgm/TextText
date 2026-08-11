#!/usr/bin/env node
// Reports from readers about published content.
//
// Public pages are readable by anyone, so anyone can encounter something that
// should not be there, and App Review Guideline 1.2 requires a way to say so
// that is not "find an email address". One row per report, filed without an
// account, reviewed by a human.
//
// post_id is ON DELETE SET NULL rather than NO ACTION, deliberately: account
// deletion purges posts, and a report must never become the row that blocks a
// deletion. The path column keeps the record meaningful after the post goes.
//
// Idempotent (IF NOT EXISTS). Runs inside scripts/run-release-migrations.sh,
// whose coverage guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-add-content-reports.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping content reports migration.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS content_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    path text NOT NULL,
    post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
    reason text NOT NULL,
    reporter_email text,
    status text NOT NULL DEFAULT 'open',
    created_at timestamp DEFAULT now() NOT NULL,
    resolved_at timestamp,
    CONSTRAINT content_reports_reason_not_blank
      CHECK (length(btrim(reason)) > 0)
  )
`);
await client.query(`
  CREATE INDEX IF NOT EXISTS content_reports_open_idx
    ON content_reports (created_at) WHERE status = 'open'
`);
await client.query(`
  CREATE INDEX IF NOT EXISTS content_reports_post_idx
    ON content_reports (post_id)
`);

const { rows: [row] } = await client.query(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status = 'open')::int AS open
     FROM content_reports`,
);
await client.end();
console.log(`Content reports ready. total=${row.total} open=${row.open}`);
