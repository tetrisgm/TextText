#!/usr/bin/env node
// Run only prepared SQL and JavaScript. No production compilation or dev tools.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { localDatabase, protectedEnvironment } from "./start.mjs";
import { isEntrypoint } from "./entrypoint.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function preparedRelease(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || manifest.nodeMajor !== 22 || !Array.isArray(manifest.migrations) ||
      !manifest.migrations.length || !manifest.files?.["schema.sql"]) {
    throw new Error("Invalid prepared database release.");
  }
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (isAbsolute(path) || path.split(/[\\/]/).some((part) => !part || part === "..")) {
      throw new Error("Invalid database release file path.");
    }
    const actual = createHash("sha256").update(readFileSync(join(directory, path))).digest("hex");
    if (actual !== expected) throw new Error(`Database release checksum mismatch: ${path}`);
  }
  if (manifest.migrations.some((path) => typeof path !== "string" || !/\.[cm]js$/.test(path) || !manifest.files[path])) {
    throw new Error("A database migration is missing its checksum.");
  }
  return manifest;
}

export async function bootstrapDatabase({ directory = join(here, "migrations"), environment = process.env, migrateOnly = false }) {
  const target = resolve(directory);
  localDatabase(environment.DATABASE_URL);
  const manifest = preparedRelease(target);
  const client = new pg.Client({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('texttext:database-release')) AS acquired");
    if (!lock.rows[0]?.acquired) throw new Error("Another database release is already running.");
    if (migrateOnly) {
      const tables = await client.query("SELECT to_regclass('public.posts') AS posts, to_regclass('public.blogs') AS blogs");
      if (!tables.rows[0]?.posts || !tables.rows[0]?.blogs) throw new Error("Migrations require an initialized TextText database.");
    } else {
      const existing = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        ) OR EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        ) OR EXISTS (
          SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        ) OR EXISTS (
          SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
          AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%'
        ) AS occupied
      `);
      if (existing.rows[0]?.occupied) throw new Error("Refusing to bootstrap a nonempty database. Use --migrate-only for an existing TextText database.");
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query(readFileSync(join(target, "schema.sql"), "utf8"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log("Fresh PostgreSQL schema installed.");
    }
    for (const path of manifest.migrations) {
      console.log(`Applying ${path.split("/").at(-1)}`);
      const result = spawnSync(process.execPath, [join(target, path)], {
        cwd: target,
        env: { ...environment, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "inherit", timeout: 5 * 60_000,
      });
      if (result.error || result.status !== 0) throw new Error(`Database migration failed: ${path}. Retry with --migrate-only after resolving the failure.`);
    }
    console.log(`Database ready. ${manifest.migrations.length} migrations applied from ${manifest.commit}.`);
  } finally {
    await client.end();
  }
}

if (isEntrypoint(import.meta.url)) {
  try {
    let directory = join(here, "migrations");
    let environment = process.env;
    let migrateOnly = false;
    for (let index = 2; index < process.argv.length; index += 1) {
      const key = process.argv[index];
      if (key === "--migrate-only") { migrateOnly = true; continue; }
      const value = process.argv[++index];
      if (!value || !["--migrations-dir", "--env-file"].includes(key)) throw new Error("Usage: bootstrap-database.mjs [--migrations-dir <directory>] [--env-file <private file>] [--migrate-only]");
      if (key === "--migrations-dir") directory = value;
      if (key === "--env-file") environment = { ...process.env, ...protectedEnvironment(value) };
    }
    await bootstrapDatabase({ directory, environment, migrateOnly });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database bootstrap failed.");
    process.exitCode = 1;
  }
}
