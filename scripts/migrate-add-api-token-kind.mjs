// Add the connection kind used to explain machine capabilities in Settings.
// Existing tokens are preserved as manual capabilities; callers that create
// known app or MCP tokens write their kind explicitly from this point forward.
//
//   node scripts/migrate-add-api-token-kind.mjs
//
// Idempotent. Reads DATABASE_URL from the environment or .env.local.

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("DATABASE_URL is not configured; skipping api token kind migration.");
    return;
  }
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes(".neon.tech")
      ? { rejectUnauthorized: true }
      : undefined,
  });
  await client.connect();
  console.log("Adding api_tokens.kind...");
  await client.query(`
    ALTER TABLE api_tokens
      ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual'
  `);
  await client.query(`
    UPDATE api_tokens
      SET kind = 'manual'
      WHERE kind IS NULL OR kind = ''
  `);
  await client.query(`
    DO $$
    BEGIN
      ALTER TABLE api_tokens
        ADD CONSTRAINT api_tokens_kind_valid
        CHECK (kind in ('manual', 'mcp', 'cli', 'native', 'app', 'other'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);
  await client.end();
  console.log("api_tokens.kind ready.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
