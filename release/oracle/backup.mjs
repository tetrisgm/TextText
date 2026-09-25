#!/usr/bin/env node
import { closeSync, createWriteStream, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { localDatabase, protectedEnvironment } from "./start.mjs";
import { decryptBackup, uploadEncryptedBackup } from "./backup-remote.mjs";

const archivePattern = /^texttext-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/;

function backupDirectory(environment) {
  const directory = resolve(environment.TEXTTEXT_BACKUP_DIR || "/var/lib/texttext-backups");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Backup directory must be private (mode 0700).");
  return directory;
}

export function backupConnection(environment) {
  const url = localDatabase(environment.DATABASE_URL);
  // No connection string or password appears in command arguments or output.
  return {
    ...environment,
    PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "texttext-backup",
  };
}

export function retainedArchives(directory, { keep, maxBytes, requiredPath }) {
  const archives = readdirSync(directory).filter((name) => archivePattern.test(name)).map((name) => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    return { path, size: stat.size, modified: stat.mtimeMs, regular: stat.isFile() && !stat.isSymbolicLink() };
  }).filter((item) => item.regular).sort((left, right) => {
    if (left.path === requiredPath) return -1;
    if (right.path === requiredPath) return 1;
    return right.modified - left.modified || right.path.localeCompare(left.path);
  });
  let used = 0;
  return archives.map((archive, index) => {
    used += archive.size;
    return { ...archive, remove: index >= keep || used > maxBytes };
  });
}

export async function createBackup(environment) {
  const childEnvironment = backupConnection(environment);
  const directory = backupDirectory(environment);
  const keep = Number(environment.TEXTTEXT_BACKUP_KEEP || "7");
  const maxBytes = Number(environment.TEXTTEXT_BACKUP_MAX_BYTES || String(5 * 1024 ** 3));
  if (!Number.isInteger(keep) || keep < 1 || keep > 31 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new Error("Backup retention must be 1 to 31 files with a positive byte budget.");
  }
  // Production always enters through flock below. Unlike a directory lease,
  // the kernel releases this lock after a crash or reboot.
  if (process.platform === "linux" && environment.TEXTTEXT_BACKUP_FLOCK_PARENT !== String(process.ppid)) {
    throw new Error("Use the backup CLI so the Linux kernel lock is held.");
  }
  const lock = process.platform === "linux" ? null : join(directory, ".backup-lock");
  if (lock) mkdirSync(lock, { mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const final = join(directory, `texttext-${stamp}-${randomBytes(4).toString("hex")}.dump`);
  const temporary = `${final}.partial`;
  let child;
  try {
    child = spawn(environment.PG_DUMP || "pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--compress=6"], { env: childEnvironment, stdio: ["ignore", "pipe", "ignore"] });
    const completed = new Promise((accept) => {
      child.on("error", () => accept(false));
      child.on("close", (code) => accept(code === 0));
    });
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error("Backup exceeded its configured storage budget.") : null, chunk);
      },
    });
    await pipeline(child.stdout, limit, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    if (!await completed) throw new Error("pg_dump failed; previous backups were preserved.");
    const check = spawnSync(environment.PG_RESTORE || "pg_restore", ["--list", temporary], { env: childEnvironment, stdio: "ignore" });
    if (check.error || check.status !== 0 || bytes === 0) throw new Error("Backup archive validation failed; previous backups were preserved.");
    const descriptor = openSync(temporary, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, final);
    try {
      if (environment.TEXTTEXT_BACKUP_UPLOAD === "1") await uploadEncryptedBackup(final, environment);
    } finally {
      // A failed upload must not allow local successful dumps to fill the VM.
      for (const archive of retainedArchives(directory, { keep, maxBytes, requiredPath: final })) {
        if (archive.remove) rmSync(archive.path);
      }
    }
    console.log("TextText database backup completed.");
    return final;
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    rmSync(temporary, { force: true });
    if (lock) rmSync(lock, { recursive: true });
  }
}

async function backupCLI(environment) {
  if (process.platform !== "linux" || environment.TEXTTEXT_BACKUP_FLOCK_PARENT === String(process.ppid)) {
    return createBackup(environment);
  }
  backupConnection(environment);
  const directory = backupDirectory(environment);
  const lockfile = join(directory, ".backup.flock");
  let stat;
  try { stat = lstatSync(lockfile); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Invalid backup kernel lock file.");
  const result = spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", "--no-fork", lockfile, process.execPath, resolve(process.argv[1]), ...process.argv.slice(2)], {
    env: { ...environment, TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.pid) }, stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.error || result.status !== 0) throw new Error("Backup did not complete, or another backup already holds the lock.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    let environment = process.env;
    if (args[0] === "--env-file" && args[1]) {
      environment = { ...process.env, ...protectedEnvironment(args[1]) };
      args.splice(0, 2);
    }
    if (args[0] === "--require-upload") {
      args.shift();
      if (environment.TEXTTEXT_BACKUP_UPLOAD !== "1") throw new Error("Production backups require TEXTTEXT_BACKUP_UPLOAD=1.");
    }
    if (args.length === 0) await backupCLI(environment);
    else if (args.length === 4 && args[0] === "--decrypt" && args[2] === "--out") {
      await decryptBackup(args[1], args[3], environment.BACKUP_ENCRYPTION_KEY);
      console.log("Backup decrypted. Restore into a separate database before promoting it.");
    } else throw new Error("Usage: backup.mjs [--env-file <private file>] [--require-upload | --decrypt <archive> --out <new dump>]");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database backup failed.");
    process.exitCode = 1;
  }
}
