#!/usr/bin/env node
// Home opens as a list.
//
// `blogs.home_layout` defaulted to 'grid', a page layout from before Home
// owned this column, so a workspace created after the move still started on
// cards no matter what the app said its default was. Only the DEFAULT changes:
// a workspace that chose a layout keeps it, because the choice is the point of
// the column.
//
// Idempotent (SET DEFAULT is a fixed value). Runs inside
// scripts/run-release-migrations.sh, whose coverage guard refuses to ship if
// this file is not in its order.
//
//   node scripts/migrate-home-layout-default.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping home layout default.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

await client.query(`ALTER TABLE blogs ALTER COLUMN home_layout SET DEFAULT 'list'`);

const { rows } = await client.query(
  `SELECT column_default FROM information_schema.columns
     WHERE table_name = 'blogs' AND column_name = 'home_layout'`,
);
console.log(`home layout default: ${rows[0]?.column_default ?? "unset"}`);

await client.end();
