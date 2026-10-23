import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
test('Windows build requires explicit local line-ending configuration', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'texttext-checkout-test-'));
  const git = (...args) => assert.equal(spawnSync('git', args, { cwd }).status, 0);
  git('init', '--quiet');
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./check-checkout.mjs', import.meta.url))], { cwd, encoding: 'utf8' });
  assert.equal(run().status, 1);
  git('config', 'core.autocrlf', 'true');
  assert.equal(run().status, 1);
  git('config', 'core.autocrlf', 'false');
  assert.equal(run().status, 0);
});
