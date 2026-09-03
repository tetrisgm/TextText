#!/usr/bin/env node
// Raise the owner-only assistant history ceiling from 60 chats to 500.
//
// The row is still bounded, just not by a number small enough to lose real
// discussions: the size check (4MB) remains the actual limit, and the client
// evicts by recency long before a write could fail. The count check has to
// move in step with MAX_SYNCED_ASSISTANT_CONVERSATIONS, because a payload the
// browser considers legal would otherwise be rejected here and cross-device
// sync would stop converging silently.

import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "DATABASE_URL is not configured; skipping assistant history limit migration.",
  );
  process.exit(0);
}

const sql = await connectMigrationDatabase(databaseUrl);
const rows = await sql.query(`
  SELECT to_regclass('workspace_assistant_conversation_history') IS NOT NULL
    AS present
`);
if (!rows[0]?.present) {
  console.log(
    "Assistant conversation history table is absent; nothing to raise.",
  );
  await sql.close();
  process.exit(0);
}

// Idempotent: drop the old bound (whatever its value) and state the new one.
await sql.query(`
  ALTER TABLE workspace_assistant_conversation_history
    DROP CONSTRAINT IF EXISTS workspace_assistant_conversation_history_count
`);
await sql.query(`
  ALTER TABLE workspace_assistant_conversation_history
    ADD CONSTRAINT workspace_assistant_conversation_history_count
    CHECK (jsonb_array_length(conversations) <= 500)
`);
await sql.close();
console.log("Assistant conversation history holds up to 500 chats.");
