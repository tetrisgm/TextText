// One-shot migration: add the co-editing log GENERATION (epoch) + body
// provenance so a log left stale between sessions cannot overwrite an
// out-of-band body write (collab durability hole 2). Adds:
//   - collab_updates.epoch  (int, default 0): the generation a log row belongs
//     to; retired generations are ignored by the relay, never deleted, and an
//     append fenced on an old epoch is rejected.
//   - collab_state (post_id PK, epoch, materialized_revision, updated_at): the
//     current generation and the posts.revision the log last materialized into
//     posts.body.
//
//   node scripts/migrate-add-collab-epoch.mjs
//
// Idempotent (IF NOT EXISTS). Reads DATABASE_URL from the environment or from
// .env.local (no dotenv dep). Additive only. Existing posts get epoch 0 and no
// collab_state row; the runtime treats "no collab_state / NULL
// materialized_revision" as "reseed once from posts.body on next open", which is
// the accepted reset of any pre-existing co-editing log (owner-approved).

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

  console.log("Adding collab_updates.epoch (default 0)...");
  await sql`
    ALTER TABLE collab_updates
      ADD COLUMN IF NOT EXISTS epoch integer NOT NULL DEFAULT 0
  `;

  console.log("Creating collab_state (if missing)...");
  await sql`
    CREATE TABLE IF NOT EXISTS collab_state (
      post_id uuid PRIMARY KEY REFERENCES posts(id),
      epoch integer NOT NULL DEFAULT 0,
      materialized_revision bigint,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
