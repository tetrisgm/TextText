// Idempotent migration for first-class post tags.
//
//   node scripts/migrate-add-tags.mjs

// Reads DATABASE_URL from the environment or .env.local (no dotenv dependency).

import { readFileSync } from "node:fs";
import { connectMigrationDatabase } from "./lib/postgres-migration.mjs";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error("DATABASE_URL not set and not found in .env.local");
}

async function main() {
  const sql = await connectMigrationDatabase(loadDatabaseUrl());

  console.log("Adding posts.tags...");
  await sql`
    ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS tags text[] NOT NULL
      DEFAULT ARRAY[]::text[]
  `;

  console.log("Creating tag lookup index...");
  await sql`
    CREATE INDEX IF NOT EXISTS posts_tags_gin_full_idx
      ON posts USING gin (tags)
  `;

  const [summary] = await sql`
    SELECT
      count(*)::int AS posts,
      count(*) FILTER (WHERE cardinality(tags) > 0)::int AS tagged_posts,
      coalesce(max(cardinality(tags)), 0)::int AS max_tags
    FROM posts
  `;
  console.log(
    `Done. posts=${summary.posts} tagged_posts=${summary.tagged_posts} max_tags=${summary.max_tags}`,
  );
  await sql.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
