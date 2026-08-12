#!/usr/bin/env node
// Idempotent migration for encrypted, workspace-scoped cloud AI credentials.

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping workspace AI migration.");
  process.exit(0);
}

const sql = await connectMigrationDatabase(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS workspace_ai_config (
    blog_id uuid PRIMARY KEY REFERENCES blogs(id) ON DELETE CASCADE,
    provider text NOT NULL,
    model text,
    api_key_ciphertext text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT workspace_ai_config_provider_valid
      CHECK (provider IN ('anthropic', 'openai'))
  )
`);
await sql.query(`
  ALTER TABLE workspace_ai_config
  ADD COLUMN IF NOT EXISTS model text
`);
await sql.query(`
  UPDATE workspace_ai_config
  SET model = CASE
      WHEN provider = 'openai' THEN 'gpt-5.6'
    ELSE 'claude-sonnet-5'
  END
  WHERE model IS NULL
`);
await sql.query(`
  ALTER TABLE workspace_ai_config
  ALTER COLUMN model SET NOT NULL
`);
await sql.close();
console.log("Workspace AI configuration table is ready.");
