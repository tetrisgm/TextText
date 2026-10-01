#!/usr/bin/env node
// Manual recovery drill. This never alters the live database or backup files.
import assert from "node:assert/strict";
import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, readdirSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isEntrypoint } from "./entrypoint.mjs";

const backupPattern = /^texttext-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/;
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

function assertArchiveIdentity(archive, stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      stat.dev !== archive.dev || stat.ino !== archive.ino || stat.size !== archive.size ||
      stat.uid !== archive.uid || stat.gid !== archive.gid) {
    throw new Error("The selected local backup changed or is not a private regular file.");
  }
}

export function newestLocalBackup(directory, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 50 * 1024 ** 3) {
    throw new Error("Invalid local restore byte budget.");
  }
  const root = resolve(directory);
  const directoryStat = lstatSync(root);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) {
    throw new Error("Backup directory must be a private regular directory (mode 0700).");
  }
  const names = readdirSync(root).filter(name => backupPattern.test(name)).sort((left, right) => right.localeCompare(left));
  if (!names.length) throw new Error("No local TextText backup archive is available.");
  const archives = names.map(name => {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        stat.uid !== directoryStat.uid || stat.gid !== directoryStat.gid) {
      throw new Error("Local backup archives must be private regular files owned with the backup directory.");
    }
    if (stat.size === 0 || stat.size > maxBytes) throw new Error("Local backup archive exceeds its restore byte budget.");
    return { name, path, size: stat.size, dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid };
  });
  return archives[0];
}

async function archiveDigest(archive, maxBytes) {
  const descriptor = openSync(archive.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stat = fstatSync(descriptor);
  assertArchiveIdentity(archive, stat);
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(archive.path, { fd: descriptor, autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error("Local backup archive exceeded its restore byte budget.");
      hash.update(chunk);
    }
  } finally {
    closeSync(descriptor);
  }
  if (bytes !== archive.size) throw new Error("Local backup archive size changed during validation.");
  assertArchiveIdentity(archive, lstatSync(archive.path));
  return { bytes, digest: hash.digest("hex") };
}

function runPgRestore(pgRestore, archive, args, environment, capture = false) {
  const descriptor = openSync(archive.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assertArchiveIdentity(archive, fstatSync(descriptor));
    return spawnSync(pgRestore, [...args, "/proc/self/fd/3"], {
      env: environment,
      encoding: capture ? "utf8" : undefined,
      stdio: capture ? ["ignore", "pipe", "ignore", descriptor] : ["ignore", "ignore", "ignore", descriptor],
      timeout: capture ? 30_000 : 120_000,
      maxBuffer: capture ? 8 * 1024 ** 2 : undefined,
    });
  } finally {
    closeSync(descriptor);
  }
}

export async function restoreDrill({ scratch = false, compareLive = false,
  release = "/home/ubuntu/texttext/current", adminEnv = "/etc/texttext/database-admin.env",
  backupEnv = "/etc/texttext/backup.env" } = {}) {
  if (!scratch) throw new Error("Require --scratch for a disposable restore database.");
  const { localDatabase, protectedEnvironment } = await import(pathToFileURL(join(release, "release/oracle/start.mjs")).href);
  const { backupConnection } = await import(pathToFileURL(join(release, "release/oracle/backup.mjs")).href);
  const require = createRequire(join(release, "package.json"));
  const { Client } = require("pg");
  const adminSettings = protectedEnvironment(adminEnv);
  const backupSettings = protectedEnvironment(backupEnv);
  const adminUrl = localDatabase(adminSettings.DATABASE_URL);
  const liveUrl = localDatabase(backupSettings.DATABASE_URL);
  if (adminUrl.hostname !== liveUrl.hostname || adminUrl.port !== liveUrl.port) throw new Error("Admin and backup connections must use the same loopback PostgreSQL instance.");
  const maxBytes = Number(backupSettings.TEXTTEXT_BACKUP_MAX_BYTES || 5 * 1024 ** 3);
  const backupDirectory = resolve(backupSettings.TEXTTEXT_BACKUP_DIR || "/home/ubuntu/texttext/backups");
  const name = `texttext_restore_drill_${randomBytes(10).toString("hex")}`;
  const scratchUrl = new URL(adminUrl);
  scratchUrl.pathname = `/${name}`;
  const scratchEnvironment = backupConnection({ ...process.env, DATABASE_URL: scratchUrl.href,
    LD_LIBRARY_PATH: backupSettings.LD_LIBRARY_PATH || "/home/ubuntu/texttext/postgres/usr/lib/aarch64-linux-gnu" });
  const pgRestore = backupSettings.PG_RESTORE || "/home/ubuntu/texttext/postgres/usr/lib/postgresql/16/bin/pg_restore";
  const admin = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  const live = new Client({ connectionString: liveUrl.href, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  const restored = new Client({ connectionString: scratchUrl.href, connectionTimeoutMillis: 10_000, statement_timeout: 60_000 });
  let adminConnected = false, liveConnected = false, restoredConnected = false;
  let created = false, databaseOid, failure, receipt;
  let stage = "local backup selection";
  try {
    const latest = newestLocalBackup(backupDirectory, maxBytes);
    stage = "local backup digest validation";
    const { bytes, digest } = await archiveDigest(latest, maxBytes);
    stage = "PostgreSQL archive validation";
    const archive = runPgRestore(pgRestore, latest, ["--list"], scratchEnvironment, true);
    if (archive.error || archive.status !== 0) throw new Error("Local PostgreSQL archive is invalid.");
    assertArchiveIdentity(latest, lstatSync(latest.path));
    const archiveTables = [...archive.stdout.matchAll(/^\d+; \d+ \d+ TABLE DATA public ([a-z_][a-z_0-9]*) \S+$/gm)].map(match => match[1]).sort();
    for (const table of requiredTables) assert.ok(archiveTables.includes(table), "Archive is missing a required application table.");
    if (compareLive) { await live.connect(); liveConnected = true; }
    const before = compareLive ? await tableCounts(live) : null;

    stage = "new scratch database creation";
    await admin.connect(); adminConnected = true;
    await admin.query(`CREATE DATABASE ${quoted(name)} TEMPLATE template0`);
    created = true;
    databaseOid = (await admin.query("SELECT oid FROM pg_database WHERE datname = $1", [name])).rows[0]?.oid;
    assert.ok(databaseOid, "Created database has no identity.");
    stage = "transactional PostgreSQL restore";
    const result = runPgRestore(pgRestore, latest,
      ["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname", name], scratchEnvironment);
    if (result.error || result.status !== 0) throw new Error("PostgreSQL restore failed.");
    assertArchiveIdentity(latest, lstatSync(latest.path));
    await restored.connect(); restoredConnected = true;
    stage = "restored schema and canonical document validation";
    const counts = await tableCounts(restored);
    assert.deepEqual(Object.keys(counts).sort(), archiveTables, "Restored tables differ from archive inventory.");
    const triggers = (await restored.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'")).rows.map(row => row.tgname);
    for (const trigger of requiredTriggers) assert.ok(triggers.includes(trigger), "Restored database is missing an enabled protection trigger.");
    const canonical = await restored.query("SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.posts'::regclass AND conname = 'posts_document_schema_v1_valid'");
    assert.equal(canonical.rows[0]?.convalidated, true, "Canonical document constraint is not validated.");
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
    receipt = { ok: true, backup: latest.name, archiveBytes: bytes, archiveSha256: digest,
      tables: Object.keys(counts).length, rows: counts, canonicalDocuments: Number(counts.posts),
      comparedLive: compareLive, scratchDatabaseRemoved: false };
  } catch {
    // PostgreSQL stderr and database credentials never enter drill output.
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
  }
  if (failure) throw failure;
  return receipt;
}

if (isEntrypoint(import.meta.url)) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    const paths = { "--release": "release", "--admin-env": "adminEnv", "--backup-env": "backupEnv" };
    while (args.length) {
      const argument = args.shift();
      if (argument === "--scratch") options.scratch = true;
      else if (argument === "--compare-live") options.compareLive = true;
      else if (paths[argument] && args[0] && !args[0].startsWith("--")) options[paths[argument]] = args.shift();
      else throw new Error("Usage: restore-drill.mjs --scratch [--compare-live] [--release <release directory>] [--admin-env <private environment>] [--backup-env <private environment>]");
    }
    console.log(JSON.stringify(await restoreDrill(options), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Restore drill failed.");
    process.exitCode = 1;
  }
}
