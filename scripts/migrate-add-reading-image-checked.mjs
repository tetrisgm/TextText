#!/usr/bin/env node
// Feed items get a picture.
//
// Most feeds send none, and a news surface without photographs is a wall of
// type. The page behind an item's link almost always declares a social card
// image, so the app's own tick asks for it once per item. This column records
// that it asked, whatever the answer, so a page with no picture is never
// asked twice.
//
// Idempotent (IF NOT EXISTS).
//
//   node scripts/migrate-add-reading-image-checked.mjs
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping reading image migration.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);

console.log("Adding reading_provenance.image_checked_at...");
await sql`ALTER TABLE reading_provenance ADD COLUMN IF NOT EXISTS image_checked_at timestamptz`;

console.log("Indexing the items still waiting for one...");
await sql`
  CREATE INDEX IF NOT EXISTS reading_provenance_image_pending_idx
    ON reading_provenance (blog_id, published_at DESC)
    WHERE image_url IS NULL AND image_checked_at IS NULL
`;

console.log("Done.");
process.exit(0);
