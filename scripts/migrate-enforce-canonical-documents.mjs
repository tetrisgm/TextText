#!/usr/bin/env node
// Finalize the unified-document migration. Every persisted item, including
// items in Trash, must carry one validated schema-v1 document snapshot.

import pkg from "@next/env";
import pg from "pg";

pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "DATABASE_URL is not configured; skipping canonical document enforcement.",
  );
  process.exit(0);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech")
    ? { rejectUnauthorized: true }
    : undefined,
});

async function query(text) {
  return client.query(text);
}

async function main() {
  await client.connect();
  const table = await query(
    "SELECT to_regclass('public.posts') AS posts_table",
  );
  if (!table.rows[0]?.posts_table) {
    console.log(
      "Posts table does not exist yet; canonical document enforcement will run after schema creation.",
    );
    await client.end();
    return;
  }
  await query("BEGIN");
  try {
    const invalid = await query(`
      SELECT id
      FROM posts
      WHERE document IS NULL
        OR NOT coalesce((
          jsonb_typeof(document) = 'object'
          AND document ->> 'schemaVersion' = '1'
          AND jsonb_typeof(document -> 'content') = 'object'
          AND jsonb_typeof(document -> 'content' -> 'title') = 'string'
          AND jsonb_typeof(document -> 'content' -> 'body') = 'string'
          AND jsonb_typeof(document -> 'content' -> 'fields') = 'object'
          AND jsonb_typeof(document -> 'content' -> 'tags') = 'array'
          AND jsonb_typeof(document -> 'content' -> 'assets') = 'array'
          AND jsonb_typeof(document -> 'presentation') = 'object'
          AND jsonb_typeof(document -> 'presentation' -> 'template') = 'object'
          AND jsonb_typeof(document -> 'presentation' -> 'theme') = 'object'
          AND document -> 'presentation' -> 'template' ->> 'id' = template_id
          AND CASE
            WHEN document -> 'presentation' -> 'template' ->> 'version'
              ~ '^[1-9][0-9]*$'
            THEN (
              document -> 'presentation' -> 'template' ->> 'version'
            )::integer = template_version
            ELSE false
          END
        ), false)
      ORDER BY id
      LIMIT 20
    `);
    if (invalid.rowCount > 0) {
      throw new Error(
        `Canonical document enforcement found invalid item ids: ${invalid.rows
          .map((row) => row.id)
          .join(", ")}`,
      );
    }

    await query(`
      ALTER TABLE posts
        ALTER COLUMN document SET NOT NULL
    `);
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'posts_document_schema_v1_valid'
            AND conrelid = 'posts'::regclass
        ) THEN
          ALTER TABLE posts
            ADD CONSTRAINT posts_document_schema_v1_valid
            CHECK (
              coalesce((
                jsonb_typeof(document) = 'object'
                AND document ->> 'schemaVersion' = '1'
                AND jsonb_typeof(document -> 'content') = 'object'
                AND jsonb_typeof(document -> 'content' -> 'title') = 'string'
                AND jsonb_typeof(document -> 'content' -> 'body') = 'string'
                AND jsonb_typeof(document -> 'content' -> 'fields') = 'object'
                AND jsonb_typeof(document -> 'content' -> 'tags') = 'array'
                AND jsonb_typeof(document -> 'content' -> 'assets') = 'array'
                AND jsonb_typeof(document -> 'presentation') = 'object'
                AND jsonb_typeof(
                  document -> 'presentation' -> 'template'
                ) = 'object'
                AND jsonb_typeof(
                  document -> 'presentation' -> 'theme'
                ) = 'object'
                AND document -> 'presentation' -> 'template' ->> 'id'
                  = template_id
                AND CASE
                  WHEN document -> 'presentation' -> 'template' ->> 'version'
                    ~ '^[1-9][0-9]*$'
                  THEN (
                    document -> 'presentation' -> 'template' ->> 'version'
                  )::integer = template_version
                  ELSE false
                END
              ), false)
            ) NOT VALID;
        END IF;
      END
      $$
    `);
    await query(`
      ALTER TABLE posts
        VALIDATE CONSTRAINT posts_document_schema_v1_valid
    `);

    const summary = await query(`
      SELECT
        count(*)::int AS documents,
        count(*) FILTER (WHERE deleted_at IS NULL)::int AS live_documents,
        count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash_documents
      FROM posts
    `);
    await query("COMMIT");
    const row = summary.rows[0];
    console.log(
      `Canonical documents enforced. documents=${row.documents} ` +
        `live=${row.live_documents} trash=${row.trash_documents}`,
    );
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
