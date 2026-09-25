#!/usr/bin/env node
// Manual recovery drill. This never alters the live database or remote backups.
import assert from "node:assert/strict";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isEntrypoint } from "./entrypoint.mjs";

const backupPattern = /^backups\/oracle\/texttext\/texttext-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump\.aes256gcm$/;
const quoted = value => `"${value.replaceAll('"', '""')}"`;
const requiredTables = ["users", "blogs", "folders", "posts", "api_tokens", "action_audit", "collab_state", "collab_updates", "idempotency_keys"];
const requiredTriggers = ["posts_bump_revision", "folders_bump_revision", "posts_bump_blog_seq", "folders_bump_blog_seq", "posts_file_representation_immutable", "posts_guard_public_path", "posts_preserve_public_path"];

async function tableCounts(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const counts = {};
    for (const { tablename } of tables.rows) {
      counts[tablename] = (await client.query(`SELECT count(*) AS count FROM public.${quoted(tablename)}`)).rows[0].count;
    }
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function restoreDrill({ scratch = false, compareLive = false,
  release = "/home/ubuntu/texttext/current", adminEnv = "/etc/texttext/database-admin.env",
  backupEnv = "/etc/texttext/backup.env", recoveryKeyFile, suppliedBlob } = {}) {
  if (!scratch || !recoveryKeyFile) throw new Error("Require --scratch and --recovery-key-file <independent private recovery environment file>.");
  const { localDatabase, protectedEnvironment } = await import(pathToFileURL(join(release, "release/oracle/start.mjs")).href);
  const { decryptBackup } = await import(pathToFileURL(join(release, "release/oracle/backup-remote.mjs")).href);
  const { backupConnection } = await import(pathToFileURL(join(release, "release/oracle/backup.mjs")).href);
  const require = createRequire(join(release, "package.json"));
  const { Client } = require("pg");
  const blob = suppliedBlob ?? require("@vercel/blob");
  const adminSettings = protectedEnvironment(adminEnv);
  const backupSettings = protectedEnvironment(backupEnv);
  // Never fall back to the encryption key resident on the server. The caller
  // must independently recover this file from the separate credential store.
  const recovered = protectedEnvironment(recoveryKeyFile);
  if (resolve(recoveryKeyFile) === resolve(backupEnv) || !recovered.BACKUP_ENCRYPTION_KEY) {
    throw new Error("Supply a separate independently recovered encryption key file.");
  }
  const adminUrl = localDatabase(adminSettings.DATABASE_URL);
  const liveUrl = localDatabase(backupSettings.DATABASE_URL);
  if (adminUrl.hostname !== liveUrl.hostname || adminUrl.port !== liveUrl.port) throw new Error("Admin and backup connections must use the same loopback PostgreSQL instance.");
  if (!backupSettings.BLOB_READ_WRITE_TOKEN) throw new Error("Backup store credentials are missing.");
  const maxBytes = Number(backupSettings.TEXTTEXT_BACKUP_UPLOAD_MAX_BYTES || 100 * 1024 ** 2);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 ** 3) throw new Error("Invalid recovery download budget.");
  const access = backupSettings.TEXTTEXT_BACKUP_BLOB_ACCESS || "public";
  if (!["public", "private"].includes(access)) throw new Error("Invalid backup store access mode.");
  const name = `texttext_restore_drill_${randomBytes(10).toString("hex")}`;
  const scratchUrl = new URL(adminUrl);
  scratchUrl.pathname = `/${name}`;
  const scratchEnvironment = backupConnection({ ...process.env, DATABASE_URL: scratchUrl.href,
    LD_LIBRARY_PATH: backupSettings.LD_LIBRARY_PATH || "/home/ubuntu/texttext/postgres/usr/lib/aarch64-linux-gnu" });
  const pgRestore = backupSettings.PG_RESTORE || "/home/ubuntu/texttext/postgres/usr/lib/postgresql/16/bin/pg_restore";
  const admin = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  const live = new Client({ connectionString: liveUrl.href, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  const restored = new Client({ connectionString: scratchUrl.href, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  const directory = mkdtempSync(join(tmpdir(), "texttext-restore-drill-"));
  let adminConnected = false, liveConnected = false, restoredConnected = false;
  let created = false, databaseOid, failure, receipt;
  let stage = "read-only backup inventory";
  try {
    const options = { token: backupSettings.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(60_000) };
    const inventory = await blob.list({ ...options, prefix: "backups/oracle/texttext/", limit: 100 });
    if (inventory.hasMore || !inventory.blobs.length) throw new Error("Backup inventory is empty or exceeds its bounded limit.");
    if (inventory.blobs.some(entry => !backupPattern.test(entry.pathname))) throw new Error("Unexpected file in the backup prefix.");
    const uploadedTime = entry => Number(new Date(entry.uploadedAt ?? 0));
    const latest = [...inventory.blobs].sort((a, b) => uploadedTime(b) - uploadedTime(a) || b.pathname.localeCompare(a.pathname))[0];
    if (!Number.isSafeInteger(latest.size) || latest.size <= 37 || latest.size > maxBytes) throw new Error("Backup exceeds the recovery download budget.");
    if (compareLive) { await live.connect(); liveConnected = true; }
    const before = compareLive ? await tableCounts(live) : null;
    stage = "bounded off-server download";
    const downloaded = await blob.get(latest.url, { ...options, access });
    if (!downloaded || downloaded.statusCode !== 200) throw new Error("Backup could not be downloaded.");
    const ciphertext = join(directory, "backup.aes256gcm");
    let bytes = 0;
    const hash = createHash("sha256");
    const limit = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(bytes > maxBytes ? new Error("Download budget exceeded.") : null, chunk);
    } });
    await pipeline(downloaded.stream, limit, createWriteStream(ciphertext, { flags: "wx", mode: 0o600 }));
    assert.equal(bytes, latest.size, "Downloaded size differs from backup inventory.");
    const digest = hash.digest("hex");
    stage = "independent-key authenticated decryption";
    const dump = join(directory, "recovered.dump");
    await decryptBackup(ciphertext, dump, recovered.BACKUP_ENCRYPTION_KEY);
    const archive = spawnSync(pgRestore, ["--list", dump], { env: scratchEnvironment, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 ** 2 });
    if (archive.error || archive.status !== 0) throw new Error("Decrypted PostgreSQL archive is invalid.");
    const archiveTables = [...archive.stdout.matchAll(/^\d+; \d+ \d+ TABLE DATA public ([a-z_][a-z_0-9]*) \S+$/gm)].map(match => match[1]).sort();
    for (const table of requiredTables) assert.ok(archiveTables.includes(table), "Archive is missing a required application table.");

    stage = "new scratch database creation";
    await admin.connect(); adminConnected = true;
    await admin.query(`CREATE DATABASE ${quoted(name)} TEMPLATE template0`);
    created = true;
    databaseOid = (await admin.query("SELECT oid FROM pg_database WHERE datname = $1", [name])).rows[0]?.oid;
    assert.ok(databaseOid, "Created database has no identity.");
    stage = "transactional PostgreSQL restore";
    const result = spawnSync(pgRestore, ["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", name, dump],
      { env: scratchEnvironment, stdio: "ignore", timeout: 120_000 });
    if (result.error || result.status !== 0) throw new Error("PostgreSQL restore failed.");
    await restored.connect(); restoredConnected = true;
    stage = "restored schema and canonical document validation";
    const counts = await tableCounts(restored);
    assert.deepEqual(Object.keys(counts).sort(), archiveTables, "Restored tables differ from archive inventory.");
    const triggers = (await restored.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'")).rows.map(row => row.tgname);
    for (const trigger of requiredTriggers) assert.ok(triggers.includes(trigger), "Restored database is missing an enabled protection trigger.");
    const canonical = await restored.query("SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.posts'::regclass AND conname = 'posts_document_schema_v1_valid'");
    assert.equal(canonical.rows[0]?.convalidated, true, "Canonical document constraint is not validated.");
    // prepare-migrations compiles this source into the portable release bundle.
    const auditSource = "scripts/audit-canonical-documents.ts";
    const audit = spawnSync(process.execPath, [join(release, "release/oracle/migrations", auditSource.replace(/\.ts$/, ".cjs"))],
      { cwd: release, env: { ...process.env, DATABASE_URL: scratchUrl.href }, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 ** 2 });
    if (audit.error || audit.status !== 0 || !audit.stdout.includes("Canonical document audit passed.")) throw new Error("Restored canonical document audit did not pass.");
    if (compareLive) {
      stage = "stable live database row-count comparison";
      const after = await tableCounts(live);
      assert.deepEqual(after, before, "Live row counts changed during the drill; repeat at a quiet point.");
      assert.deepEqual(counts, before, "Backup row counts differ from the stable live database; take a fresh backup and repeat.");
    }
    receipt = { ok: true, backup: latest.pathname, ciphertextBytes: bytes, ciphertextSha256: digest,
      tables: Object.keys(counts).length, rows: counts, canonicalDocuments: Number(counts.posts),
      independentKey: true, comparedLive: compareLive, scratchDatabaseRemoved: false };
  } catch {
    // Neither PostgreSQL stderr nor Blob response bodies/URLs or secrets enter logs.
    failure = new Error(`Restore drill failed during ${stage}.`);
  } finally {
    if (restoredConnected) await restored.end().catch(() => {});
    if (liveConnected) await live.end().catch(() => {});
    if (created) {
      try {
        const identity = (await admin.query("SELECT oid FROM pg_database WHERE datname = $1", [name])).rows[0]?.oid;
        if (!databaseOid || identity !== databaseOid) throw new Error("Scratch database identity changed.");
        await admin.query(`DROP DATABASE ${quoted(name)} WITH (FORCE)`);
        assert.equal((await admin.query("SELECT count(*) AS count FROM pg_database WHERE datname = $1", [name])).rows[0].count, "0");
        if (receipt) receipt.scratchDatabaseRemoved = true;
      } catch { failure = new Error(`Restore drill cleanup failed for ${name}; resolve only this scratch database.`); }
    }
    if (adminConnected) await admin.end().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
  if (failure) throw failure;
  return receipt;
}

if (isEntrypoint(import.meta.url)) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    const paths = { "--release": "release", "--admin-env": "adminEnv", "--backup-env": "backupEnv", "--recovery-key-file": "recoveryKeyFile" };
    while (args.length) {
      const argument = args.shift();
      if (argument === "--scratch") options.scratch = true;
      else if (argument === "--compare-live") options.compareLive = true;
      else if (paths[argument] && args[0] && !args[0].startsWith("--")) options[paths[argument]] = args.shift();
      else throw new Error("Usage: restore-drill.mjs --scratch --recovery-key-file <private recovered key environment> [--compare-live] [--release <release directory>] [--admin-env <private environment>] [--backup-env <private environment>]");
    }
    console.log(JSON.stringify(await restoreDrill(options), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Restore drill failed.");
    process.exitCode = 1;
  }
}
