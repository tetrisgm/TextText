#!/usr/bin/env node
// Re-syncs a document snapshot with its search projection.
//
// title, body and tags are projections of the canonical document. The bookmark
// capture path used to write the columns without the document, so a captured
// bookmark could end up claiming a title of "gamedeveloper.com" in its snapshot
// while the column held the real headline. That is fixed at the source in
// saveBookmarkCapture; this repairs the rows written before the fix.
//
// The COLUMN wins, deliberately. It holds what the capture actually fetched and
// what every list, search and file name has been showing; the snapshot holds
// the stale placeholder. Copying the other way would rename documents back to
// bare hostnames in front of the person who owns them.
//
// Read-only unless --apply is passed.
//
//   node scripts/repair-canonical-projections.mjs           # report
//   node scripts/repair-canonical-projections.mjs --apply   # fix

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; nothing to repair.");
  process.exit(0);
}
const apply = process.argv.includes("--apply");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

const { rows } = await client.query(
  `SELECT id, title, body, tags, document FROM posts WHERE document IS NOT NULL`,
);

const drifted = [];
for (const row of rows) {
  const content = row.document?.content;
  if (!content) continue;
  const titleDiffers = content.title !== row.title;
  const bodyDiffers = content.body !== row.body;
  const tagsDiffer =
    JSON.stringify(content.tags ?? []) !== JSON.stringify(row.tags ?? []);
  if (titleDiffers || bodyDiffers || tagsDiffer) {
    drifted.push({ row, titleDiffers, bodyDiffers, tagsDiffer });
  }
}

console.log(`scanned ${rows.length} documents, ${drifted.length} drifted`);
for (const { row, titleDiffers, bodyDiffers, tagsDiffer } of drifted) {
  const parts = [
    titleDiffers ? "title" : null,
    bodyDiffers ? "body" : null,
    tagsDiffer ? "tags" : null,
  ].filter(Boolean);
  console.log(`  ${row.id}  [${parts.join(", ")}]`);
  if (titleDiffers) {
    console.log(`      document: ${JSON.stringify(row.document.content.title)}`);
    console.log(`      column:   ${JSON.stringify(row.title)}`);
  }
}

if (!apply) {
  console.log(drifted.length ? "\nrun again with --apply to repair" : "");
  await client.end();
  process.exit(0);
}

let repaired = 0;
for (const { row } of drifted) {
  const next = {
    ...row.document,
    content: {
      ...row.document.content,
      title: row.title,
      body: row.body,
      tags: row.tags ?? [],
    },
  };
  await client.query(`UPDATE posts SET document = $1 WHERE id = $2`, [
    JSON.stringify(next),
    row.id,
  ]);
  repaired += 1;
}
await client.end();
console.log(`repaired ${repaired}`);
