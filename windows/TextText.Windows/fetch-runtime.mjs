// Explicit build-time bootstrap only. Never run from an installed app or installer.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, cp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
const version = '0.153.4';
const integrity = 'lMkB43kJZH0VFr+hoXc11qqR7QtQIbkr07ALgj4urKL1osNyUyuy1iXd3Vzz2iCYvBUCSw7I0l/W1cEPGx9euQ==';
const output = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), 'Runtime'));
const scratch = await mkdtemp(join(tmpdir(), 'texttext-codex-'));
try {
  const archive = join(scratch, 'codex.tgz');
  const response = await fetch(`https://registry.npmjs.org/@openai/codex/-/codex-${version}-win32-x64.tgz`);
  if (!response.ok || !response.body) throw new Error('Codex package download failed');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest('base64') !== integrity) throw new Error('Codex package integrity mismatch');
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 65536 }).split('\n').filter(Boolean);
  if (names.some(name => name.startsWith('/') || name.includes('\\') || name.split('/').includes('..'))) throw new Error('Invalid package paths');
  const executable = names.find(name => /\/bin\/codex\.exe$/.test(name));
  if (!executable) throw new Error('Native Codex binary missing');
  const prefix = executable.slice(0, -'bin/codex.exe'.length);
  const selected = names.filter(name => name.startsWith(prefix) && !name.endsWith('/'));
  execFileSync('tar', ['-xzf', archive, '-C', scratch, ...selected]);
  await mkdir(output, { recursive: true });
  for (const name of await readdir(join(scratch, prefix))) await cp(join(scratch, prefix, name), join(output, name), { recursive: true });
  await writeFile(join(output, 'runtime-receipt.json'), JSON.stringify({ version, platform: 'win32-x64', packageIntegrity: `sha512-${integrity}` }, null, 2) + '\n');
  console.log(`Bundled native Codex ${version} for Windows x64.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
