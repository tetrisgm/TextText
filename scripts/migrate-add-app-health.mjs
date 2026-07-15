#!/usr/bin/env node
import pkg from "@next/env";
import { neon } from "@neondatabase/serverless";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping app health migration.");
  process.exit(0);
}

const sql = neon(databaseUrl);
await sql.query(`
  CREATE TABLE IF NOT EXISTS app_health_reports (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    installation_id uuid NOT NULL,
    app_identifier text NOT NULL,
    app_version text NOT NULL,
    build_number text NOT NULL,
    trigger text NOT NULL,
    status text NOT NULL,
    report jsonb NOT NULL,
    generated_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
  )
`);
await sql.query(`
  CREATE INDEX IF NOT EXISTS app_health_reports_user_received_idx
  ON app_health_reports (user_id, received_at)
`);
await sql.query(`
  CREATE INDEX IF NOT EXISTS app_health_reports_installation_received_idx
  ON app_health_reports (installation_id, received_at)
`);
console.log("App health report table is ready.");
