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

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const sql = await connectMigrationDatabase(databaseUrl);

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM api_tokens WHERE revoked_at IS NULL
  `;
  console.log(`${n} live workspace token(s); those keep working.`);

  // Drop the children before the family table. Production still has these
  // foreign keys from migrate-add-oauth-token-lifecycle, and relying on
  // CASCADE would make this cleanup broader than the named OAuth tables.
  console.log("Dropping oauth_access_tokens...");
  await sql`DROP TABLE IF EXISTS oauth_access_tokens`;
  console.log("Dropping oauth_refresh_tokens...");
  await sql`DROP TABLE IF EXISTS oauth_refresh_tokens`;
  console.log("Dropping oauth_authorization_codes...");
  await sql`DROP TABLE IF EXISTS oauth_authorization_codes`;
  console.log("Dropping oauth_refresh_token_families...");
  await sql`DROP TABLE IF EXISTS oauth_refresh_token_families`;
  console.log("Dropping oauth_clients...");
  await sql`DROP TABLE IF EXISTS oauth_clients`;

  console.log("Done.");
  await sql.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
