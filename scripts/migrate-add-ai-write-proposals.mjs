#!/usr/bin/env node
// Durable, single-use approval records for cloud-assistant workspace writes.

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping AI write proposal migration.");
  process.exit(0);
}

const sql = await connectMigrationDatabase(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS ai_write_proposals (
    id uuid PRIMARY KEY,
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposal_kind text NOT NULL DEFAULT 'workspace',
    connection_id uuid REFERENCES mcp_connections(id) ON DELETE SET NULL,
    tool_name text NOT NULL,
    arguments jsonb NOT NULL,
    metadata jsonb,
    status text NOT NULL DEFAULT 'pending',
    receipt jsonb,
    failure_code text,
    created_at timestamp NOT NULL DEFAULT now(),
    expires_at timestamp NOT NULL,
    decided_at timestamp,
    completed_at timestamp,
    CONSTRAINT ai_write_proposals_status_valid
      CHECK (status IN ('pending', 'executing', 'completed', 'denied', 'failed')),
    CONSTRAINT ai_write_proposals_kind_valid
      CHECK (proposal_kind IN ('workspace', 'outbound_mcp'))
  )
`);
await sql.query(`
  ALTER TABLE ai_write_proposals
  ADD COLUMN IF NOT EXISTS proposal_kind text NOT NULL DEFAULT 'workspace',
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES mcp_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb
`);
await sql.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ai_write_proposals_kind_valid'
    ) THEN
      ALTER TABLE ai_write_proposals
      ADD CONSTRAINT ai_write_proposals_kind_valid
      CHECK (proposal_kind IN ('workspace', 'outbound_mcp'));
    END IF;
  END $$
`);
await sql.query(`
  ALTER TABLE ai_write_proposals
  DROP CONSTRAINT IF EXISTS ai_write_proposals_remote_connection_valid
`);
await sql.query(`
  CREATE INDEX IF NOT EXISTS ai_write_proposals_owner_status_idx
  ON ai_write_proposals (actor_user_id, blog_id, status)
`);
await sql.query(`
  CREATE INDEX IF NOT EXISTS ai_write_proposals_pending_expiry_idx
  ON ai_write_proposals (expires_at)
  WHERE status = 'pending'
`);
await sql.close();
console.log("AI write proposal table is ready.");
