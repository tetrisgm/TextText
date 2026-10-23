import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { withCommittedPin, assertReleaseSource } from './committed-pin.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'texttext-release-pin-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '--quiet');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(root, 'mac')); writeFileSync(join(root, 'mac/Package.resolved'), 'standalone');
  git('add', '.'); git('commit', '-qm', 'fixture');
  writeFileSync(join(root, 'mac/Package.resolved'), 'owner-store');
  return { root, pin: join(root, 'mac/Package.resolved'), evidence: join(root, 'evidence') };
}
test('release uses committed pin and restores owner bytes on failure', async () => {
  const { root, pin, evidence } = fixture();
  await assert.rejects(withCommittedPin(root, evidence, async () => {
    assert.equal(readFileSync(pin, 'utf8'), 'standalone');
    throw new Error('build failed');
  }), /build failed/);
  assert.equal(readFileSync(pin, 'utf8'), 'owner-store');
  assert.equal(readFileSync(join(evidence, 'owner-Package.resolved'), 'utf8'), 'owner-store');
});
test('concurrent pin edit is preserved rather than overwritten', async () => {
  const { root, pin, evidence } = fixture();
  await assert.rejects(withCommittedPin(root, evidence, async () => writeFileSync(pin, 'concurrent')), /Refusing to overwrite/);
  assert.equal(readFileSync(pin, 'utf8'), 'concurrent');
});
test('release refuses source edits and a different commit before the next surface', async () => {
  const { root, pin, evidence } = fixture();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.throws(() => assertReleaseSource(root, commit), /Source changed/);
  await withCommittedPin(root, evidence, async () => {
    assertReleaseSource(root, commit);
    assert.throws(() => assertReleaseSource(root, '0'.repeat(40)), /Source changed/);
  });
});
