// One-shot migration for the sync rename-revert guard (store.titleRevertsRecentRename),
// which stops the File Provider .textbundle re-materialization phantom from
// clobbering an app-side rename by pushing a stale title back to the server.
//
// The guard's signal is post_title_history: every title a post was renamed AWAY
// from, with the moment it was superseded. An AFTER UPDATE trigger appends
// (post_id, OLD.title, now()) on each title change (and prunes rows older than
// the lookback). The route refuses a sync/agent title that this post was
// superseded away from within the last 60s. Keying on the SUPERSEDE time and
// keeping the whole recent chain catches a revert to the AGED BASE of a rapid
// multi-step rename (base current until the burst began) which a single
// previous-title slot or a set-time window would miss.
//
//   node scripts/migrate-add-rename-revert-guard.mjs
//
// Idempotent (IF NOT EXISTS / CREATE OR REPLACE). Additive for a fresh DB. Also
// drops the artifacts of an earlier iteration of this guard (posts.previous_title
// + capture_previous_title trigger) so a DB that ran that version converges.
// Reads DATABASE_URL from the environment or from .env.local (no dotenv dep).

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

  // Retire the earlier single-slot iteration (previous_title), superseded by the
  // full history table below. Safe: no shipped code references it.
  console.log("Dropping the previous_title iteration (if present)...");
  await sql`DROP TRIGGER IF EXISTS posts_capture_previous_title ON posts`;
  await sql`DROP FUNCTION IF EXISTS capture_previous_title()`;
  await sql`ALTER TABLE posts DROP COLUMN IF EXISTS previous_title`;

  console.log("Creating post_title_history (if missing)...");
  await sql`
    CREATE TABLE IF NOT EXISTS post_title_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL,
      title text NOT NULL,
      superseded_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS post_title_history_lookup_idx
      ON post_title_history (post_id, title, superseded_at)
  `;

  // AFTER UPDATE so the row is committed. Records the OLD title as superseded now
  // whenever the title changes, and prunes entries past the lookback for this
  // post so the table stays bounded (renames are infrequent). Separate from
  // bump_revision() (which is shared with folders and has no title). CREATE OR
  // REPLACE TRIGGER is atomic (Postgres 14+), so a rerun never drops protection.
  console.log("Installing record_title_supersede() trigger on posts...");
  await sql`
    CREATE OR REPLACE FUNCTION record_title_supersede() RETURNS trigger AS $$
    BEGIN
      IF NEW.title IS DISTINCT FROM OLD.title THEN
        INSERT INTO post_title_history (post_id, title, superseded_at)
          VALUES (OLD.id, OLD.title, now());
        DELETE FROM post_title_history
          WHERE post_id = OLD.id
            AND superseded_at < now() - interval '10 minutes';
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    CREATE OR REPLACE TRIGGER posts_record_title_supersede AFTER UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION record_title_supersede()
  `;

  console.log("Creating action_audit_target_created_idx (if missing)...");
  await sql`
    CREATE INDEX IF NOT EXISTS action_audit_target_created_idx
      ON action_audit (target_id, created_at)
  `;

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
