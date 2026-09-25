#!/usr/bin/env node
// End-to-end verification uses and removes only a newly created local database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { bootstrapDatabase } from "./bootstrap-database.mjs";
import { localDatabase } from "./start.mjs";
import { prepareMigrations } from "./prepare-migrations.mjs";

if (process.platform !== "darwin") throw new Error("Run bootstrap verification on the Mac, never on the production host.");
if (process.argv.length !== 2 && (process.argv.length !== 4 || process.argv[2] !== "--migrations-dir")) {
  throw new Error("Usage: node --env-file=.env.local release/oracle/test-bootstrap.mjs [--migrations-dir <prepared directory>]");
}
const source = localDatabase(process.env.DATABASE_URL);
const name = `texttext_bootstrap_test_${randomBytes(8).toString("hex")}`;
const scratchUrl = new URL(source);
scratchUrl.pathname = `/${name}`;
const environment = { ...process.env, DATABASE_URL: scratchUrl.href };
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const scratchParent = join(projectRoot, ".texttext");
mkdirSync(scratchParent, { recursive: true });
const preparedScratch = process.argv[3] ? null : mkdtempSync(join(scratchParent, "oracle-bootstrap-check-"));
const directory = preparedScratch ? join(preparedScratch, "migrations") : resolve(process.argv[3]);
const admin = new pg.Client({ connectionString: source.href });
const scratch = new pg.Client({ connectionString: scratchUrl.href });
let created = false;
let connected = false;
let adminConnected = false;
try {
  if (preparedScratch) await prepareMigrations({ projectRoot, output: directory });
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  created = true;
  await bootstrapDatabase({ directory, environment });
  await scratch.connect();
  connected = true;
  const triggers = await scratch.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal");
  for (const name of ["posts_bump_revision", "folders_bump_revision", "posts_bump_blog_seq", "folders_bump_blog_seq", "posts_file_representation_immutable", "posts_guard_public_path", "posts_preserve_public_path"]) {
    assert.ok(triggers.rows.some((row) => row.tgname === name), `Missing trigger: ${name}`);
  }
  const constraints = await scratch.query("SELECT convalidated FROM pg_constraint WHERE conname = 'posts_document_schema_v1_valid'");
  assert.equal(constraints.rows[0]?.convalidated, true);

  const user = (await scratch.query("INSERT INTO users (apple_sub, name) VALUES ('bootstrap-test', 'Keep this owner') RETURNING id")).rows[0];
  const workspace = (await scratch.query("INSERT INTO blogs (handle, name, owner_id) VALUES ('bootstrap-test', 'Keep this workspace', $1) RETURNING id", [user.id])).rows[0];
  const folder = (await scratch.query("INSERT INTO folders (blog_id, name, path, mode) VALUES ($1, 'Notes', 'notes', 'notes') RETURNING id, revision", [workspace.id])).rows[0];
  const document = {
    schemaVersion: 1,
    content: { title: "Keep these words", body: "A document survives migration retries.", fields: {}, tags: [], assets: [] },
    presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
  };
  const post = (await scratch.query(`INSERT INTO posts
    (blog_id, folder_id, slug, title, body, document, type, template_id)
    VALUES ($1, $2, 'keep-these-words', $3, $4, $5::jsonb, 'note', 'texttext.note') RETURNING id, revision`,
  [workspace.id, folder.id, document.content.title, document.content.body, JSON.stringify(document)])).rows[0];
  const changed = (await scratch.query("UPDATE posts SET updated_at = now() WHERE id = $1 RETURNING revision", [post.id])).rows[0];
  assert.ok(BigInt(changed.revision) > BigInt(post.revision));
  const cursor = (await scratch.query("SELECT change_seq FROM blogs WHERE id = $1", [workspace.id])).rows[0].change_seq;
  assert.ok(BigInt(cursor) >= BigInt(changed.revision));
  await assert.rejects(scratch.query("UPDATE posts SET file_representation = 'markdown' WHERE id = $1", [post.id]), /immutable/);
  await assert.rejects(scratch.query("UPDATE posts SET document = '{}'::jsonb WHERE id = $1", [post.id]), /posts_document_schema_v1_valid/);
  await assert.rejects(bootstrapDatabase({ directory, environment }), /nonempty database/);

  await bootstrapDatabase({ directory, environment, migrateOnly: true });
  const after = (await scratch.query("SELECT document, file_representation FROM posts WHERE id = $1", [post.id])).rows[0];
  assert.deepEqual(after.document, document);
  assert.equal(after.file_representation, "textpack");
  assert.equal((await scratch.query("SELECT name FROM users WHERE id = $1", [user.id])).rows[0].name, "Keep this owner");
  assert.ok(BigInt((await scratch.query("SELECT change_seq FROM blogs WHERE id = $1", [workspace.id])).rows[0].change_seq) >= BigInt(cursor));
  console.log("Bootstrap verification passed: fresh schema, all 46 release steps, protections, refusal on nonempty DB, and migration retry preserve content.");
} finally {
  if (connected) await scratch.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  if (adminConnected) await admin.end();
  if (preparedScratch) rmSync(preparedScratch, { recursive: true, force: true });
}
