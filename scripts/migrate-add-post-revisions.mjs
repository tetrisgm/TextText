#!/usr/bin/env node
// Document history: every version a write replaced.
//
// A row is the document as it stood before something superseded it, written in
// the same statement as the write itself, so a truncation can never destroy
// the text it replaced. Collaborative baseline rotations record here too.
//
// Idempotent (IF NOT EXISTS).
//
//   node scripts/migrate-add-post-revisions.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping post revisions migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Creating post_revisions...");
await sql`
  CREATE TABLE IF NOT EXISTS post_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    blog_id uuid NOT NULL,
    revision bigint,
    document jsonb NOT NULL,
    title text,
    body_length integer NOT NULL DEFAULT 0,
    shrank_by integer NOT NULL DEFAULT 0,
    superseded_by_revision bigint,
    superseded_by_action text NOT NULL,
    superseded_by_actor_type text NOT NULL,
    superseded_by_actor_user_id uuid,
    created_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS post_revisions_post_idx ON post_revisions (post_id, created_at)`;
await sql`CREATE INDEX IF NOT EXISTS post_revisions_blog_idx ON post_revisions (blog_id, created_at)`;
await sql.close();
console.log("Done.");
