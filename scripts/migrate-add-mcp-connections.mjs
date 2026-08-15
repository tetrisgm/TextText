// One-shot migration: the mcp_connections table, which holds the external MCP
// servers a workspace's assistant may call (the outbound half of Pillar 3).
//
//   node scripts/migrate-add-mcp-connections.mjs
//
// Idempotent (IF NOT EXISTS throughout). Reads DATABASE_URL from the
// environment or from .env.local.

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

  console.log("Creating mcp_connections...");
  await sql`
    CREATE TABLE IF NOT EXISTS mcp_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      name text NOT NULL,
      url text NOT NULL,
      token_ciphertext text,
      enabled boolean NOT NULL DEFAULT false,
      tool_names jsonb,
      last_checked_at timestamp,
      last_error text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;

  console.log("Creating indexes...");
  await sql`
    CREATE INDEX IF NOT EXISTS mcp_connections_blog_idx ON mcp_connections (blog_id)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mcp_connections_blog_name_idx
      ON mcp_connections (blog_id, name)
  `;

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
