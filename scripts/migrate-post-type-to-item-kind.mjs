#!/usr/bin/env node
// Rename the two post_type values that had a second name everywhere else.
//
// `PostType` and `ItemKind` were the same five values with two of them spelled
// differently: `project` was `media_post` and `talk` was `video_post`, and two
// converter functions existed only to translate between the pair. One concept,
// two vocabularies, and a translation layer between them in both directions.
//
// This renames the stored values so the column speaks the one vocabulary the
// rest of the product uses. ALTER TYPE ... RENAME VALUE is atomic and touches
// no rows: the values keep their identity, only their spelling changes, so
// every existing row stays exactly where it was.
//
// Run BEFORE the deploy that removes PostType. A database renamed ahead of the
// code is read fine by the new code, and the old code is already gone by then.
// If it runs twice the second pass finds nothing to rename and says so.
//
// Idempotent. Runs inside scripts/run-release-migrations.sh, whose coverage
// guard refuses to ship if this file is not in its order.
//
//   node scripts/migrate-post-type-to-item-kind.mjs

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("DATABASE_URL is not configured; skipping post type rename.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech") ? { rejectUnauthorized: true } : undefined,
});
await client.connect();

/** The old spelling, and the one the rest of the product already used. */
const RENAMES = [
  ["project", "media_post"],
  ["talk", "video_post"],
];

const { rows: labels } = await client.query(
  `SELECT e.enumlabel AS label
     FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'post_type'`,
);
const present = new Set(labels.map((row) => row.label));

let renamed = 0;
for (const [from, to] of RENAMES) {
  if (!present.has(from)) {
    console.log(`post type: "${from}" already renamed`);
    continue;
  }
  if (present.has(to)) {
    // Both spellings present: a half-applied run, or someone added the new
    // value by hand. Moving rows across and dropping a value is not what
    // RENAME does, so stop rather than guess.
    throw new Error(
      `post_type has both "${from}" and "${to}". Resolve by hand before rerunning.`,
    );
  }
  const { rows: counted } = await client.query(
    `SELECT count(*)::int AS n FROM posts WHERE type = $1::post_type`,
    [from],
  );
  await client.query(
    `ALTER TYPE post_type RENAME VALUE '${from}' TO '${to}'`,
  );
  console.log(`post type: "${from}" -> "${to}" (${counted[0]?.n ?? 0} item(s))`);
  renamed += 1;
}

if (!renamed) console.log("post type: nothing to rename");

await client.end();
