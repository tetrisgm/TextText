#!/usr/bin/env node
// Make custom document fields queryable server-side.
//
// Templates can declare typed fields and collections can now filter on them
// (`collection.filters` in src/lib/presentation/schema.ts). Filters compile to
// jsonb containment (@>) and existence (?) against document->'content'->'fields',
// which this GIN index serves. Sorting extracts the field value per row of the
// already-filtered set, so it needs no index of its own: a folder page is
// bounded, and a btree per arbitrary field id is not possible anyway.
//
// Idempotent (IF NOT EXISTS). Runs inside scripts/run-release-migrations.sh,
// whose coverage guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-add-document-fields-index.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping fields index migration.");
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
  CREATE INDEX IF NOT EXISTS posts_document_fields_gin
    ON posts USING GIN ((document -> 'content' -> 'fields') jsonb_path_ops)
`);

const { rows: [row] } = await client.query(`
  SELECT count(*)::int AS posts,
         count(*) FILTER (
           WHERE jsonb_typeof(document -> 'content' -> 'fields') = 'object'
             AND document -> 'content' -> 'fields' <> '{}'::jsonb
         )::int AS with_fields
  FROM posts
`);
await client.end();
console.log(
  `Custom fields queryable. posts=${row.posts} withFieldValues=${row.with_fields}`,
);
