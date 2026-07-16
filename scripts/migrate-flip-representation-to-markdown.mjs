// One-shot migration: switch every post from the `.textbundle` package
// representation to a flat `<title>.md` file. This is the STRUCTURAL fix for the
// File Provider rename revert-loop: a package's directory name and its inner
// text.md reconcile on separate schedules, so a server rename could leave
// {content: new, dirname: old} and the client would push the stale name back,
// reverting the rename in a loop. A flat .md is a single inode — name and content
// are one node and move together — so that split state (and the phantom) cannot
// exist. See DEFAULT_FILE_REPRESENTATION in src/lib/content.ts.
//
//   node scripts/migrate-flip-representation-to-markdown.mjs
//
// posts.file_representation is normally immutable (a BEFORE UPDATE trigger,
// posts_file_representation_immutable). This one-time correction drops that
// guard, flips every textbundle row (including trashed) to markdown, moves the
// column default to markdown, then RE-INSTALLS the immutability guard so the
// representation stays locked at markdown going forward. Idempotent: a rerun
// flips zero rows and re-asserts the default + guard. Reads DATABASE_URL from the
// environment or from .env.local.
//
// RE-RUN this on any new / restored database, alongside the other migrations.

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

  console.log("Dropping the file_representation immutability guard...");
  await sql`DROP TRIGGER IF EXISTS posts_file_representation_immutable ON posts`;

  console.log("Moving posts.file_representation default to markdown...");
  await sql`ALTER TABLE posts ALTER COLUMN file_representation SET DEFAULT 'markdown'`;

  console.log("Flipping existing textbundle posts to markdown (incl. trashed)...");
  const flipped = await sql`
    UPDATE posts SET file_representation = 'markdown'
    WHERE file_representation = 'textbundle'
    RETURNING id
  `;
  console.log(`  flipped ${flipped.length} post(s)`);

  console.log("Re-installing the immutability guard (now locked at markdown)...");
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
      count(*) FILTER (WHERE file_representation = 'textbundle')::int AS textbundle,
      count(*) FILTER (WHERE file_representation = 'markdown')::int AS markdown
    FROM posts
  `;
  console.log(`Done. textbundle=${summary.textbundle} markdown=${summary.markdown}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
