// Idempotent migration for a post's immutable local file representation.
// Existing TextText content defaults to textbundle. Posts known to have been
// explicitly imported from external files through the pre-header sync API are
// backfilled to markdown once via their resolved idempotency key. Other
// idempotent creates (for example new-note:*) are TextText-created content and must
// remain TextBundles.
//
//   node scripts/migrate-add-file-representation.mjs

import { readFileSync } from "node:fs";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

const BACKFILL_MARKER = "texttext:file-representation:v1-backfilled";
const BACKFILL_MARKER_SUFFIX = ":file-representation:v1-backfilled";

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
  const sql = await connectMigrationDatabase(loadDatabaseUrl());

  console.log("Creating file_representation enum (if missing)...");
  await sql`
    DO $$
    BEGIN
      CREATE TYPE file_representation AS ENUM ('textbundle', 'markdown', 'text');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$
  `;
  await sql`ALTER TYPE file_representation ADD VALUE IF NOT EXISTS 'textbundle'`;
  await sql`ALTER TYPE file_representation ADD VALUE IF NOT EXISTS 'markdown'`;
  await sql`ALTER TYPE file_representation ADD VALUE IF NOT EXISTS 'text'`;

  console.log("Adding posts.file_representation...");
  await sql`
    ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS file_representation file_representation
      NOT NULL DEFAULT 'textbundle'
  `;

  const [column] = await sql`
    SELECT col_description(attribute.attrelid, attribute.attnum) AS comment
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'posts'::regclass
      AND attribute.attname = 'file_representation'
      AND NOT attribute.attisdropped
  `;

  let backfilled = 0;
  if (
    column?.comment?.endsWith(BACKFILL_MARKER_SUFFIX) &&
    column.comment !== BACKFILL_MARKER
  ) {
    await sql`
      COMMENT ON COLUMN posts.file_representation IS
        'texttext:file-representation:v1-backfilled'
    `;
  } else if (column?.comment !== BACKFILL_MARKER) {
    // A partially completed prior run may already have installed the guard.
    // Remove it only around this one-time historical correction.
    await sql`
      DROP TRIGGER IF EXISTS posts_file_representation_immutable ON posts
    `;

    const [tables] = await sql`
      SELECT to_regclass('idempotency_keys') IS NOT NULL AS has_idempotency_keys
    `;
    if (tables?.has_idempotency_keys) {
      const [summary] = await sql`
        WITH updated AS (
          UPDATE posts AS post
          SET file_representation = 'markdown'
          FROM idempotency_keys AS claim
          WHERE claim.result_kind = 'post'
            AND claim.result_id = post.id
            AND post.file_representation = 'textbundle'
            AND (
              claim.key LIKE 'external-file:%'
              OR claim.key LIKE 'file:%'
            )
          RETURNING post.id
        )
        SELECT count(*)::int AS count FROM updated
      `;
      backfilled = summary?.count ?? 0;
    }

    // The marker makes the historical inference genuinely one-shot. A later
    // sync create may intentionally select textbundle while also using an
    // idempotency key, and migration reruns must leave it untouched.
    await sql`
      COMMENT ON COLUMN posts.file_representation IS
        'texttext:file-representation:v1-backfilled'
    `;
  }

  console.log("Installing immutable representation trigger...");
  await sql`
    CREATE OR REPLACE FUNCTION reject_post_file_representation_change()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.file_representation IS DISTINCT FROM OLD.file_representation THEN
        RAISE EXCEPTION 'posts.file_representation is immutable'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`
    CREATE OR REPLACE TRIGGER posts_file_representation_immutable
      BEFORE UPDATE OF file_representation ON posts
      FOR EACH ROW EXECUTE FUNCTION reject_post_file_representation_change()
  `;

  const [summary] = await sql`
    SELECT
      count(*)::int AS posts,
      count(*) FILTER (WHERE file_representation = 'textbundle')::int AS textbundles,
      count(*) FILTER (WHERE file_representation = 'markdown')::int AS markdown,
      count(*) FILTER (WHERE file_representation = 'text')::int AS text
    FROM posts
  `;
  console.log(
    `Done. posts=${summary.posts} textbundle=${summary.textbundles} ` +
      `markdown=${summary.markdown} text=${summary.text} backfilled=${backfilled}`,
  );
  await sql.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
