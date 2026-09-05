#!/usr/bin/env node
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";
pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!process.env.DATABASE_URL) throw new Error("Agent history migration requires DATABASE_URL");
const sql = await connectMigrationDatabase(process.env.DATABASE_URL);
await sql`
  CREATE TABLE IF NOT EXISTS agent_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_type text NOT NULL CHECK (actor_type IN ('human', 'ai', 'external_agent')),
    connection_id text NOT NULL,
    run_id text NOT NULL,
    changes jsonb NOT NULL,
    revision bigint NOT NULL,
    capture_generation text,
    collab_epoch integer,
    collab_seq bigint,
    reverts_id uuid UNIQUE REFERENCES agent_changes(id) ON DELETE CASCADE,
    created_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS agent_changes_post_created_idx ON agent_changes (post_id, created_at, id)`;
await sql`ALTER TABLE collab_state ADD COLUMN IF NOT EXISTS mutation_version bigint NOT NULL DEFAULT 0`;
await sql.close();
