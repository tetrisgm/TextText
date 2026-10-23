import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withParallelStage } from './parallel-stage.mjs';
import { withCommittedPin } from './committed-pin.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'texttext-parallel-stage-'));
  const marker = join(root, 'finished');
  const child = "setTimeout(() => require('fs').writeFileSync('finished', 'yes'), 40)";
  const run = (foreground, checkpoint = () => {}, code = child) =>
    withParallelStage(checkpoint, process.execPath, ['-e', code], { cwd: root }, foreground);
  return { root, marker, run };
}

test('foreground executes before child finishes and success waits for child', async () => {
  const { marker, run } = fixture();
  let checks = 0;
  const result = await run(() => { assert.equal(existsSync(marker), false); return 'foreground'; }, () => checks++);
  assert.equal(result, 'foreground'); assert.equal(existsSync(marker), true); assert.equal(checks, 2);
});

test('foreground failure joins child before caller cleanup', async () => {
  const { marker, run } = fixture();
  try { await assert.rejects(run(() => { throw Error('foreground failed'); }), /foreground failed/); }
  finally { assert.equal(existsSync(marker), true); }
});

test('both lane failures remain visible', async () => {
  const { run } = fixture();
  await assert.rejects(run(() => { throw Error('foreground failed'); }, () => {}, 'process.exit(7)'), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /foreground failed/); assert.match(error.message, /failed \(7\)/); return true;
  });
});

test('a failed child names its release stage after the foreground is joined', async () => {
  const { root } = fixture();
  await assert.rejects(withParallelStage(() => {}, process.execPath, ['-e', 'process.exit(7)'], { cwd: root }, () => {}, 'Windows candidate build'), /Windows candidate build failed \(7\)/);
});

test('preflight cancellation prevents either lane', async () => {
  const { marker, run } = fixture();
  await assert.rejects(run(() => assert.fail('foreground started'), () => { throw Error('cancelled'); }), /cancelled/);
  assert.equal(existsSync(marker), false);
});

test('source change or cancellation during foreground joins child then refuses success', async () => {
  const { marker, root, run } = fixture();
  const cancel = join(root, 'CANCEL');
  await assert.rejects(run(() => writeFileSync(cancel, ''), () => {
    if (existsSync(cancel)) throw Error('source changed or cancelled');
  }), /source changed or cancelled/);
  assert.equal(existsSync(marker), true);
});

test('spawn failure is reported and joined without unhandled rejection', async () => {
  await assert.rejects(withParallelStage(() => {}, 'texttext-missing-command-for-test', [], {}, () => {}), /ENOENT/);
});

test('failed parallel release retains committed pin until child completion', async () => {
  const { root } = fixture();
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--quiet'); git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(root, 'mac'));
  const pin = join(root, 'mac/Package.resolved');
  writeFileSync(pin, 'committed'); git('add', '.'); git('commit', '-qm', 'fixture');
  writeFileSync(pin, 'owner');
  let deployed = false;
  await assert.rejects(withCommittedPin(root, join(root, 'evidence'), async () => {
    await withParallelStage(() => {}, process.execPath, ['-e', "setTimeout(()=>{const fs=require('fs');fs.writeFileSync('observed-pin',fs.readFileSync('mac/Package.resolved'))},40)"], { cwd: root }, () => { throw Error('Mac gate failed'); });
    deployed = true;
  }), /Mac gate failed/);
  assert.equal(readFileSync(join(root, 'observed-pin'), 'utf8'), 'committed');
  assert.equal(readFileSync(pin, 'utf8'), 'owner');
  assert.equal(deployed, false);
});
