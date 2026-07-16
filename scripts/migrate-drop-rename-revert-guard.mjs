// One-shot migration: remove the server-side rename-revert guard. It was a
// stopgap for the File Provider .textbundle phantom (a package's directory name
// could lag its content and get pushed back as a stale rename). Posts now sync as
// flat `<title>.md` files (one inode; name and content cannot diverge), so the
// phantom is structurally impossible and the guard is dead weight. The ordinary
// If-Match + revision CAS is the sole, sufficient conflict fence.
//
//   node scripts/migrate-drop-rename-revert-guard.mjs
//
// Idempotent (DROP ... IF EXISTS). Drops the post_title_history table + trigger
// + function and the guard's audit index, plus the artifacts of the guard's
// earlier previous_title iteration. Reads DATABASE_URL from the environment or
// from .env.local. Safe to run only after every client has converged off
// `.textbundle` (no rows WHERE file_representation = 'textbundle').

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

  // Safety: refuse to drop the guard while any post still syncs as a package,
  // because an un-converged client could still produce the phantom.
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM posts WHERE file_representation = 'textbundle'
  `;
  if (n > 0) {
    throw new Error(
      `Refusing to drop the rename-revert guard: ${n} post(s) still on textbundle. ` +
        `Run migrate-flip-representation-to-markdown.mjs and let clients converge first.`,
    );
  }

  console.log("Dropping post_title_history table + trigger + function...");
  await sql`DROP TRIGGER IF EXISTS posts_record_title_supersede ON posts`;
  await sql`DROP FUNCTION IF EXISTS record_title_supersede()`;
  await sql`DROP TABLE IF EXISTS post_title_history`;

  console.log("Dropping the guard's audit index...");
  await sql`DROP INDEX IF EXISTS action_audit_target_created_idx`;

  console.log("Dropping the earlier previous_title iteration (if present)...");
  await sql`DROP TRIGGER IF EXISTS posts_capture_previous_title ON posts`;
  await sql`DROP FUNCTION IF EXISTS capture_previous_title()`;
  await sql`ALTER TABLE posts DROP COLUMN IF EXISTS previous_title`;

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
