#!/usr/bin/env node
// Idempotent migration for personal workspace stars. `starred` is deliberately
// independent from `pinned`, which continues to control public presentation.
//
//   node scripts/migrate-add-starred.mjs

import pkg from "@next/env";
import { neon } from "@neondatabase/serverless";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping starred migration.");
  process.exit(0);
}

const sql = neon(databaseUrl);

await sql`
  ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false
`;
await sql`
  CREATE INDEX IF NOT EXISTS posts_blog_starred_order_idx
    ON posts (blog_id, starred DESC, updated_at DESC, created_at DESC)
    WHERE deleted_at IS NULL
`;

const [summary] = await sql`
  SELECT
    count(*)::int AS posts,
    count(*) FILTER (WHERE starred)::int AS starred
  FROM posts
  WHERE deleted_at IS NULL
`;
console.log(
  `Personal stars ready. posts=${summary.posts} starred=${summary.starred}`,
);
