// One-shot migration: switch every post we created to the `.textpack`
// representation (a single zipped textbundle). Owner decision: ALWAYS create as
// `.textpack`; other formats are only for files we did NOT create. `.textpack` is
// one flat file, so it keeps the phantom-free guarantee of flat `.md` while
// bundling assets and importing into Bear/Ulysses. See
// DEFAULT_FILE_REPRESENTATION in src/lib/content.ts.
//
//   node scripts/migrate-flip-representation-to-textpack.mjs
//
// posts.file_representation is immutable (a BEFORE UPDATE trigger). This flip
// drops that guard, adds the `textpack` enum value, moves the column default,
// flips every non-textpack post, then RE-INSTALLS the guard so representation
// stays locked. Idempotent. Reads DATABASE_URL from the environment or .env.local.
//
// RE-RUN on any new / restored database, alongside the other migrations. Runs
// AFTER migrate-flip-representation-to-markdown.mjs (which is a no-op once this
// has run).

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

  console.log("Adding the 'textpack' enum value (if missing)...");
  // ADD VALUE cannot run in a txn and can't be used in the same statement; neon
  // autocommits per call, so this lands before the UPDATE below.
  await sql`ALTER TYPE file_representation ADD VALUE IF NOT EXISTS 'textpack'`;

  console.log("Dropping the file_representation immutability guard...");
  await sql`DROP TRIGGER IF EXISTS posts_file_representation_immutable ON posts`;

  console.log("Moving posts.file_representation default to textpack...");
  await sql`ALTER TABLE posts ALTER COLUMN file_representation SET DEFAULT 'textpack'`;

  console.log("Flipping every non-textpack post to textpack (incl. trashed)...");
  const flipped = await sql`
    UPDATE posts SET file_representation = 'textpack'
    WHERE file_representation <> 'textpack'
    RETURNING id
  `;
  console.log(`  flipped ${flipped.length} post(s)`);

  console.log("Re-installing the immutability guard (now locked at textpack)...");
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
      count(*) FILTER (WHERE file_representation = 'textpack')::int AS textpack,
      count(*) FILTER (WHERE file_representation <> 'textpack')::int AS other
    FROM posts
  `;
  console.log(`Done. textpack=${summary.textpack} other=${summary.other}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
