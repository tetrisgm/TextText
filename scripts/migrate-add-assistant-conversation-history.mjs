#!/usr/bin/env node
// Idempotent migration for bounded owner-only assistant conversation sync.

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "DATABASE_URL is not configured; skipping assistant conversation history migration.",
  );
  process.exit(0);
}

const sql = await connectMigrationDatabase(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS workspace_assistant_conversation_history (
    blog_id uuid PRIMARY KEY REFERENCES blogs(id) ON DELETE CASCADE,
    conversations jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT workspace_assistant_conversation_history_array
      CHECK (jsonb_typeof(conversations) = 'array'),
    CONSTRAINT workspace_assistant_conversation_history_count
      CHECK (jsonb_array_length(conversations) <= 60),
    CONSTRAINT workspace_assistant_conversation_history_size
      CHECK (octet_length(conversations::text) <= 4000000)
  )
`);
await sql.close();
console.log("Assistant conversation history table is ready.");
