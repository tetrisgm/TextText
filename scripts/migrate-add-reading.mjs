#!/usr/bin/env node
// Idempotent migration for source-fed reading: posts.origin, the workspace
// retention default, and the sidecar tables that make an imported article an
// ordinary item with provenance, a retention lease, read state, holds and
// bounded jobs. Additive only; nothing here rewrites an existing item.
//
//   node scripts/migrate-add-reading.mjs

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping reading migration.");
  process.exit(0);
}

const sql = await connectMigrationDatabase(databaseUrl);

console.log("Adding posts.origin...");
await sql`
  ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual'
`;
await sql`
  DO $$
  BEGIN
    ALTER TABLE posts
      ADD CONSTRAINT posts_origin_valid CHECK (origin in ('manual', 'feed'));
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END
  $$
`;
await sql`
  CREATE INDEX IF NOT EXISTS posts_blog_origin_idx
    ON posts (blog_id, origin) WHERE deleted_at IS NULL
`;

console.log("Adding blogs.reading_retention_days...");
await sql`
  ALTER TABLE blogs
    ADD COLUMN IF NOT EXISTS reading_retention_days integer NOT NULL DEFAULT 90
`;

console.log("Creating feed_connections...");
await sql`
  CREATE TABLE IF NOT EXISTS feed_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_id uuid NOT NULL REFERENCES blogs(id),
    folder_id uuid NOT NULL REFERENCES folders(id),
    endpoint_url text NOT NULL,
    endpoint_key text NOT NULL,
    feed_format text,
    publisher_title text,
    site_url text,
    state text NOT NULL DEFAULT 'active',
    health text NOT NULL DEFAULT 'checking',
    health_detail text,
    etag text,
    last_modified text,
    last_checked_at timestamp,
    last_success_at timestamp,
    last_import_at timestamp,
    consecutive_failures integer NOT NULL DEFAULT 0,
    next_check_at timestamp,
    retention_days integer,
    initial_import_limit integer NOT NULL DEFAULT 100,
    policy_version integer NOT NULL DEFAULT 1,
    created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    deleted_at timestamp,
    CONSTRAINT feed_connections_state_valid
      CHECK (state in ('active', 'paused', 'detached')),
    CONSTRAINT feed_connections_health_valid
      CHECK (health in ('healthy', 'checking', 'stale', 'failing', 'rate_limited', 'moved', 'auth_required', 'unsupported', 'degraded', 'disabled')),
    CONSTRAINT feed_connections_retention_valid
      CHECK (retention_days IS NULL OR retention_days >= 0)
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS feed_connections_blog_endpoint_idx
    ON feed_connections (blog_id, endpoint_key)
    WHERE deleted_at IS NULL AND state <> 'detached'
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS feed_connections_folder_active_idx
    ON feed_connections (folder_id)
    WHERE deleted_at IS NULL AND state <> 'detached'
`;
await sql`
  CREATE INDEX IF NOT EXISTS feed_connections_due_idx
    ON feed_connections (next_check_at)
    WHERE deleted_at IS NULL AND state = 'active'
`;

console.log("Creating feed_receipts...");
await sql`
  CREATE TABLE IF NOT EXISTS feed_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id uuid NOT NULL REFERENCES feed_connections(id) ON DELETE CASCADE,
    blog_id uuid NOT NULL,
    external_key text NOT NULL,
    post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
    first_imported_at timestamp NOT NULL DEFAULT now(),
    last_seen_at timestamp NOT NULL DEFAULT now(),
    content_hash text,
    expires_at timestamp,
    expired_at timestamp,
    status text NOT NULL DEFAULT 'active',
    CONSTRAINT feed_receipts_status_valid
      CHECK (status in ('active', 'expired', 'detached'))
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS feed_receipts_connection_key_idx
    ON feed_receipts (connection_id, external_key)
`;
await sql`CREATE INDEX IF NOT EXISTS feed_receipts_post_idx ON feed_receipts (post_id)`;
await sql`
  CREATE INDEX IF NOT EXISTS feed_receipts_expiry_idx
    ON feed_receipts (blog_id, expires_at)
    WHERE status = 'active' AND expires_at IS NOT NULL
`;

console.log("Creating reading_provenance...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_provenance (
    post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    blog_id uuid NOT NULL,
    connection_id uuid REFERENCES feed_connections(id) ON DELETE SET NULL,
    publisher_title text NOT NULL,
    publisher_name text,
    authors text[] NOT NULL DEFAULT ARRAY[]::text[],
    permalink text,
    external_url text,
    canonical_url text,
    published_at timestamp,
    source_updated_at timestamp,
    availability text NOT NULL,
    language text,
    source_hash text NOT NULL,
    normalization_version integer NOT NULL DEFAULT 1,
    captured_at timestamp NOT NULL DEFAULT now(),
    revision_count integer NOT NULL DEFAULT 1,
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT reading_provenance_availability_valid
      CHECK (availability in ('full', 'excerpt', 'metadata'))
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS reading_provenance_blog_published_idx
    ON reading_provenance (blog_id, published_at)
`;
await sql`
  CREATE INDEX IF NOT EXISTS reading_provenance_canonical_idx
    ON reading_provenance (blog_id, canonical_url)
`;

console.log("Creating reading_source_revisions...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_source_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    source_hash text NOT NULL,
    title text NOT NULL,
    body_markdown text NOT NULL,
    availability text NOT NULL,
    captured_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS reading_source_revisions_post_hash_idx
    ON reading_source_revisions (post_id, source_hash)
`;
await sql`
  CREATE INDEX IF NOT EXISTS reading_source_revisions_post_idx
    ON reading_source_revisions (post_id, captured_at)
`;

console.log("Creating reading_read_state...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_read_state (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    read_at timestamp,
    read_revision_id uuid,
    updated_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS reading_read_state_post_idx ON reading_read_state (post_id)`;

console.log("Creating retention_holds...");
await sql`
  CREATE TABLE IF NOT EXISTS retention_holds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    blog_id uuid NOT NULL,
    reason text NOT NULL,
    source_id text NOT NULL DEFAULT '',
    revision_id uuid,
    created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    expires_at timestamp,
    released_at timestamp,
    CONSTRAINT retention_holds_reason_valid
      CHECK (reason in ('manual_save', 'starred', 'keep', 'comment', 'reference', 'keep_summary', 'proposal_lease', 'processing_lease', 'used_in_work'))
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS retention_holds_active_idx
    ON retention_holds (post_id, reason, source_id)
    WHERE released_at IS NULL
`;
await sql`CREATE INDEX IF NOT EXISTS retention_holds_blog_idx ON retention_holds (blog_id, post_id)`;

console.log("Creating reading_jobs...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_id uuid NOT NULL,
    kind text NOT NULL,
    op_key text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    lease_until timestamp,
    lease_owner text,
    run_after timestamp NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    finished_at timestamp,
    CONSTRAINT reading_jobs_status_valid
      CHECK (status in ('queued', 'running', 'done', 'failed', 'dead', 'cancelled'))
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS reading_jobs_open_op_idx
    ON reading_jobs (blog_id, op_key)
    WHERE status in ('queued', 'running')
`;
await sql`
  CREATE INDEX IF NOT EXISTS reading_jobs_runnable_idx
    ON reading_jobs (run_after) WHERE status = 'queued'
`;

console.log("Creating reading_embeddings...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_embeddings (
    post_id uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    blog_id uuid NOT NULL,
    model text NOT NULL,
    dims integer NOT NULL,
    vector real[] NOT NULL,
    text_hash text NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS reading_embeddings_blog_idx ON reading_embeddings (blog_id)
`;

console.log("Adding feed_connections settings columns...");
await sql`ALTER TABLE feed_connections ADD COLUMN IF NOT EXISTS muted_keywords text[] NOT NULL DEFAULT '{}'::text[]`;
await sql`ALTER TABLE feed_connections ADD COLUMN IF NOT EXISTS moved_to_url text`;

console.log("Adding reading_provenance.duplicate_of_post_id...");
await sql`ALTER TABLE reading_provenance ADD COLUMN IF NOT EXISTS duplicate_of_post_id uuid`;
await sql`CREATE INDEX IF NOT EXISTS reading_provenance_duplicate_idx ON reading_provenance (blog_id, duplicate_of_post_id)`;
// Backfill: every later live feed copy of a canonical link points at the earliest one.
await sql`
  UPDATE reading_provenance rp
  SET duplicate_of_post_id = first.id
  FROM (
    SELECT rp2.post_id, first_value(p.id) OVER (PARTITION BY rp2.blog_id, rp2.canonical_url ORDER BY p.created_at, p.id) AS id
    FROM reading_provenance rp2
    JOIN posts p ON p.id = rp2.post_id
    WHERE rp2.canonical_url IS NOT NULL AND p.deleted_at IS NULL AND p.origin = 'feed'
  ) first
  WHERE first.post_id = rp.post_id AND first.id <> rp.post_id AND rp.duplicate_of_post_id IS NULL
`;

console.log("Creating reading_summary_texts...");
await sql`
  CREATE TABLE IF NOT EXISTS reading_summary_texts (
    cluster_key text PRIMARY KEY,
    blog_id uuid NOT NULL,
    model text NOT NULL,
    text text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS reading_summary_texts_blog_idx ON reading_summary_texts (blog_id)
`;

const [summary] = await sql`
  SELECT
    (SELECT count(*)::int FROM posts WHERE origin = 'feed') AS feed_items,
    (SELECT count(*)::int FROM feed_connections) AS connections
`;
console.log(`Done. feed_items=${summary.feed_items} connections=${summary.connections}`);
await sql.close();
