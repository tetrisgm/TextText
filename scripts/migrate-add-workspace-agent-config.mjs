#!/usr/bin/env node
// Idempotent migration for workspace-owned assistant instructions and skills.

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "DATABASE_URL is not configured; skipping agent instruction migration.",
  );
  process.exit(0);
}

const sql = await connectMigrationDatabase(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS workspace_agent_config (
    blog_id uuid PRIMARY KEY REFERENCES blogs(id) ON DELETE CASCADE,
    instructions text NOT NULL DEFAULT '',
    skills jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT workspace_agent_config_instructions_length
      CHECK (char_length(instructions) <= 8000),
    CONSTRAINT workspace_agent_config_skills_array
      CHECK (jsonb_typeof(skills) = 'array')
  )
`);
await sql.close();
console.log("Workspace agent instruction table is ready.");
