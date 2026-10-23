import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createBackup } from "./backup.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "texttext-backup-preservation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "backups");
  mkdirSync(directory, { mode: 0o700 });
  const previous = Array.from({ length: 7 }, (_, index) => `texttext-2026100${index + 1}T120000Z-12345678.dump`);
  for (const [index, name] of previous.entries()) {
    writeFileSync(join(directory, name), `validated prior archive ${index}`, { mode: 0o600 });
    utimesSync(join(directory, name), index + 1, index + 1);
  }
  const dump = join(root, "pg_dump"), restore = join(root, "pg_restore");
  writeFileSync(dump, "#!/bin/sh\nprintf 'new validated archive'\n", { mode: 0o700 });
  writeFileSync(restore, "#!/bin/sh\n[ \"$1\" = --list ]\n", { mode: 0o700 });
  return { directory, previous, dump, environment: {
    DATABASE_URL: "postgres://test:test@127.0.0.1:5433/texttext",
    PG_DUMP: dump, PG_RESTORE: restore, TEXTTEXT_BACKUP_DIR: directory,
    TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.ppid), TEXTTEXT_BACKUP_MAX_BYTES: "1024",
    TEXTTEXT_STORAGE_MIN_FREE_BYTES: "0",
  } };
}

for (const setting of [undefined, "0", "1"]) test(`backup preservation ${setting ?? "default"} retains the intended archives`, async t => {
  const { directory, previous, environment } = fixture(t);
  if (setting !== undefined) environment.TEXTTEXT_BACKUP_PRESERVE_EXISTING = setting;
  const archive = await createBackup(environment);
  assert.equal(readFileSync(archive, "utf8"), "new validated archive");
  const names = readdirSync(directory);
  assert.equal(names.length, setting === "1" ? 8 : 7);
  for (const [index, name] of previous.entries()) {
    if (index === 0 && setting !== "1") { assert.equal(names.includes(name), false); continue; }
    assert.equal(readFileSync(join(directory, name), "utf8"), `validated prior archive ${index}`);
  }
});

test("preservation validates its flag and keeps the free-space and archive-size guards", async t => {
  const { directory, previous, dump, environment } = fixture(t);
  for (const setting of ["", "true", "2"]) await assert.rejects(createBackup({ ...environment, TEXTTEXT_BACKUP_PRESERVE_EXISTING: setting }), /must be 0 or 1/);
  const preserving = { ...environment, TEXTTEXT_BACKUP_PRESERVE_EXISTING: "1" };
  await assert.rejects(createBackup({ ...preserving, TEXTTEXT_STORAGE_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) }), /insufficient space/);
  writeFileSync(dump, "#!/bin/sh\nprintf '%02048d' 0\n", { mode: 0o700 });
  await assert.rejects(createBackup(preserving), /exceeded its configured storage budget/);
  assert.deepEqual(readdirSync(directory).sort(), previous);
});

test("only the deployment transient service enables preservation", () => {
  const deploy = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
  assert.match(deploy, /--unit=texttext-deploy-backup\.service[\s\S]*\/usr\/bin\/env TEXTTEXT_BACKUP_PRESERVE_EXISTING=1 \/usr\/bin\/node "\$release\/release\/oracle\/backup\.mjs"/);
  assert.doesNotMatch(readFileSync(new URL("./texttext-backup.service", import.meta.url), "utf8"), /TEXTTEXT_BACKUP_PRESERVE_EXISTING/);
});

test("deployment command overrides retention settings loaded from the service environment", t => {
  const { directory, previous, environment } = fixture(t);
  const result = spawnSync("/usr/bin/env", ["TEXTTEXT_BACKUP_PRESERVE_EXISTING=1", process.execPath, fileURLToPath(new URL("./backup.mjs", import.meta.url))], {
    env: { ...environment, TEXTTEXT_BACKUP_PRESERVE_EXISTING: "0" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readdirSync(directory).length, 8);
  for (const [index, name] of previous.entries()) assert.equal(readFileSync(join(directory, name), "utf8"), `validated prior archive ${index}`);
});
