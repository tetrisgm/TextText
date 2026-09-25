import assert from "node:assert/strict";
import { test } from "node:test";
import { createReadStream, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { restoreDrill } from "./restore-drill.mjs";
import { encryptBackup } from "./backup-remote.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "texttext-restore-guard-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const adminEnv = join(directory, "admin.env");
  const backupEnv = join(directory, "backup.env");
  const recoveryKeyFile = join(directory, "recovered.env");
  const key = randomBytes(32).toString("base64");
  writeFileSync(adminEnv, "DATABASE_URL=postgres://127.0.0.1:5433/postgres\n", { mode: 0o600 });
  writeFileSync(backupEnv, "DATABASE_URL=postgres://127.0.0.1:5433/texttext\nBLOB_READ_WRITE_TOKEN=fixture-only\nTEXTTEXT_BACKUP_UPLOAD_MAX_BYTES=1024\n", { mode: 0o600 });
  writeFileSync(recoveryKeyFile, `BACKUP_ENCRYPTION_KEY=${key}\n`, { mode: 0o600 });
  return { directory, key, options: { scratch: true, release: resolve("."), adminEnv, backupEnv, recoveryKeyFile } };
}

const pathname = "backups/oracle/texttext/texttext-20260927T000000Z-aabbccdd.dump.aes256gcm";

test("restore CLI executes through a current symlink and requires explicit scratch/key arguments", async (t) => {
  const { directory } = fixture(t);
  symlinkSync(resolve("."), join(directory, "current"));
  const result = spawnSync(process.execPath, [join(directory, "current/release/oracle/restore-drill.mjs"), "--invalid"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: restore-drill/);
  await assert.rejects(restoreDrill(), /Require --scratch and --recovery-key-file/);
  await assert.rejects(restoreDrill({ scratch: true }), /Require --scratch and --recovery-key-file/);
});

test("restore rejects unbounded inventory before opening a database", async (t) => {
  const { options } = fixture(t);
  let downloaded = false;
  await assert.rejects(restoreDrill({ ...options, suppliedBlob: {
    list: async () => ({ hasMore: true, blobs: [] }),
    get: async () => { downloaded = true; throw new Error("Should not download."); },
  } }), /read-only backup inventory/);
  assert.equal(downloaded, false);
});

test("download byte limit aborts before database creation", async (t) => {
  const { options } = fixture(t);
  await assert.rejects(restoreDrill({ ...options, suppliedBlob: {
    list: async () => ({ hasMore: false, blobs: [{ pathname, url: "fixture://backup", size: 1024 }] }),
    get: async () => ({ statusCode: 200, stream: Readable.from([randomBytes(2048)]) }),
  } }), /bounded off-server download/);
});

test("an incorrect independently recovered key fails before database creation", async (t) => {
  const { directory, options } = fixture(t);
  const original = join(directory, "original.dump");
  const encrypted = join(directory, "encrypted.dump");
  writeFileSync(original, randomBytes(256), { mode: 0o600 });
  await encryptBackup(original, encrypted, randomBytes(32).toString("base64"));
  await assert.rejects(restoreDrill({ ...options, suppliedBlob: {
    list: async () => ({ hasMore: false, blobs: [{ pathname, url: "fixture://backup", size: statSync(encrypted).size }] }),
    get: async () => ({ statusCode: 200, stream: createReadStream(encrypted) }),
  } }), /independent-key authenticated decryption/);
});
