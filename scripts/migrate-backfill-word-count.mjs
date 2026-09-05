#!/usr/bin/env node
// Backfill posts.word_count where it is null.
//
// The workspace list selects coalesce(word_count, <split body on whitespace>)
// so a row without a stored count is counted at read time, on every load, over
// its whole body. One 7MB fixture made the workspace home render take a full
// second in that fallback. Every write path stores the count; this brings the
// rows written before the column existed, or by importers, up to date.
import pkg from "@next/env";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";
pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping word_count backfill.");
  process.exit(0);
}
const sql = await connectMigrationDatabase(databaseUrl);
const result = await sql.query(`
  UPDATE posts
  SET word_count = CASE
    WHEN btrim(body) = '' THEN 0
    ELSE cardinality(regexp_split_to_array(btrim(body), '[[:space:]]+'))
  END
  WHERE word_count IS NULL
`);
console.log(`word_count backfilled on ${result.rowCount ?? 0} post(s).`);
await sql.close();
