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

  console.log("Scoping live slugs to their folders...");
  await sql`
    INSERT INTO folders (blog_id, name, path, mode, position)
    SELECT b.id, seed.name, seed.path, seed.mode, seed.position
    FROM blogs AS b
    CROSS JOIN (VALUES
      ('Blog', 'blog', 'blog', 0),
      ('Notes', 'notes', 'notes', 1),
      ('Bookmarks', 'bookmarks', 'bookmarks', 2)
    ) AS seed(name, path, mode, position)
    WHERE NOT EXISTS (
        SELECT 1 FROM folders AS f
        WHERE f.blog_id = b.id
          AND f.path = seed.path
          AND f.deleted_at IS NULL
      )
  `;
  await sql`
    UPDATE posts AS p
    SET folder_id = f.id
    FROM folders AS f
    WHERE p.folder_id IS NULL
      AND f.blog_id = p.blog_id
      AND f.path = CASE
        WHEN p.type = 'note' THEN 'notes'
        WHEN p.type = 'bookmark' THEN 'bookmarks'
        ELSE 'blog'
      END
      AND f.deleted_at IS NULL
  `;
  await sql`ALTER TABLE posts ALTER COLUMN folder_id SET NOT NULL`;
  await sql`DROP INDEX IF EXISTS posts_blog_slug_idx`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS posts_folder_slug_idx
      ON posts (folder_id, slug)
      WHERE deleted_at IS NULL
  `;

  console.log("Installing durable public-URL tombstones...");
  await sql`
    CREATE TABLE IF NOT EXISTS public_url_tombstones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      path text NOT NULL,
      post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS public_url_tombstones_blog_path_idx
      ON public_url_tombstones (blog_id, path)
  `;
  // Freeze the owner of every URL that existed before folder-qualified public
  // routes. New per-folder duplicates must never capture one of those links.
  await sql`
    INSERT INTO public_url_tombstones (blog_id, path, post_id)
    SELECT blog_id, '@legacy/' || slug, id
    FROM posts
    WHERE deleted_at IS NULL
      AND visibility = 'public'
      AND type NOT IN ('note', 'bookmark')
    ON CONFLICT (blog_id, path) DO NOTHING
  `;
  await sql`
    WITH aliases AS (
      SELECT blog_id, unnest(slug_history) AS slug, id AS post_id
      FROM posts
      WHERE deleted_at IS NULL
        AND visibility = 'public'
        AND type NOT IN ('note', 'bookmark')
    ), unique_aliases AS (
      SELECT blog_id, slug, min(post_id::text)::uuid AS post_id
      FROM aliases
      WHERE slug <> ''
      GROUP BY blog_id, slug
      HAVING count(DISTINCT post_id) = 1
    )
    INSERT INTO public_url_tombstones (blog_id, path, post_id)
    SELECT blog_id, '@legacy/' || slug, post_id FROM unique_aliases
    ON CONFLICT (blog_id, path) DO NOTHING
  `;
  await sql`
    CREATE OR REPLACE FUNCTION guard_public_post_path() RETURNS trigger AS $$
    DECLARE
      new_folder_path text;
      new_public_path text;
      reserved_for uuid;
    BEGIN
      IF NEW.visibility <> 'public'
         OR NEW.type IN ('note', 'bookmark')
         OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
      END IF;
      SELECT path INTO new_folder_path FROM folders WHERE id = NEW.folder_id;
      new_public_path := new_folder_path || '/' || NEW.slug;
      PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.blog_id::text || ':' || new_public_path, 0)
      );
      SELECT post_id INTO reserved_for
      FROM public_url_tombstones
      WHERE blog_id = NEW.blog_id AND path = new_public_path;
      IF FOUND AND reserved_for IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'public URL is reserved'
          USING ERRCODE = 'unique_violation',
                CONSTRAINT = 'public_url_tombstones_blog_path_idx';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS posts_guard_public_path ON posts`;
  await sql`
    CREATE TRIGGER posts_guard_public_path
      BEFORE INSERT OR UPDATE OF blog_id, folder_id, slug, visibility, deleted_at ON posts
      FOR EACH ROW EXECUTE FUNCTION guard_public_post_path()
  `;
  await sql`
    CREATE OR REPLACE FUNCTION preserve_public_post_path() RETURNS trigger AS $$
    DECLARE
      old_folder_path text;
      old_public_path text;
      leaves_public_path boolean;
    BEGIN
      IF OLD.visibility <> 'public'
         OR OLD.type IN ('note', 'bookmark')
         OR OLD.deleted_at IS NOT NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END IF;

      leaves_public_path := TG_OP = 'DELETE'
        OR NEW.deleted_at IS NOT NULL
        OR NEW.visibility <> 'public'
        OR NEW.blog_id IS DISTINCT FROM OLD.blog_id
        OR NEW.folder_id IS DISTINCT FROM OLD.folder_id
        OR NEW.slug IS DISTINCT FROM OLD.slug;
      IF NOT leaves_public_path THEN
        RETURN NEW;
      END IF;

      SELECT path INTO old_folder_path FROM folders WHERE id = OLD.folder_id;
      old_folder_path := COALESCE(old_folder_path, 'blog');
      old_public_path := old_folder_path || '/' || OLD.slug;
      PERFORM pg_advisory_xact_lock(
        hashtextextended(OLD.blog_id::text || ':' || old_public_path, 0)
      );

      INSERT INTO public_url_tombstones (blog_id, path, post_id, updated_at)
      VALUES (OLD.blog_id, old_public_path, OLD.id, now())
      ON CONFLICT (blog_id, path) DO NOTHING;

      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS posts_preserve_public_path ON posts`;
  await sql`
    CREATE TRIGGER posts_preserve_public_path
      BEFORE UPDATE OF blog_id, folder_id, slug, visibility, deleted_at OR DELETE ON posts
      FOR EACH ROW EXECUTE FUNCTION preserve_public_post_path()
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
