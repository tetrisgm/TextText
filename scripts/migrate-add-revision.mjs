// One-shot migration: add the monotonic `revision` version column to posts and
// folders, backed by a shared `texttext_change_seq` sequence. Revision is the
// optimistic-lock (compare-and-swap) token for sync writes and the source of
// the workspace change cursor. Idempotent (IF NOT EXISTS), so re-running is safe.
//
//   node scripts/migrate-add-revision.mjs
//
// Reads DATABASE_URL from the environment or from .env.local (no dotenv dep).
// The ADD COLUMN uses a volatile default (nextval), so Postgres assigns every
// existing row a distinct revision as it rewrites the table, and the sequence
// ends up advanced past every backfilled value.

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through to the error below
  }
  throw new Error("DATABASE_URL not set and not found in .env.local");
}

async function main() {
  const sql = neon(loadDatabaseUrl());

  console.log("Creating sequence texttext_change_seq (if missing)...");
  await sql`CREATE SEQUENCE IF NOT EXISTS texttext_change_seq`;

  console.log("Adding posts.revision (backfilling existing rows)...");
  await sql`
    ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS revision bigint NOT NULL
      DEFAULT nextval('texttext_change_seq')
  `;

  console.log("Adding folders.revision (backfilling existing rows)...");
  await sql`
    ALTER TABLE folders
      ADD COLUMN IF NOT EXISTS revision bigint NOT NULL
      DEFAULT nextval('texttext_change_seq')
  `;

  console.log("Ensuring revision defaults use texttext_change_seq...");
  await sql`
    ALTER TABLE posts
      ALTER COLUMN revision SET DEFAULT nextval('texttext_change_seq')
  `;
  await sql`
    ALTER TABLE folders
      ALTER COLUMN revision SET DEFAULT nextval('texttext_change_seq')
  `;

  console.log("Advancing texttext_change_seq past existing revisions...");
  await sql`
    WITH max_revision AS (
      SELECT GREATEST(
        COALESCE((SELECT max(revision) FROM posts), 0),
        COALESCE((SELECT max(revision) FROM folders), 0)
      ) AS value
    )
    SELECT setval('texttext_change_seq', GREATEST(value, 1), value > 0)
    FROM max_revision
  `;

  // A BEFORE UPDATE trigger bumps revision on EVERY update, so no mutation path
  // (present or future, ORM or raw SQL) can forget to advance the version. The
  // column default covers inserts. Together they guarantee the optimistic-lock
  // token and the change cursor move on every mutation. CREATE OR REPLACE TRIGGER
  // is atomic (Postgres 14+), so a rerun never opens a window where the trigger
  // is missing and a concurrent update could slip through without a fresh
  // revision.
  console.log("Installing bump_revision() trigger on posts and folders...");
  await sql`
    CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
    BEGIN
      NEW.revision := nextval('texttext_change_seq');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    CREATE OR REPLACE TRIGGER posts_bump_revision BEFORE UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION bump_revision()
  `;
  await sql`
    CREATE OR REPLACE TRIGGER folders_bump_revision BEFORE UPDATE ON folders
      FOR EACH ROW EXECUTE FUNCTION bump_revision()
  `;

  // Durable workspace change cursor: a per-blog high-water-mark bumped by an
  // AFTER trigger on every post/folder insert or update. Unlike max(revision)
  // over surviving rows, it never falls when trashed rows are hard-deleted, so a
  // soft-delete the client has not yet polled can never be erased from the
  // cursor. The `< NEW.revision` guard keeps it monotonic and skips no-op writes.
  console.log("Adding blogs.change_seq...");
  await sql`ALTER TABLE blogs ADD COLUMN IF NOT EXISTS change_seq bigint NOT NULL DEFAULT 0`;
  // Install the triggers BEFORE backfilling so a mutation during the backfill is
  // captured (its trigger raises change_seq), and the backfill below only ever
  // raises via GREATEST. This ordering makes a rerun and a first-install race
  // both safe: the counter is monotonic and never rewinds.
  console.log("Installing bump_blog_change_seq() trigger...");
  await sql`
    CREATE OR REPLACE FUNCTION bump_blog_change_seq() RETURNS trigger AS $$
    BEGIN
      UPDATE blogs SET change_seq = NEW.revision
        WHERE id = NEW.blog_id AND change_seq < NEW.revision;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    CREATE OR REPLACE TRIGGER posts_bump_blog_seq AFTER INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION bump_blog_change_seq()
  `;
  await sql`
    CREATE OR REPLACE TRIGGER folders_bump_blog_seq AFTER INSERT OR UPDATE ON folders
      FOR EACH ROW EXECUTE FUNCTION bump_blog_change_seq()
  `;
  console.log("Backfilling blogs.change_seq (monotonic; never lowers)...");
  // GREATEST includes the current change_seq so a rerun after a hard delete (or a
  // mutation during install) can never lower the cursor and recreate a ghost.
  await sql`
    UPDATE blogs SET change_seq = GREATEST(
      change_seq,
      coalesce((select max(revision) from posts where blog_id = blogs.id), 0),
      coalesce((select max(revision) from folders where blog_id = blogs.id), 0)
    )
  `;

  // Idempotency keys for sync creates: a claimed row (result_id null) becomes
  // resolved once the create commits, so an ambiguous-response retry returns the
  // same item instead of duplicating it. Keyed per workspace.
  console.log("Creating idempotency_keys table (if missing)...");
  await sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      blog_id uuid NOT NULL REFERENCES blogs(id),
      key text NOT NULL,
      result_kind text,
      result_id uuid,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT idempotency_keys_pk PRIMARY KEY (blog_id, key)
    )
  `;

  const [{ posts_max }] = await sql`SELECT max(revision) AS posts_max FROM posts`;
  const [{ folders_max }] = await sql`SELECT max(revision) AS folders_max FROM folders`;
  const [{ seq }] = await sql`SELECT last_value AS seq FROM texttext_change_seq`;
  console.log(
    `Done. posts.max=${posts_max ?? 0} folders.max=${folders_max ?? 0} seq=${seq}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
