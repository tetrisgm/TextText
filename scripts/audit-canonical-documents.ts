#!/usr/bin/env tsx
import * as nextEnv from "@next/env";
import pg from "pg";
import { validateDocumentSnapshot } from "../src/lib/documents/model";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "DATABASE_URL is not configured; canonical document audit has nothing to inspect.",
  );
  process.exit(0);
}

type PostAuditRow = {
  id: string;
  deleted_at: Date | null;
  file_representation: string;
  document: unknown;
  template_id: string;
  template_version: number;
  title: string;
  body: string;
  tags: string[];
};

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes(".neon.tech")
    ? { rejectUnauthorized: true }
    : undefined,
});

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main() {
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query<PostAuditRow>(`
      SELECT
        id,
        deleted_at,
        file_representation,
        document,
        template_id,
        template_version,
        title,
        body,
        tags
      FROM posts
      ORDER BY id
    `);
    const schema = await client.query<{
      document_not_null: boolean;
      document_constraint_validated: boolean;
    }>(`
      SELECT
        coalesce((
          SELECT attnotnull
          FROM pg_attribute
          WHERE attrelid = 'posts'::regclass
            AND attname = 'document'
            AND NOT attisdropped
        ), false) AS document_not_null,
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'posts'::regclass
            AND conname = 'posts_document_schema_v1_valid'
            AND convalidated
        ) AS document_constraint_validated
    `);

    const failures: string[] = [];
    if (!schema.rows[0]?.document_not_null) {
      failures.push("posts.document is nullable");
    }
    if (!schema.rows[0]?.document_constraint_validated) {
      failures.push("canonical document database constraint is not validated");
    }
    const representations = new Map<string, number>();
    let live = 0;
    let trash = 0;

    for (const row of result.rows) {
      row.deleted_at ? trash++ : live++;
      representations.set(
        row.file_representation,
        (representations.get(row.file_representation) ?? 0) + 1,
      );
      try {
        const document = validateDocumentSnapshot(row.document);
        const template = document.presentation.template;
        if (
          template.id !== row.template_id ||
          template.version !== row.template_version
        ) {
          failures.push(`${row.id}: template projection differs`);
        }
        if (
          document.content.title !== row.title ||
          document.content.body !== row.body ||
          !equalJson(document.content.tags, row.tags)
        ) {
          failures.push(`${row.id}: search projection differs`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${row.id}: ${message.split("\n")[0]}`);
      }
    }
    await client.query("ROLLBACK");

    if (failures.length > 0) {
      throw new Error(
        `Canonical document audit failed:\n${failures
          .slice(0, 20)
          .map((failure) => `- ${failure}`)
          .join("\n")}`,
      );
    }

    const representationSummary = [...representations.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => `${name}=${count}`)
      .join(" ");
    console.log(
      `Canonical document audit passed. documents=${result.rowCount ?? 0} ` +
        `live=${live} trash=${trash}` +
        (representationSummary ? ` ${representationSummary}` : ""),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
