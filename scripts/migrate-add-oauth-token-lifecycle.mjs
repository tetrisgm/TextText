#!/usr/bin/env node
// Idempotent OAuth token-lifecycle migration. It adds expiring OAuth access
// tokens and hashed rotating refresh-token families. Runtime rotation keeps
// replay detection and family-wide access-token revocation in one transaction.
//
//   node scripts/migrate-add-oauth-token-lifecycle.mjs

import pkg from "@next/env";
import { neon } from "@neondatabase/serverless";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping OAuth migration.");
  process.exit(0);
}

const sql = neon(databaseUrl);

console.log("Adding nullable access-token expiry...");
await sql`
  ALTER TABLE api_tokens
    ADD COLUMN IF NOT EXISTS expires_at timestamp
`;

console.log("Creating OAuth refresh-token lifecycle tables...");
await sql`
  CREATE TABLE IF NOT EXISTS oauth_refresh_token_families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    client_id text NOT NULL,
    scope text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    last_used_at timestamp NOT NULL DEFAULT now(),
    absolute_expires_at timestamp NOT NULL,
    inactivity_expires_at timestamp NOT NULL,
    revoked_at timestamp,
    replay_detected_at timestamp
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS oauth_refresh_families_user_idx
    ON oauth_refresh_token_families (user_id)
`;
await sql`
  CREATE INDEX IF NOT EXISTS oauth_refresh_families_client_idx
    ON oauth_refresh_token_families (client_id)
`;

await sql`
  CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    api_token_id uuid PRIMARY KEY
      REFERENCES api_tokens(id) ON DELETE CASCADE,
    refresh_token_family_id uuid NOT NULL
      REFERENCES oauth_refresh_token_families(id) ON DELETE CASCADE,
    created_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS oauth_access_tokens_family_idx
    ON oauth_access_tokens (refresh_token_family_id)
`;

await sql`
  CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refresh_token_family_id uuid NOT NULL
      REFERENCES oauth_refresh_token_families(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    access_token_id uuid REFERENCES api_tokens(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    consumed_at timestamp
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS oauth_refresh_tokens_hash_idx
    ON oauth_refresh_tokens (token_hash)
`;
await sql`
  CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_family_idx
    ON oauth_refresh_tokens (refresh_token_family_id)
`;

const [summary] = await sql`
  SELECT
    (SELECT count(*)::int FROM oauth_refresh_token_families) AS families,
    (SELECT count(*)::int FROM oauth_refresh_tokens) AS refresh_tokens,
    (SELECT count(*)::int FROM oauth_access_tokens) AS oauth_access_tokens
`;
console.log(
  `OAuth lifecycle ready. families=${summary.families} ` +
    `refresh_tokens=${summary.refresh_tokens} ` +
    `access_tokens=${summary.oauth_access_tokens}`,
);
