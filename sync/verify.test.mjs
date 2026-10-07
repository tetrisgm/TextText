import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fingerprint, validateReceipt, recordPassingRun } from './verify.mjs';

test('source additions, changes and removals invalidate receipts; prose does not', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-sync-gate-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src/a.ts'), 'original');
    const first = await fingerprint(root, ['src']);
    await fs.writeFile(path.join(root, 'src/readme.md'), 'notes');
    assert.equal(await fingerprint(root, ['src']), first);
    await fs.writeFile(path.join(root, 'src/a.ts'), 'changed');
    const changed = await fingerprint(root, ['src']);
    assert.notEqual(changed, first);
    await fs.writeFile(path.join(root, 'src/b.ts'), 'new');
    assert.notEqual(await fingerprint(root, ['src']), changed);
    await fs.rm(path.join(root, 'src/a.ts'));
    assert.notEqual(await fingerprint(root, ['src']), first);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('missing, failed, stale and wrong-platform or scope receipts fail closed', () => {
  const passed = { schema: 1, status: 'passed', digest: 'source', platform: 'darwin', scope: 'core', node: process.versions.node };
  validateReceipt(passed, 'source', 'darwin', 'core');
  for (const receipt of [undefined, {}, { ...passed, status: 'failed' }, { ...passed, digest: 'old' },
    { ...passed, platform: 'win32' }, { ...passed, scope: 'native' }, { ...passed, node: 'old' }]) {
    assert.throws(() => validateReceipt(receipt, 'source', 'darwin', 'core'), /verification/);
  }
});


test('failed reruns and edits during a run cannot leave a passing receipt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texttext-sync-receipt-'));
  const file = path.join(root, 'receipt.json');
  try {
    await fs.writeFile(file, 'old passed receipt');
    await assert.rejects(recordPassingRun(file, 'old', 'darwin', 'core', async () => {
      throw new Error('regression');
    }, async () => 'old'), /regression/);
    await assert.rejects(fs.readFile(file), { code: 'ENOENT' });
    await assert.rejects(recordPassingRun(file, 'old', 'darwin', 'core', async () => {}, async () => 'changed'), /Source changed/);
    await assert.rejects(fs.readFile(file), { code: 'ENOENT' });
    await recordPassingRun(file, 'same', 'darwin', 'core', async () => {}, async () => 'same');
    validateReceipt(JSON.parse(await fs.readFile(file, 'utf8')), 'same', 'darwin', 'core');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
