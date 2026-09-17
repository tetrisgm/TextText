#!/usr/bin/env node
// The home page as a news front page: the representative image a feed
// supplies for an item. Later revisions of this script add the Summary
// and preference tables; every statement stays idempotent.
//
//   node scripts/migrate-add-home-news.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping home news migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Adding reading_provenance.image_url...");
await sql`ALTER TABLE reading_provenance ADD COLUMN IF NOT EXISTS image_url text`;

console.log("Creating reading_summaries...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_summaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_id uuid NOT NULL,
    stable_key text NOT NULL,
    member_ids uuid[] NOT NULL,
    coverage_revision integer NOT NULL DEFAULT 1,
    evidence_hash text NOT NULL,
    headline text NOT NULL,
    text text,
    text_model text,
    text_evidence_hash text,
    topic_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    source_names text[] NOT NULL DEFAULT ARRAY[]::text[],
    representative_post_id uuid,
    image_url text,
    first_at timestamp NOT NULL,
    latest_at timestamp NOT NULL,
    retired_into uuid,
    updated_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`DROP INDEX IF EXISTS reading_summaries_blog_key_idx`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS reading_summaries_blog_key_idx ON reading_summaries (blog_id, stable_key) WHERE retired_into IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS reading_summaries_blog_latest_idx ON reading_summaries (blog_id, latest_at)`;

console.log("Creating reading_topics...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_topics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_id uuid NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    ref text,
    centroid real[],
    member_count integer NOT NULL DEFAULT 0,
    position integer NOT NULL DEFAULT 0,
    updated_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS reading_topics_blog_idx ON reading_topics (blog_id)`;

console.log("Creating reading_summary_state...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_summary_state (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary_id uuid NOT NULL REFERENCES reading_summaries(id) ON DELETE CASCADE,
    seen_revision integer NOT NULL DEFAULT 0,
    hidden_at timestamp,
    updated_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, summary_id)
  )
`;

console.log("Creating reading_preferences...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    kind text NOT NULL,
    target text NOT NULL,
    label text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS reading_preferences_unique_idx ON reading_preferences (user_id, blog_id, kind, target)`;
await sql`CREATE INDEX IF NOT EXISTS reading_preferences_user_blog_idx ON reading_preferences (user_id, blog_id)`;
await sql.close();
console.log("Done.");
