// Idempotent migration for durable post aliases. The trigger records a slug's
// previous value in the same statement that changes it, eliminating the race
// inherent in application-level read-then-write history maintenance.
//
//   node scripts/migrate-add-slug-history.mjs

// Reads DATABASE_URL from the environment or .env.local (no dotenv dependency).

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
    // Fall through to the explicit error below.
  }
  throw new Error("DATABASE_URL not set and not found in .env.local");
}

async function main() {
  const sql = neon(loadDatabaseUrl());

  console.log("Adding posts.slug_history...");
  await sql`
    ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS slug_history text[] NOT NULL
      DEFAULT ARRAY[]::text[]
  `;

  console.log("Installing atomic slug-history trigger...");
  await sql`
    CREATE OR REPLACE FUNCTION track_post_slug_history() RETURNS trigger AS $$
    DECLARE
      candidate text;
      history text[] := ARRAY[]::text[];
    BEGIN
      IF NEW.slug IS DISTINCT FROM OLD.slug THEN
        FOREACH candidate IN ARRAY
          array_prepend(OLD.slug, COALESCE(OLD.slug_history, ARRAY[]::text[]))
        LOOP
          IF candidate IS NOT NULL
             AND candidate <> ''
             AND candidate <> NEW.slug
             AND NOT (candidate = ANY(history)) THEN
            history := array_append(history, candidate);
            EXIT WHEN cardinality(history) >= 20;
          END IF;
        END LOOP;
        NEW.slug_history := history;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    CREATE OR REPLACE TRIGGER posts_track_slug_history
      BEFORE UPDATE OF slug ON posts
      FOR EACH ROW EXECUTE FUNCTION track_post_slug_history()
  `;

  console.log("Creating slug-history lookup index...");
  // The resolver includes deleted exact-slug rows as tombstones, so its OR
  // query cannot imply the old `deleted_at IS NULL` partial-index predicate.
  // Keep a full GIN index that PostgreSQL can use for the history branch.
  await sql`DROP INDEX IF EXISTS posts_slug_history_gin_idx`;
  await sql`
    CREATE INDEX IF NOT EXISTS posts_slug_history_gin_full_idx
      ON posts USING gin (slug_history)
  `;

  const [summary] = await sql`
    SELECT
      count(*)::int AS posts,
      count(*) FILTER (WHERE cardinality(slug_history) > 0)::int AS aliases,
      coalesce(max(cardinality(slug_history)), 0)::int AS max_aliases
    FROM posts
  `;
  console.log(
    `Done. posts=${summary.posts} posts_with_aliases=${summary.aliases} max_aliases=${summary.max_aliases}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
