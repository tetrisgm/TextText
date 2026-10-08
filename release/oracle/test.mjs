import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { copyWithoutSecrets, relativeBuildDirectory, restoreExternalPackageAliases } from "./package.mjs";
import { localDatabase, protectedEnvironment, runtimeEnvironment } from "./start.mjs";
import { backupConnection, createBackup, retainedArchives } from "./backup.mjs";
import { verifyPackage } from "./verify-package.mjs";
import { isEntrypoint } from "./entrypoint.mjs";
import { installHttpShutdownLifecycle } from "./shutdown-diagnostics.mjs";
import { createServer, get, request as httpRequest, Agent } from "node:http";
import { EventEmitter, once } from "node:events";

test("shutdown diagnostics identify unfinished HTTP without logging private request data", async () => {
  const signals = new EventEmitter(), logs = [];
  const diagnostics = installHttpShutdownLifecycle({ signals, log: text => logs.push(text), delays: [] });
  const agent = new Agent({ keepAlive: true });
  let response;
  const server = createServer((request, outgoing) => { response = outgoing; });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const pending = new Promise((resolve, reject) => {
      get({ host: '127.0.0.1', port: server.address().port, path: '/api/vault/private-workspace/items?token=private-secret', headers: { authorization: 'private-credential' }, agent }, incoming => {
        incoming.resume(); incoming.once('end', resolve);
      }).once('error', reject);
    });
    await once(server, 'request');
    assert.equal(diagnostics.snapshot().active['GET:manifest'].count, 1);
    signals.emit('SIGTERM');
    assert.equal(logs.length, 1);
    for (const privateValue of ['private-workspace', 'private-secret', 'private-credential', 'token', 'authorization']) assert.ok(!logs[0].includes(privateValue));
    assert.ok(!response.writableEnded, 'diagnostics must not cancel a request or write');
    response.end('saved'); await pending;
    assert.deepEqual(diagnostics.snapshot().active, {});
    assert.equal(response.shouldKeepAlive, false, 'completed operation must retire its proxy connection during drain');
  } finally {
    agent.destroy(); await new Promise(resolve => server.close(resolve)); diagnostics.dispose();
  }
  assert.deepEqual(diagnostics.snapshot(), { sockets: 0, unstartedSockets: 0, active: {} });
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test("shutdown retires a reused proxy socket after its durable write completes", async () => {
  const signals = new EventEmitter();
  const lifecycle = installHttpShutdownLifecycle({ signals, log: () => {}, delays: [] });
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  let writeResponse, saved = false;
  const server = createServer((request, response) => {
    if (request.url === '/warm') response.end('ready');
    else { writeResponse = response; }
  });
  const request = (path, method = 'GET') => new Promise((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, agent }, incoming => {
      let body = ''; incoming.on('data', bytes => { body += bytes; });
      incoming.once('end', () => resolve({ body, headers: incoming.headers }));
    }).once('error', reject).end();
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    await request('/warm');
    const pending = request('/durable-write', 'POST');
    await once(server, 'request');
    signals.emit('SIGTERM');
    const closed = new Promise(resolve => server.close(resolve));
    assert.equal(writeResponse.writableEnded, false);
    saved = true; writeResponse.end('committed');
    assert.equal((await pending).body, 'committed');
    await closed;
    assert.equal(saved, true);
  } finally { agent.destroy(); await new Promise(resolve => server.close(resolve)); lifecycle.dispose(); }
});

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "texttext-oracle-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("all Oracle CLIs execute through the current release symlink", (t) => {
  const directory = temporary(t);
  const current = join(directory, "current");
  symlinkSync(resolve("."), current, "dir");
  for (const name of ["start", "backup", "bootstrap-database", "smoke", "package", "prepare-migrations", "verify-package"]) {
    const result = spawnSync(process.execPath, [join(current, "release/oracle", `${name}.mjs`), "--invalid-option"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    assert.equal(result.status, 1, `${name} must execute its CLI rather than silently exit`);
    assert.match(result.stderr, name === "start" ? /Linux ARM64|Usage:/ : /Usage:|ENOENT/, `${name} must report its argument guard`);
  }
  const file = join(directory, "unsafe.env");
  writeFileSync(file, "EXAMPLE=not-a-secret\n", { mode: 0o644 });
  const backup = spawnSync(process.execPath, [join(current, "release/oracle/backup.mjs"), "--env-file", file], { encoding: "utf8" });
  assert.equal(backup.status, 1);
  assert.match(backup.stderr, /private regular file/);
  assert.equal(isEntrypoint(import.meta.url, "-"), false);
});

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

test("deployment validates an incoming local backup before migration", () => {
  const deploy = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
  const orderedSteps = [
    "sha256sum --check release.tar.gz.sha256",
    "tar --extract --gzip --file release.tar.gz",
    'require("@next/swc-linux-arm64-gnu")',
    "sudo -n /usr/bin/systemd-run",
    '"$release/release/oracle/bootstrap-database.mjs"',
    'mv -Tf "$root/.current-$$" "$root/current"',
  ];
  let previous = -1;
  for (const step of orderedSteps) {
    const position = deploy.indexOf(step);
    assert.ok(position > previous, `${step} must follow the prior verified deployment step`);
    previous = position;
  }

  const backupStart = deploy.indexOf('if [ -n "$previous" ]; then', deploy.indexOf("sha256sum --check"));
  const backupEnd = deploy.indexOf('\nfi\nif [ "$bootstrap" = 1 ]', backupStart);
  assert.ok(backupStart >= 0 && backupEnd > backupStart, "existing releases must have a bounded backup gate");
  const backup = deploy.slice(backupStart, backupEnd);
  assert.match(backup, /--unit=texttext-deploy-backup\.service/);
  assert.match(backup, /--wait --collect --pipe --quiet/);
  assert.match(backup, /--uid=ubuntu --gid=ubuntu/);
  assert.match(backup, /--property=EnvironmentFile=\/etc\/texttext\/backup\.env/);
  assert.match(backup, /--property=IPAddressDeny=any/);
  assert.match(backup, /--property=IPAddressAllow=localhost/);
  assert.match(backup, /--property="ReadWritePaths=\$root\/backups"/);
  assert.match(backup, /\/usr\/bin\/node "\$release\/release\/oracle\/backup\.mjs" <\/dev\/null/);
  assert.doesNotMatch(backup, /require-upload|R2|BLOB|algorave/i);
  assert.doesNotMatch(backup, /systemctl (restart|stop|reload)/);
  assert.doesNotMatch(deploy, /systemctl start texttext-backup\.service/);
  assert.match(deploy, /stat -c '%u:%g:%a' \/etc\/texttext\/backup\.env/);
  assert.match(deploy, /The TextText deployment root cannot overlap Algorave/);
  const smoke = deploy.indexOf('"$release/release/oracle/smoke.mjs"');
  const unitInstall = deploy.indexOf('install -o root -g root -m 0644 "$backup_unit_rendered"', smoke);
  const daemonReload = deploy.indexOf("systemctl daemon-reload", unitInstall);
  assert.ok(smoke >= 0 && unitInstall > smoke && daemonReload > unitInstall, "the reviewed backup unit must cut over only after application verification");
  assert.match(deploy, /mv -Tf "\$backup_unit_previous" "\$backup_unit"/);
  assert.match(deploy, /systemd-analyze verify "\$backup_unit_rendered"/);

  const service = readFileSync(new URL("./texttext-backup.service", import.meta.url), "utf8");
  assert.match(service, /ExecStart=.*backup\.mjs$/m);
  assert.match(service, /^IPAddressDeny=any$/m);
  assert.match(service, /^IPAddressAllow=localhost$/m);
  assert.doesNotMatch(service, /upload|R2|BLOB/i);
  const packaging = readFileSync(new URL("./package.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(packaging, /backup-remote|r2-backup-client/);
  assert.match(packaging, /"texttext-backup\.service"/);

  const database = readFileSync(new URL("./database.sh", import.meta.url), "utf8");
  assert.doesNotMatch(database, /systemctl start texttext-backup\.service/);
  assert.match(database, /--unit=texttext-release-backup\.service/);
  assert.match(database, /"\$prepared\/release\/oracle\/backup\.mjs"/);
  assert.ok(database.indexOf("texttext-release-backup.service") < database.indexOf('"$root/current/release/oracle/bootstrap-database.mjs"'));

  const backupSource = readFileSync(new URL("./backup.mjs", import.meta.url), "utf8");
  assert.match(backupSource, /args\[0\] === "--require-upload"/);
});

test("backup creates one atomic validated local archive without upload settings", async (t) => {
  const directory = temporary(t);
  const backups = join(directory, "backups");
  const dump = join(directory, "pg_dump");
  const restore = join(directory, "pg_restore");
  mkdirSync(backups, { mode: 0o700 });
  writeFileSync(dump, "#!/bin/sh\nprintf 'validated local archive'\n", { mode: 0o700 });
  writeFileSync(restore, "#!/bin/sh\n[ \"$1\" = --list ]\n", { mode: 0o700 });
  const archive = await createBackup({
    DATABASE_URL: "postgres://test:test@127.0.0.1:5433/texttext",
    PG_DUMP: dump, PG_RESTORE: restore, TEXTTEXT_BACKUP_DIR: backups,
    TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.ppid), TEXTTEXT_BACKUP_MAX_BYTES: "1024",
    TEXTTEXT_BACKUP_UPLOAD: "1", BLOB_READ_WRITE_TOKEN: "unused-legacy-value",
    TEXTTEXT_R2_ACCESS_KEY_ID: "unused", TEXTTEXT_R2_SECRET_ACCESS_KEY: "unused",
  });
  assert.match(archive, /texttext-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/);
  assert.equal(readFileSync(archive, "utf8"), "validated local archive");
  assert.equal(lstatSync(archive).mode & 0o077, 0);
  assert.deepEqual(readdirSync(backups), [archive.split("/").at(-1)]);
});

test("backup commits its new directory entry before committing retention deletions", async (t) => {
  const directory = temporary(t);
  const backups = join(directory, "backups");
  const dump = join(directory, "pg_dump");
  const restore = join(directory, "pg_restore");
  const priorName = "texttext-20260901T120000Z-12345678.dump";
  mkdirSync(backups, { mode: 0o700 });
  writeFileSync(join(backups, priorName), "previous good backup", { mode: 0o600 });
  writeFileSync(dump, "#!/bin/sh\nprintf 'new validated archive'\n", { mode: 0o700 });
  writeFileSync(restore, "#!/bin/sh\n[ \"$1\" = --list ]\n", { mode: 0o700 });
  const committedInventories = [];
  const archive = await createBackup({
    DATABASE_URL: "postgres://test:test@127.0.0.1:5433/texttext",
    PG_DUMP: dump, PG_RESTORE: restore, TEXTTEXT_BACKUP_DIR: backups,
    TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.ppid), TEXTTEXT_BACKUP_KEEP: "1",
    TEXTTEXT_BACKUP_MAX_BYTES: "1024", TEXTTEXT_STORAGE_MIN_FREE_BYTES: "0",
  }, {
    syncDirectoryImpl(path) {
      committedInventories.push(readdirSync(path).filter(name => name.endsWith(".dump")).sort());
    },
  });
  const archiveName = archive.split("/").at(-1);
  assert.deepEqual(committedInventories, [
    [priorName, archiveName].sort(),
    [archiveName],
  ]);
  assert.deepEqual(readdirSync(backups), [archiveName]);
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
    PG_DUMP: binary, TEXTTEXT_BACKUP_DIR: backups, TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.ppid),
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
    TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.ppid),
  }), /storage budget/);
  assert.deepEqual(readdirSync(backups), []);
});

test("backup preserves validated archives when the free-space floor cannot be reserved", async (t) => {
  const directory = temporary(t);
  const backups = join(directory, "backups");
  const binary = join(directory, "pg_dump");
  const prior = join(backups, "texttext-20260901T120000Z-12345678.dump");
  mkdirSync(backups, { mode: 0o700 });
  writeFileSync(prior, "previous good backup", { mode: 0o600 });
  writeFileSync(binary, `#!/bin/sh\nprintf ran > ${JSON.stringify(join(backups, "pg_dump-ran"))}\n`, { mode: 0o700 });
  await assert.rejects(() => createBackup({
    DATABASE_URL: "postgres://test:test@127.0.0.1:5433/texttext",
    PG_DUMP: binary, TEXTTEXT_BACKUP_DIR: backups, TEXTTEXT_BACKUP_MAX_BYTES: "1024",
    TEXTTEXT_STORAGE_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER),
    TEXTTEXT_BACKUP_FLOCK_PARENT: String(process.ppid),
  }), /free-space floor/);
  assert.equal(readFileSync(prior, "utf8"), "previous good backup");
  assert.deepEqual(readdirSync(backups), ["texttext-20260901T120000Z-12345678.dump"]);
});


test("Oracle external aliases share real Yjs constructors with awareness peers", (t) => {
  const app = temporary(t);
  const aliases = join(app, ".next/node_modules");
  mkdirSync(aliases, {recursive:true});
  for (const name of ["yjs", "y-protocols", "lib0", "isomorphic.js"]) cpSync(resolve("node_modules",name), join(app,"node_modules",name), {recursive:true});
  const yAlias="yjs-0123456789abcdef", protocolAlias="y-protocols-0123456789abcdef";
  for(const [alias,name] of [[yAlias,"yjs"],[protocolAlias,"y-protocols"]]) cpSync(join(app,"node_modules",name),join(aliases,alias),{recursive:true});
  const script=`import * as direct from './.next/node_modules/${yAlias}/dist/yjs.mjs';
    import * as peer from './node_modules/yjs/dist/yjs.mjs';
    import { Awareness } from './.next/node_modules/${protocolAlias}/awareness.js';
    const doc=new direct.Doc();const awareness=new Awareness(doc);
    const same=direct.Doc===peer.Doc && awareness.doc instanceof peer.Doc;
    awareness.destroy();doc.destroy();if(!same)process.exitCode=2;`;
  const before=spawnSync(process.execPath,["--input-type=module","-e",script],{cwd:app,encoding:"utf8"});
  assert.equal(before.status,2);assert.match(before.stderr,/Yjs was already imported/);
  restoreExternalPackageAliases(app,".next");
  assert.equal(lstatSync(join(aliases,yAlias)).isSymbolicLink(),true);
  const after=spawnSync(process.execPath,["--input-type=module","-e",script],{cwd:app,encoding:"utf8"});
  assert.equal(after.status,0,after.stderr);assert.doesNotMatch(after.stderr,/Yjs was already imported/);
  // Repackaged aliases remain idempotent; mismatched locked copies fail closed.
  restoreExternalPackageAliases(app,".next");
  rmSync(join(aliases,yAlias));mkdirSync(join(aliases,yAlias));
  writeFileSync(join(aliases,yAlias,"package.json"),JSON.stringify({name:"yjs",version:"0.0.0"}));
  assert.throws(()=>restoreExternalPackageAliases(app,".next"),/version mismatch/);
});


test("external alias repair refuses dependency escape and preserves unrelated directories", (t) => {
  const root=temporary(t), app=join(root,"app"), aliases=join(app,".next/node_modules");
  mkdirSync(aliases,{recursive:true});mkdirSync(join(app,"node_modules"));
  const outside=join(root,"outside");mkdirSync(outside);
  writeFileSync(join(outside,"package.json"),JSON.stringify({name:"yjs",version:"1"}));
  symlinkSync(outside,join(app,"node_modules/yjs"),"dir");
  const alias=join(aliases,"yjs-0123456789abcdef");mkdirSync(alias);
  writeFileSync(join(alias,"package.json"),JSON.stringify({name:"yjs",version:"1"}));
  const unrelated=join(aliases,"leave-alone");mkdirSync(unrelated);writeFileSync(join(unrelated,"keep"),"keep");
  assert.throws(()=>restoreExternalPackageAliases(app,".next"),/escaped runtime/);
  assert.equal(lstatSync(alias).isDirectory(),true);
  assert.equal(readFileSync(join(unrelated,"keep"),"utf8"),"keep");
});
