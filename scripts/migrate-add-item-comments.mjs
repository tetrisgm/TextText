#!/usr/bin/env node
// Idempotent migration for durable item comments. Comments stay outside posts
// so they never enter Markdown, sync files, or public reader payloads.
//
//   node scripts/migrate-add-item-comments.mjs

import pkg from "@next/env";
import { neon } from "@neondatabase/serverless";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping item comments migration.");
  process.exit(0);
}

const sql = neon(databaseUrl);

console.log("Creating item comment anchor field type...");
await sql`
  DO $$
  BEGIN
    CREATE TYPE item_comment_anchor_field AS ENUM ('title', 'excerpt', 'body');
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END
  $$
`;

console.log("Creating durable item comments table...");
await sql`
  CREATE TABLE IF NOT EXISTS item_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES item_comments(id) ON DELETE CASCADE,
    body text NOT NULL,
    anchor_field item_comment_anchor_field,
    anchor_quote text,
    anchor_start integer,
    anchor_end integer,
    author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    author_name text,
    author_actor_type text NOT NULL,
    edited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    edited_by_actor_type text,
    resolved_at timestamp,
    resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    resolved_by_actor_type text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT item_comments_body_not_blank
      CHECK (length(btrim(body)) > 0),
    CONSTRAINT item_comments_anchor_complete CHECK (
      (anchor_field IS NULL AND anchor_quote IS NULL AND
        anchor_start IS NULL AND anchor_end IS NULL)
      OR
      (anchor_field IS NOT NULL AND anchor_quote IS NOT NULL AND
        length(btrim(anchor_quote)) > 0)
    ),
    CONSTRAINT item_comments_anchor_offsets_valid CHECK (
      (anchor_start IS NULL OR anchor_start >= 0) AND
      (anchor_end IS NULL OR anchor_end >= 0) AND
      (anchor_start IS NULL OR anchor_end IS NULL OR anchor_end >= anchor_start)
    ),
    CONSTRAINT item_comments_actor_types_valid CHECK (
      author_actor_type IN ('human', 'ai', 'external_agent') AND
      (edited_by_actor_type IS NULL OR
        edited_by_actor_type IN ('human', 'ai', 'external_agent')) AND
      (resolved_by_actor_type IS NULL OR
        resolved_by_actor_type IN ('human', 'ai', 'external_agent'))
    ),
    CONSTRAINT item_comments_edit_actor_complete CHECK (
      edited_by_user_id IS NULL OR edited_by_actor_type IS NOT NULL
    ),
    CONSTRAINT item_comments_resolution_complete CHECK (
      (resolved_at IS NULL AND resolved_by_user_id IS NULL AND
        resolved_by_actor_type IS NULL)
      OR
      (resolved_at IS NOT NULL AND resolved_by_actor_type IS NOT NULL)
    )
  )
`;
await sql`
  ALTER TABLE item_comments
    ADD COLUMN IF NOT EXISTS author_name text
`;

await sql`
  CREATE INDEX IF NOT EXISTS item_comments_post_created_idx
    ON item_comments (post_id, created_at, id)
`;
await sql`
  CREATE INDEX IF NOT EXISTS item_comments_parent_created_idx
    ON item_comments (parent_id, created_at, id)
`;
await sql`
  CREATE INDEX IF NOT EXISTS item_comments_post_resolved_created_idx
    ON item_comments (post_id, resolved_at, created_at)
`;

const [summary] = await sql`
  SELECT
    count(*)::int AS comments,
    count(*) FILTER (WHERE parent_id IS NOT NULL)::int AS replies,
    count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved
  FROM item_comments
`;
console.log(
  `Item comments ready. comments=${summary.comments} ` +
    `replies=${summary.replies} resolved=${summary.resolved}`,
);
