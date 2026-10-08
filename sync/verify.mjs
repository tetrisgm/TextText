import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
export const inputs = ['src', 'sync', 'presets/builtin', 'scripts/generate-builtin-presets.ts', 'scripts/builtin-preset-assets.ts', 'scripts/fixtures', 'scripts/vault-http-test-server.ts', 'mac/Sources', 'mac/Tests',
  'scripts/build-local-vault.mjs', 'scripts/verify-production-shutdown.mjs', 'windows/scripts/build-ui.mjs', 'windows/TextText.Windows/TextText.Windows.csproj',
  'mac/Package.swift', 'mac/Package.resolved', 'package.json', 'package-lock.json',
  'tsconfig.json', 'vitest.config.ts', 'scripts/test-sync.sh', 'release/ship.sh', 'mac/scripts/build-app.sh', 'mac/scripts/build-store.sh'];

export async function fingerprint(base, paths = inputs) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const absolute = path.join(base, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Sync input must not be a symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) await visit(`${relative}/${name}`);
    } else if (stat.isFile() && !relative.endsWith('.md') && !relative.endsWith('.DS_Store')) {
      hash.update(relative).update('\0').update(await fs.readFile(absolute)).update('\0');
    }
  }
  for (const input of paths) await visit(input);
  return hash.digest('hex');
}

export function validateReceipt(receipt, digest, platform, scope) {
  if (receipt?.schema !== 1 || receipt.status !== 'passed' || receipt.digest !== digest ||
      receipt.platform !== platform || receipt.scope !== scope || receipt.node !== process.versions.node) {
    throw new Error(`Missing or stale ${scope} sync verification. Run npm run test:sync.`);
  }
}

export async function recordPassingRun(receiptPath, digest, platform, scope, execute, currentFingerprint) {
  // Never leave a previous success usable after a failed rerun.
  await fs.rm(receiptPath, { force: true });
  await execute();
  if (await currentFingerprint() !== digest) throw new Error('Source changed while sync tests ran; no receipt issued.');
  const receipt = { schema: 1, status: 'passed', digest, platform,
    node: process.versions.node, scope, completedAt: new Date().toISOString() };
  const temporary = `${receiptPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(receipt, null, 2));
  await fs.rename(temporary, receiptPath);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) if (!['--check', '--core-only', '--native-only', '--client-only'].includes(flag)) throw new Error(`Unknown flag ${flag}`);
  if (['--core-only', '--native-only', '--client-only'].filter(flag => flags.has(flag)).length > 1) throw new Error('Choose one scope.');
  const scopes = flags.has('--client-only') ? ['client'] : flags.has('--core-only') ? ['core'] : flags.has('--native-only') ? ['native'] : ['core', 'native'];
  if (scopes.includes('native') && process.platform !== 'darwin') throw new Error('Native sync verification requires macOS. Use --client-only on Windows or --core-only on Linux.');
  if (scopes.includes('core') && process.platform === 'win32') throw new Error('Server durability requires POSIX directory fsync. Use --client-only on Windows.');
  const dir = path.join(root, '.texttext/sync');
  if (!flags.has('--check')) await fs.mkdir(dir, { recursive: true });
  const digest = await fingerprint(root);
  for (const scope of scopes) {
    const receiptPath = path.join(dir, `${process.platform}-${scope}.json`);
    if (flags.has('--check')) {
      let receipt;
      try { receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); } catch { /* fail closed below */ }
      validateReceipt(receipt, digest, process.platform, scope);
      console.log(`Sync ${scope}: matching passed receipt.`);
      continue;
    }
    await recordPassingRun(receiptPath, digest, process.platform, scope, async () => {
      await run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/generate-builtin-presets.ts', '--check']);
      if (scope === 'core' || scope === 'client') {
        await run(process.execPath, ['--test', 'sync/verify.test.mjs']);
        await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config',
          scope === 'client' ? 'sync/vitest.client.config.mts' : 'sync/vitest.config.mts']);
        await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']);
      } else await run('bash', ['scripts/test-sync.sh', '--native-only']);
    }, () => fingerprint(root));
    console.log(`Sync ${scope}: passed, exact-source receipt saved.`);
  }
}
if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
