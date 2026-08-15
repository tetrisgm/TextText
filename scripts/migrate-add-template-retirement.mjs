// One-shot migration: document_templates.retired_at, which lets a workspace
// stop offering a look without deleting immutable versions that documents pin.
//
//   node scripts/migrate-add-template-retirement.mjs
//
// Idempotent. Reads DATABASE_URL from the environment or from .env.local.

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
  console.log("Adding document_templates.retired_at...");
  await sql`ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS retired_at timestamp`;
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
