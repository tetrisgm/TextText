import { lstat, readdir, readFile, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

async function inventory(root) {
  const entries = [];
  async function visit(relative) {
    const full = path.join(root, relative);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`Backup requires review of a reparse point: ${relative}`);
    if (stat.isDirectory()) {
      entries.push({ path: relative, directory: true });
      for (const name of (await readdir(full)).sort()) await visit(path.join(relative, name));
    } else if (stat.isFile()) {
      entries.push({ path: relative, hash: createHash('sha256').update(await readFile(full)).digest('hex') });
    } else throw new Error(`Unsupported backup entry: ${relative}`);
  }
  await visit('');
  return entries;
}

export async function backupDirectory(source, target) {
  source = path.resolve(source);
  target = path.resolve(target);
  const relative = path.relative(source, target);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Backup target must be outside the source.');
  }
  const before = await inventory(source);
  if (!before[0]?.directory) throw new Error('Backup source must be a directory.');
  // Exclusive creation preserves partial backups and refuses accidental overwrite.
  await mkdir(target);
  for (const entry of before.slice(1)) {
    const destination = path.join(target, entry.path);
    if (entry.directory) await mkdir(destination);
    else await copyFile(path.join(source, entry.path), destination, constants.COPYFILE_EXCL);
  }
  const expected = JSON.stringify(before);
  if (expected !== JSON.stringify(await inventory(source)) || expected !== JSON.stringify(await inventory(target))) {
    throw new Error('Backup mismatch; nothing may be installed.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: backup-directory.mjs SOURCE TARGET');
  await backupDirectory(process.argv[2], process.argv[3]);
}
