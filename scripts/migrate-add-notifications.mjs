#!/usr/bin/env node
// Outbound notification channels per workspace: Apprise-style URLs and
// plain webhooks the daily digest and saved-search alerts are routed to.
//
// Idempotent (IF NOT EXISTS).
//
//   node scripts/migrate-add-notifications.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping notifications migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Creating notification_channels...");
await sql`
  CREATE TABLE IF NOT EXISTS notification_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    kind text NOT NULL,
    url text NOT NULL,
    label text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    events jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_used_at timestamp,
    last_status text,
    last_detail text,
    created_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS notification_channels_blog_idx ON notification_channels (blog_id)`;
await sql.close();
console.log("Done.");
