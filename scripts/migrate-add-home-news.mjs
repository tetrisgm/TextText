#!/usr/bin/env node
// The home page as a news front page: the representative image a feed
// supplies for an item. Later revisions of this script add the Summary
// and preference tables; every statement stays idempotent.
//
//   node scripts/migrate-add-home-news.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping home news migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Adding reading_provenance.image_url...");
await sql`ALTER TABLE reading_provenance ADD COLUMN IF NOT EXISTS image_url text`;
await sql.close();
console.log("Done.");
