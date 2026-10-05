#!/usr/bin/env node
// Connector OAuth grants use their own tables. The historical drop-oauth
// migration intentionally does not touch these names on later deployments.
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const sql = await connectMigrationDatabase(databaseUrl);
  try {
    await sql`ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS audience text`;
    await sql`
      CREATE TABLE IF NOT EXISTS connector_oauth_authorization_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code_hash text NOT NULL UNIQUE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id text NOT NULL,
        redirect_uri text NOT NULL,
        code_challenge text NOT NULL,
        scope text NOT NULL,
        resource text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        expires_at timestamp NOT NULL,
        consumed_at timestamp
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS connector_oauth_refresh_token_families (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id text NOT NULL,
        scope text NOT NULL,
        resource text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        last_used_at timestamp NOT NULL DEFAULT now(),
        absolute_expires_at timestamp NOT NULL,
        inactivity_expires_at timestamp NOT NULL,
        revoked_at timestamp,
        replay_detected_at timestamp
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS connector_oauth_refresh_families_user_idx
      ON connector_oauth_refresh_token_families (user_id)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS connector_oauth_access_tokens (
        api_token_id uuid PRIMARY KEY REFERENCES api_tokens(id) ON DELETE CASCADE,
        refresh_token_family_id uuid NOT NULL
          REFERENCES connector_oauth_refresh_token_families(id) ON DELETE CASCADE,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS connector_oauth_access_tokens_family_idx
      ON connector_oauth_access_tokens (refresh_token_family_id)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS connector_oauth_refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        refresh_token_family_id uuid NOT NULL
          REFERENCES connector_oauth_refresh_token_families(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        access_token_id uuid REFERENCES api_tokens(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        consumed_at timestamp
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS connector_oauth_refresh_tokens_family_idx
      ON connector_oauth_refresh_tokens (refresh_token_family_id)
    `;
  } finally {
    await sql.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
