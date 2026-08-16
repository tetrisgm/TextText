// One-shot migration: drop the OAuth tables.
//
// Agents authenticate with a workspace token a person creates and pastes
// (owner ruling 2026-08-15). The authorization-code, dynamic-client and
// refresh-family tables served the OAuth flow only; api_tokens, which is what
// actually authorizes an agent, is untouched.
//
//   node scripts/migrate-drop-oauth.mjs
//
// Idempotent (DROP TABLE IF EXISTS). Reads DATABASE_URL from the environment
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
    SELECT count(*)::int AS n FROM api_tokens WHERE revoked_at IS NULL
  `;
  console.log(`${n} live workspace token(s); those keep working.`);

  console.log("Dropping oauth_refresh_token_families...");
  await sql`DROP TABLE IF EXISTS oauth_refresh_token_families`;
  console.log("Dropping oauth_authorization_codes...");
  await sql`DROP TABLE IF EXISTS oauth_authorization_codes`;
  console.log("Dropping oauth_clients...");
  await sql`DROP TABLE IF EXISTS oauth_clients`;

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
