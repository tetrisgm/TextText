import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backupDirectory } from './backup-directory.mjs';

test('long destination copies exact hidden recovery bytes and empty directories without overwriting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texttext-backup-test-'));
  const source = path.join(root, 'source');
  const relative = path.join('.account-adoption-' + 'a'.repeat(32), 'before', 'shared-editing', 'b'.repeat(36));
  await mkdir(path.join(source, relative), { recursive: true });
  await mkdir(path.join(source, 'empty'));
  const bytes = Buffer.from([0, 1, 255, 13, 10]);
  await writeFile(path.join(source, relative, 'journal.bin'), bytes);
  const target = path.join(root, 'backup-' + 'c'.repeat(70));
  assert.ok(path.join(target, relative, 'journal.bin').length > 260);
  await backupDirectory(source, target);
  assert.deepEqual(await readFile(path.join(target, relative, 'journal.bin')), bytes);
  await assert.rejects(backupDirectory(source, target), { code: 'EEXIST' });
  assert.deepEqual(await readFile(path.join(source, relative, 'journal.bin')), bytes);
  await assert.rejects(backupDirectory(source, path.join(source, 'nested')), /outside/);
});

test('root and nested links are refused before any target creation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'texttext-backup-link-test-'));
  const source = path.join(root, 'source');
  await mkdir(source);
  const alias = path.join(root, 'alias');
  await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backupDirectory(alias, path.join(root, 'target')), /reparse/);
  await symlink(source, path.join(source, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backupDirectory(source, path.join(root, 'target')), /reparse/);
});
