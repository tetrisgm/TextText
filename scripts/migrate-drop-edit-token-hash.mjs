// One-shot migration: drop blogs.edit_token_hash. It held the SHA-256 hash of
// the anonymous guest-workspace edit token; the guest/claim flow was removed
// 2026-08-14 (docs/SPEC.md rules trial workspaces out of scope), so no code
// reads or writes the column. Unclaimed blogs (owner_id IS NULL) are already
// unreachable: no route can mint their token cookie anymore.
//
//   node scripts/migrate-drop-edit-token-hash.mjs
//
// Idempotent (DROP COLUMN IF EXISTS). Reads DATABASE_URL from the environment
// or from .env.local.

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

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM blogs
    WHERE owner_id IS NULL AND deleted_at IS NULL
  `;
  if (n > 0) {
    console.log(
      `Note: ${n} unclaimed blog(s) remain. They are unreachable (the claim ` +
        `flow is gone) and keep serving as public pages if published.`,
    );
  }

  console.log("Dropping blogs.edit_token_hash...");
  await sql`ALTER TABLE blogs DROP COLUMN IF EXISTS edit_token_hash`;

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
