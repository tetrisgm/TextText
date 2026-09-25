import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { copyWithoutSecrets, relativeBuildDirectory } from "./package.mjs";
import { localDatabase, protectedEnvironment, runtimeEnvironment } from "./start.mjs";
import { backupConnection, createBackup, retainedArchives } from "./backup.mjs";
import { decryptBackup, encryptBackup, remoteRetention, uploadEncryptedBackup } from "./backup-remote.mjs";
import { verifyPackage } from "./verify-package.mjs";

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "texttext-oracle-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("runtime enforces loopback without exposing database credentials", () => {
  const database = "postgres://test:secret-password@127.0.0.1:5433/texttext";
  assert.equal(localDatabase(database).port, "5433");
  const env = runtimeEnvironment({ DATABASE_URL: database, HOSTNAME: "0.0.0.0" });
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.PORT, "3400");
  assert.equal(env.NODE_ENV, "production");
  for (const url of ["postgres://test:secret-password@production.example/texttext", "file:///tmp/texttext"]) {
    assert.throws(() => localDatabase(url), (error) => !error.message.includes("secret-password"));
  }
  assert.throws(() => runtimeEnvironment({ DATABASE_URL: database, AUTH_DEV_LOGIN: "1" }), /Development sign-in/);
  assert.throws(() => runtimeEnvironment({ DATABASE_URL: database, PORT: "443" }), /unprivileged/);
  assert.throws(() => localDatabase(`${database}?host=production.example`), /cannot override/);
  assert.equal(backupConnection({ DATABASE_URL: database }).PGPASSWORD, "secret-password");
});

test("environment files reject public permissions and symlinks", (t) => {
  const directory = temporary(t);
  const file = join(directory, "runtime.env");
  writeFileSync(file, "EXAMPLE=value\n", { mode: 0o600 });
  assert.equal(protectedEnvironment(file).EXAMPLE, "value");
  chmodSync(file, 0o644);
  assert.throws(() => protectedEnvironment(file), /private regular file/);
  chmodSync(file, 0o600);
  const link = join(directory, "link.env");
  symlinkSync(file, link);
  assert.throws(() => protectedEnvironment(link), /private regular file/);
});

test("packaging excludes environment files and refuses symlink escape", (t) => {
  const directory = temporary(t);
  const source = join(directory, "source");
  mkdirSync(source);
  writeFileSync(join(source, "server.js"), "server");
  writeFileSync(join(source, ".env.local"), "do not ship");
  writeFileSync(join(source, ".npmrc"), "do not ship");
  copyWithoutSecrets(source, join(directory, "copy"));
  assert.deepEqual(readdirSync(join(directory, "copy")), ["server.js"]);
  writeFileSync(join(directory, "outside"), "private");
  symlinkSync(join(directory, "outside"), join(source, "escape"));
  assert.throws(() => copyWithoutSecrets(source, join(directory, "copy2")), /symlink outside/);
  assert.throws(() => relativeBuildDirectory(directory, "../other"), /inside the project/);
});

test("release verification rejects corruption, wrong platforms, and packaged secrets", async (t) => {
  const directory = temporary(t);
  const contents = join(directory, "contents");
  mkdirSync(contents);
  const archive = join(directory, "release.tar.gz");
  const lockfile = "{\"lockfileVersion\":3}\n";
  writeFileSync(join(contents, "package-lock.json"), lockfile);
  const manifest = {
    platform: "linux", architecture: "arm64", nodeMajor: 22,
    commit: "a".repeat(40), deploymentId: "oracle-test",
    lockfileSha256: createHash("sha256").update(lockfile).digest("hex"),
  };
  function pack(metadata) {
    writeFileSync(join(contents, "oracle-release.json"), JSON.stringify(metadata));
    const packed = spawnSync("tar", ["-czf", archive, "-C", contents, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    assert.equal(packed.status, 0);
    writeFileSync(`${archive}.sha256`, `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  release.tar.gz\n`);
  }
  pack(manifest);
  assert.equal((await verifyPackage(archive)).deploymentId, "oracle-test");
  writeFileSync(archive, "corrupt");
  await assert.rejects(() => verifyPackage(archive), /checksum mismatch/);
  pack({ ...manifest, architecture: "x64" });
  await assert.rejects(() => verifyPackage(archive), /Linux ARM64/);
  writeFileSync(join(contents, ".env.local"), "PRIVATE=fixture");
  pack(manifest);
  await assert.rejects(() => verifyPackage(archive), /unsafe path or environment file/);
});

test("backup encryption authenticates corruption and never overwrites recovery output", async (t) => {
  const directory = temporary(t);
  const source = join(directory, "original.dump");
  const encrypted = join(directory, "backup.enc");
  const recovered = join(directory, "recovered.dump");
  const plaintext = randomBytes(4096);
  writeFileSync(source, plaintext);
  const key = randomBytes(32).toString("base64");
  await encryptBackup(source, encrypted, key);
  assert.equal(lstatSync(encrypted).mode & 0o077, 0);
  await decryptBackup(encrypted, recovered, key);
  assert.deepEqual(readFileSync(recovered), plaintext);
  await assert.rejects(() => decryptBackup(encrypted, recovered, key), /replace an existing/);
  const raced = join(directory, "raced.dump");
  const races = await Promise.allSettled([decryptBackup(encrypted, raced, key), decryptBackup(encrypted, raced, key)]);
  assert.equal(races.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.deepEqual(readFileSync(raced), plaintext);
  const bytes = readFileSync(encrypted);
  bytes[100] ^= 1;
  writeFileSync(encrypted, bytes);
  const failed = join(directory, "failed.dump");
  await assert.rejects(() => decryptBackup(encrypted, failed, key), /authentication failed/);
  assert.equal(existsSync(failed), false);
  await assert.rejects(() => encryptBackup(source, join(directory, "invalid"), "weak-key"), /32-byte/);
});

test("local retention ignores unrelated files and backup failure preserves the previous dump", async (t) => {
  const directory = temporary(t);
  const backups = join(directory, "backups");
  mkdirSync(backups, { mode: 0o700 });
  const prior = join(backups, "texttext-20260901T120000Z-12345678.dump");
  writeFileSync(prior, "previous good backup");
  writeFileSync(join(backups, "unrelated.txt"), "leave me alone");
  const binary = join(directory, "pg_dump");
  writeFileSync(binary, "#!/bin/sh\nprintf 'incomplete'\nexit 1\n", { mode: 0o700 });
  await assert.rejects(() => createBackup({
    DATABASE_URL: "postgres://test:test@127.0.0.1:5433/texttext",
    PG_DUMP: binary, TEXTTEXT_BACKUP_DIR: backups,
  }), /pg_dump failed/);
  assert.equal(readFileSync(prior, "utf8"), "previous good backup");
  assert.deepEqual(readdirSync(backups).sort(), ["texttext-20260901T120000Z-12345678.dump", "unrelated.txt"]);
  const newer = join(backups, "texttext-20260902T120000Z-12345678.dump");
  writeFileSync(newer, "new");
  utimesSync(prior, new Date(0), new Date(0));
  const retention = retainedArchives(backups, { keep: 1, maxBytes: 1024 });
  assert.equal(retention.find((entry) => entry.path === prior).remove, true);
  assert.equal(retention.find((entry) => entry.path === newer).remove, false);
  utimesSync(prior, new Date("2099-01-01"), new Date("2099-01-01"));
  const skewed = retainedArchives(backups, { keep: 1, maxBytes: 1024, requiredPath: newer });
  assert.equal(skewed.find((entry) => entry.path === newer).remove, false);
  assert.equal(skewed.find((entry) => entry.path === prior).remove, true);
});

test("local archive size is bounded even when pg_dump streams excess data", async (t) => {
  const directory = temporary(t);
  const backups = join(directory, "backups");
  const binary = join(directory, "pg_dump");
  writeFileSync(binary, "#!/bin/sh\nhead -c 4096 /dev/zero\n", { mode: 0o700 });
  await assert.rejects(() => createBackup({
    DATABASE_URL: "postgres://test:test@127.0.0.1:5433/texttext",
    PATH: process.env.PATH, PG_DUMP: binary, TEXTTEXT_BACKUP_DIR: backups, TEXTTEXT_BACKUP_MAX_BYTES: "1024",
  }), /storage budget/);
  assert.deepEqual(readdirSync(backups), []);
});

test("remote retention keeps distinct days and refuses foreign objects", () => {
  const entries = [
    { pathname: "backups/oracle/texttext/texttext-20260901T120000Z-12345678.dump.aes256gcm", size: 10 },
    { pathname: "backups/oracle/texttext/texttext-20260902T120000Z-12345678.dump.aes256gcm", size: 10 },
    { pathname: "backups/oracle/texttext/texttext-20260902T130000Z-12345678.dump.aes256gcm", size: 10 },
  ];
  const results = remoteRetention(entries, { keep: 7, maxBytes: 100 });
  assert.equal(results.filter((item) => !item.remove).length, 2);
  assert.equal(results.find((item) => item.pathname === entries[1].pathname).remove, true);
  assert.throws(() => remoteRetention([{ pathname: "user-media/photo.jpg", size: 10 }], { keep: 7, maxBytes: 100 }), /Unexpected object/);
});

test("remote backup verifies the encrypted download before deleting old files", async (t) => {
  const directory = temporary(t);
  const source = join(directory, "texttext-20990101T120000Z-12345678.dump");
  writeFileSync(source, "database contents");
  const old = { pathname: "backups/oracle/texttext/texttext-20260901T120000Z-12345678.dump.aes256gcm", size: 10, url: "https://example.invalid/old" };
  const events = [];
  let ciphertext;
  const client = {
    async list() { return { blobs: [old], hasMore: false }; },
    async put(path, stream) {
      events.push("put");
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      ciphertext = Buffer.concat(chunks);
      assert.equal(ciphertext.includes(Buffer.from("database contents")), false);
      return { url: "https://example.invalid/new", pathname: path };
    },
    async get() { events.push("get"); return { statusCode: 200, stream: Readable.toWeb(Readable.from([ciphertext])) }; },
    async del(urls) { events.push("del"); assert.deepEqual(urls, [old.url]); },
  };
  await uploadEncryptedBackup(source, { BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), BLOB_READ_WRITE_TOKEN: "fixture-token", TEXTTEXT_BACKUP_KEEP: "1" }, client);
  assert.deepEqual(events, ["put", "get", "del"]);
  assert.equal(existsSync(`${source}.encrypted.partial`), false);
});

test("a corrupt remote download never deletes a previous verified backup", async (t) => {
  const directory = temporary(t);
  const source = join(directory, "texttext-20990101T120000Z-12345678.dump");
  writeFileSync(source, "database contents");
  const deleted = [];
  const client = {
    async list() { return { blobs: [{ pathname: "backups/oracle/texttext/texttext-20260901T120000Z-12345678.dump.aes256gcm", size: 10, url: "https://example.invalid/old" }], hasMore: false }; },
    async put(path, stream) { for await (const chunk of stream) void chunk; return { url: "https://example.invalid/new", pathname: path }; },
    async get() { return { statusCode: 200, stream: Readable.toWeb(Readable.from([Buffer.from("corrupt")])) }; },
    async del(url) { deleted.push(url); },
  };
  await assert.rejects(() => uploadEncryptedBackup(source, { BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), BLOB_READ_WRITE_TOKEN: "fixture-token" }, client), /previous verified backups were preserved/);
  assert.deepEqual(deleted, ["https://example.invalid/new"]);
});
