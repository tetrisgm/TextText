import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { newestLocalBackup, restoreDrill } from "./restore-drill.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "texttext-restore-guard-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const backups = join(directory, "backups");
  const adminEnv = join(directory, "admin.env");
  const backupEnv = join(directory, "backup.env");
  mkdirSync(backups, { mode: 0o700 });
  writeFileSync(adminEnv, "DATABASE_URL=postgres://127.0.0.1:5433/postgres\n", { mode: 0o600 });
  writeFileSync(backupEnv, [
    "DATABASE_URL=postgres://127.0.0.1:5433/texttext",
    `TEXTTEXT_BACKUP_DIR=${backups}`,
    "TEXTTEXT_BACKUP_MAX_BYTES=2048",
    "PG_RESTORE=/usr/bin/false",
    "",
  ].join("\n"), { mode: 0o600 });
  return { directory, backups, options: { scratch: true, release: resolve("."), adminEnv, backupEnv } };
}

test("restore CLI executes through a current symlink and requires explicit scratch authorization", async (t) => {
  const { directory } = fixture(t);
  symlinkSync(resolve("."), join(directory, "current"));
  const result = spawnSync(process.execPath, [join(directory, "current/release/oracle/restore-drill.mjs"), "--invalid"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: restore-drill/);
  await assert.rejects(restoreDrill(), /Require --scratch/);
});

test("newest local backup selection is bounded and ignores unrelated files", (t) => {
  const { backups } = fixture(t);
  writeFileSync(join(backups, ".backup.flock"), "");
  writeFileSync(join(backups, "unrelated.txt"), "leave me alone");
  const older = "texttext-20260927T000000Z-aabbccdd.dump";
  const newer = "texttext-20260928T000000Z-aabbccdd.dump";
  writeFileSync(join(backups, older), "older", { mode: 0o600 });
  writeFileSync(join(backups, newer), "newer", { mode: 0o600 });
  assert.equal(newestLocalBackup(backups, 1024).name, newer);
  assert.throws(() => newestLocalBackup(backups, 512), /byte budget/);
});

test("local backup selection rejects unsafe archives and directories", (t) => {
  const { directory, backups } = fixture(t);
  const target = join(directory, "target.dump");
  writeFileSync(target, "not trusted", { mode: 0o600 });
  symlinkSync(target, join(backups, "texttext-20260927T000000Z-aabbccdd.dump"));
  assert.throws(() => newestLocalBackup(backups, 1024), /private regular files/);
  rmSync(join(backups, "texttext-20260927T000000Z-aabbccdd.dump"));
  writeFileSync(join(backups, "texttext-20260927T000000Z-aabbccdd.dump"), Buffer.alloc(2048), { mode: 0o600 });
  assert.throws(() => newestLocalBackup(backups, 1024), /restore byte budget/);
  chmodSync(backups, 0o755);
  assert.throws(() => newestLocalBackup(backups, 4096), /mode 0700/);
});

test("invalid newest local archive fails before database creation", async (t) => {
  const { backups, options } = fixture(t);
  writeFileSync(join(backups, "texttext-20260927T000000Z-aabbccdd.dump"), "not a postgres archive", { mode: 0o600 });
  await assert.rejects(restoreDrill(options), /PostgreSQL archive validation/);
});

test("empty local backup inventory fails before database creation", async (t) => {
  const { options } = fixture(t);
  await assert.rejects(restoreDrill(options), /local backup selection/);
});
