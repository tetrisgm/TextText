#!/usr/bin/env node
// One GitHub App installation per workspace: where the backup goes, who
// connected it, and how it last went. No secret lives here; the token that
// reaches the repository is minted per call from the app's private key.
//
// Idempotent (IF NOT EXISTS).
//
//   node scripts/migrate-add-github.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping github migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Creating github_installations...");
await sql`
  CREATE TABLE IF NOT EXISTS github_installations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    installation_id bigint NOT NULL,
    account_login text NOT NULL,
    account_type text NOT NULL,
    repository_selection text NOT NULL,
    connected_by_login text,
    connected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    backup_repository text,
    backup_branch text,
    backup_schedule text NOT NULL DEFAULT 'off',
    backup_last_run_at timestamp,
    backup_last_status text,
    backup_last_detail text,
    backup_last_commit text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS github_installations_blog_idx
    ON github_installations (blog_id)
`;
await sql.close();
console.log("Done.");
