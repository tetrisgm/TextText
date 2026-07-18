#!/usr/bin/env node
// Idempotent migration for encrypted, workspace-scoped cloud AI credentials.

import pkg from "@next/env";
import { neon } from "@neondatabase/serverless";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping workspace AI migration.");
  process.exit(0);
}

const sql = neon(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS workspace_ai_config (
    blog_id uuid PRIMARY KEY REFERENCES blogs(id) ON DELETE CASCADE,
    provider text NOT NULL,
    api_key_ciphertext text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT workspace_ai_config_provider_valid
      CHECK (provider IN ('anthropic', 'openai'))
  )
`);
console.log("Workspace AI configuration table is ready.");
